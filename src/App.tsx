import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  CLOCK_MS,
  DAILY_STREAK_STEP,
  REEL_MS,
  STRIKES,
  STRIKE_BACK_EVERY,
} from './game/engine'
import {
  modeSubtitle,
  multiplierLabel,
  REVEAL_MS,
  revealCallouts,
  streakFill,
  strikeLabel,
  howItWorks,
  type Callout,
} from './game/reveal'
import {
  DAILY_STORAGE_PREFIX,
  dailyStreak,
  dailyStorageKey,
  dailyDateKey,
  isCurrentDailySummary,
  msUntilNextDailyReset,
  readDailySummary,
  saveDailySummary,
  type GameSummary,
} from './game/dailyStore'
import { formatCountdown } from './game/share'
import { DAILY_DEAL } from './game/deal'
import { badgeInk } from './game/badgeInk'
import type { ChoiceBadge, Question, Side, Sport } from './game/types'
import { ResultShare } from './ResultShare'
import './App.css'

type Screen =
  | 'home'
  | 'reel'
  | 'question'
  | 'reveal'
  | 'teach'
  | 'mystery'
  | 'over'
  | 'connection'
  | 'serverError'
  | 'noQuestions'
type Mode = 'classic' | 'daily'

type Lifelines = {
  fiftyFifty: number
  shield: boolean
  fiftyFiftyUsedOn?: number
}

type PublicQuestion = Pick<
  Question,
  'id' | 'side' | 'sport' | 'leagues' | 'difficulty' | 'category' | 'prompt' | 'reel'
> & {
  choices: string[]
  choiceBadges?: (ChoiceBadge | null)[]
  boss?: {
    category: string
    clockMs: number
    reelMs: number
    hitPoints: number
    missPoints: number
    bonus?: boolean
  }
}

type PublicProgress = {
  score: number
  strikes: number
  streak: number
  correct?: number
  lifelines?: Lifelines
}

type GameSession = {
  mode: Mode
  runId: string
  runToken: string
  date: string
  progress: PublicProgress
  questionIndex: number
  question: PublicQuestion
  total: number | null
}

type AnswerBody = {
  runId: string
  runToken: string
  questionIndex: number
  choice: string | null
  clientMs: number | null
}

type AnswerResponse = {
  correct: boolean
  points: number
  answer: string
  teach: string
  source: Question['source']
  progress: PublicProgress
  shielded?: boolean
  mystery?: string[]
  next: { questionIndex: number } | null
  summary: GameSummary | null
}

type MysteryPrizeDescriptor = { kind: string; points?: number; label: string }

type MysteryState = {
  picked: number | null
  result: {
    prizes: MysteryPrizeDescriptor[]
    applied: MysteryPrizeDescriptor
  } | null
}

type AnswerReveal = {
  correct: boolean
  answer: string
  picked: string | null
  points: number
  multiplier: string | null
  callouts: { kind: Callout; text: string }[]
}

type QuestionResponse = {
  questionIndex: number
  question: PublicQuestion
  elapsedMs: number
}

type PendingRequest =
  | { kind: 'answer'; body: AnswerBody }
  | { kind: 'question'; questionIndex: number }

type RunResponse = {
  runId: string
  runToken: string
  date: string
  questionIndex: number
  question: PublicQuestion
  progress: PublicProgress
  total: number | null
  bosses?: boolean
  mystery?: string[]
}

function browserStorage(): Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
> | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const RUN_STORAGE_PREFIX = 'streaking-sports:run:'

type StoredRun = { runId: string; runToken: string }

function storedRun(mode: Mode): StoredRun | null {
  const storage = browserStorage()
  if (!storage) return null
  try {
    const value = storage.getItem(`${RUN_STORAGE_PREFIX}${mode}`)
    const parsed = value ? (JSON.parse(value) as StoredRun) : null
    return parsed?.runId && parsed?.runToken ? parsed : null
  } catch {
    return null
  }
}

function saveRun(mode: Mode, run: StoredRun) {
  try {
    browserStorage()?.setItem(
      `${RUN_STORAGE_PREFIX}${mode}`,
      JSON.stringify(run),
    )
  } catch {
    // Session stays in memory; resume just won't survive a refresh.
  }
}

function clearRun(mode: Mode) {
  try {
    browserStorage()?.removeItem(`${RUN_STORAGE_PREFIX}${mode}`)
  } catch {
    // ignore
  }
}

function storedSummary(date: string): GameSummary | null {
  const storage = browserStorage()
  if (!storage) return null
  const summary = readDailySummary(storage, date)
  // A summary saved under a different deal was playing a different set, so
  // it no longer counts as having played today's Daily.
  return summary && isCurrentDailySummary(summary, DAILY_DEAL) ? summary : null
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

const ANSWER_KEYS = ['a', 'b', 'c', 'd']

function answerIndexForKey(key: string): number {
  const letter = ANSWER_KEYS.indexOf(key.toLowerCase())
  if (letter !== -1) return letter
  const digit = Number(key)
  return Number.isInteger(digit) && digit >= 1 && digit <= ANSWER_KEYS.length
    ? digit - 1
    : -1
}

const BOSS_WHEEL: [string, string][] = [
  ['science', 'Science'],
  ['history', 'History'],
  ['art', 'Art'],
  ['pop-culture', 'Pop Culture'],
]

function bossLabel(category: string): string {
  return BOSS_WHEEL.find(([key]) => key === category)?.[1] ?? category
}

function bossWheelTurn(category: string): number {
  const index = Math.max(0, BOSS_WHEEL.findIndex(([key]) => key === category))
  return 360 * 4 + 360 - (index * 90 + 45)
}

function clockMsFor(question: PublicQuestion | undefined): number {
  return question?.boss?.clockMs ?? CLOCK_MS
}

function elapsedSince(startedAt: number, clockMs: number): number {
  return Math.min(clockMs, Math.max(0, performance.now() - startedAt))
}

// Non-boss reel: cards slot-spin through decoys, then settle ~500ms before
// the screen flips to the question (the useEffect on activeReelMs owns the flip).
const REEL_TICK_MS = 80
const REEL_SETTLE_STAGGER_MS = 180
const REEL_SETTLE_PAUSE_MS = 500

const SPORT_DECOYS = ['football', 'basketball', 'baseball', 'NFL', 'NBA', 'MLB', 'NHL', 'NCAA']
const RULES_CATEGORY_DECOYS = [
  'Clock and timing',
  'Numbers and dimensions',
  "What's the call?",
  'Scoring',
]
const PLAYER_CATEGORY_DECOYS = [
  'Alma mater',
  'Drafted by',
  'Jersey number',
  'Position',
  'Country',
]
const PLAYER_DECOYS = [
  'LeBron James',
  'Patrick Mahomes',
  'Shohei Ohtani',
  'Caitlin Clark',
  'Lionel Messi',
  'Serena Williams',
  'Tiger Woods',
  'Simone Biles',
]

type ReelCardSpec = { label: string; final: string; decoys: string[] }

function reelCards(question: PublicQuestion): ReelCardSpec[] {
  const without = (list: string[], keep: string) => list.filter((value) => value !== keep)
  if (question.side === 'players') {
    const season = question.reel?.season
    const seasonDecoys = season
      ? [season - 3, season - 1, season + 1, season + 2, season + 4].map(String)
      : ['2019', '2020', '2021', '2023', '2024']
    return [
      { label: 'SEASON', final: season ? String(season) : '', decoys: seasonDecoys },
      {
        label: 'PLAYER',
        final: question.reel?.player ?? '',
        decoys: without(PLAYER_DECOYS, question.reel?.player ?? ''),
      },
      {
        label: 'CATEGORY',
        final: question.category,
        decoys: without(PLAYER_CATEGORY_DECOYS, question.category),
      },
    ]
  }
  return [
    {
      label: 'SPORT',
      final: question.sport,
      decoys: without([...SPORT_DECOYS, ...question.leagues], question.sport),
    },
    {
      label: 'CATEGORY',
      final: question.category,
      decoys: without(RULES_CATEGORY_DECOYS, question.category),
    },
  ]
}

function ReelCards({ question }: { question: PublicQuestion }) {
  const cards = useMemo(() => reelCards(question), [question])
  // Last card lands REEL_SETTLE_PAUSE_MS before the question screen.
  const spinDoneMs = Math.max(0, REEL_MS - REEL_SETTLE_PAUSE_MS)
  const settledAt = cards.map(
    (_, index) => spinDoneMs - (cards.length - 1 - index) * REEL_SETTLE_STAGGER_MS,
  )
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false),
  )
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reduceMotion) return
    const startedAt = performance.now()
    const interval = window.setInterval(
      () => setElapsed(performance.now() - startedAt),
      REEL_TICK_MS,
    )
    const stop = window.setTimeout(() => {
      window.clearInterval(interval)
      setElapsed(spinDoneMs)
    }, spinDoneMs)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(stop)
    }
  }, [cards, reduceMotion, spinDoneMs])

  return (
    <div className={`reel-stack ${question.side === 'players' ? 'reel-stack--player' : ''}`}>
      {cards.map((card, index) => {
        const settled = reduceMotion || elapsed >= settledAt[index]
        const value = settled
          ? card.final
          : card.decoys.length > 0
            ? card.decoys[
                (Math.floor(elapsed / REEL_TICK_MS) + index * 3) % card.decoys.length
              ]
            : card.final
        return (
          <div
            className={`reel-card ${settled ? 'reel-card--settled' : 'reel-card--spinning'}`}
            key={card.label}
          >
            <span>{card.label}</span>
            <strong>{value}</strong>
          </div>
        )
      })}
    </div>
  )
}

function Badge({ badge }: { badge: ChoiceBadge }) {
  if (badge.kind === 'flag') {
    return (
      <img
        className="answer-badge answer-badge--flag"
        src={`/flags/${badge.code}.svg`}
        alt=""
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="answer-badge answer-badge--team"
      aria-hidden="true"
      style={{
        backgroundColor: badge.primary,
        borderColor: badge.secondary,
        color: badgeInk(badge.primary),
      }}
    >
      {badge.abbr}
    </span>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>(
    'checking',
  )
  const [bossesEnabled, setBossesEnabled] = useState(false)
  const [today, setToday] = useState(dailyDateKey)
  const [now, setNow] = useState(() => Date.now())
  const [todaySummary, setTodaySummary] = useState<GameSummary | null>(() =>
    typeof window === 'undefined' ? null : storedSummary(dailyDateKey()),
  )
  const [dailyStorageVersion, setDailyStorageVersion] = useState(0)
  const dayStreak = useMemo(() => {
    const storage = browserStorage()
    return storage ? dailyStreak(storage, today, DAILY_DEAL) : 0
    // todaySummary and dailyStorageVersion trigger recomputation for storage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, todaySummary, dailyStorageVersion])
  const [session, setSession] = useState<GameSession | null>(null)
  const [summary, setSummary] = useState<GameSummary | null>(null)
  const [teachInfo, setTeachInfo] = useState<{
    answer: string
    teach: string
    source: Question['source']
  } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [reveal, setReveal] = useState<AnswerReveal | null>(null)
  const [mystery, setMystery] = useState<MysteryState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [pendingNextIndex, setPendingNextIndex] = useState<number | null>(null)
  const [pendingSummary, setPendingSummary] = useState<GameSummary | null>(null)
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const answerStartedAt = useRef(0)
  const questionClockOffset = useRef(0)
  const answered = useRef(false)
  // Results for any run other than this one (or after leaving a run) are dropped.
  const activeRunId = useRef<string | null>(null)
  const startGeneration = useRef(0)
  const submitAnswerRef = useRef<
    (choice: string | null, clientMs: number | null) => void
  >(() => {})
  const loadQuestionRef = useRef<
    (current: GameSession, questionIndex: number) => void
  >(() => {})
  const questionHeadingRef = useRef<HTMLHeadingElement>(null)
  const teachButtonRef = useRef<HTMLButtonElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  const serverErrorButtonRef = useRef<HTMLButtonElement>(null)
  const noQuestionsButtonRef = useRef<HTMLButtonElement>(null)
  const dailyButtonRef = useRef<HTMLButtonElement>(null)
  const classicButtonRef = useRef<HTMLButtonElement>(null)
  const homeFocusMode = useRef<Mode | null>(null)

  const refreshToday = useCallback(() => {
    setNow(Date.now())
    const date = dailyDateKey()
    if (date !== today) {
      setToday(date)
      setTodaySummary(storedSummary(date))
    }
  }, [today])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Health check failed')
        const result = (await response.json()) as { ok: boolean; bosses?: boolean }
        setApiStatus(result.ok ? 'ok' : 'error')
        setBossesEnabled(result.bosses === true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus('error')
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshToday()
    }
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key.startsWith(DAILY_STORAGE_PREFIX)
      ) {
        setDailyStorageVersion((version) => version + 1)
      }
      if (event.key === null || event.key === dailyStorageKey(today)) {
        setTodaySummary(storedSummary(today))
      }
    }
    window.addEventListener('focus', refreshToday)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('storage', onStorage)
    let timer = 0
    const armMidnightTimer = () => {
      timer = window.setTimeout(() => {
        refreshToday()
        armMidnightTimer()
      }, msUntilNextDailyReset(Date.now()) + 1000)
    }
    armMidnightTimer()
    return () => {
      window.removeEventListener('focus', refreshToday)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('storage', onStorage)
      window.clearTimeout(timer)
    }
  }, [refreshToday, today])

  useEffect(() => {
    if (screen !== 'home') return
    const updateNow = () => setNow(Date.now())
    updateNow()
    const interval = window.setInterval(updateNow, 30_000)
    return () => window.clearInterval(interval)
  }, [screen])

  const startRun = async (
    input:
      | { mode: 'classic'; sport: 'all' | Sport; side: 'both' | Side }
      | { mode: 'daily' },
  ) => {
    const generation = ++startGeneration.current
    activeRunId.current = null
    setPendingRequest(null)
    setIsSubmitting(false)
    setPicked(null)
    setReveal(null)
    setMystery(null)
    setIsStarting(true)
    setStartError(false)
    setSummary(null)
    setSession(null)
    setAnnouncement('')
    setPendingSummary(null)
    setPendingNextIndex(null)
    setScreen('home')
    try {
      const resume = storedRun(input.mode)
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(resume ? { ...input, resume } : input),
      })
      const result = (await response.json()) as RunResponse | { error?: string }
      if (generation !== startGeneration.current) return
      if (response.status === 409 && 'error' in result && result.error === 'no_questions') {
        setSession(null)
        setScreen('noQuestions')
        return
      }
      if (!response.ok || !('runId' in result)) throw new Error('Run creation failed')

      activeRunId.current = result.runId
      saveRun(input.mode, { runId: result.runId, runToken: result.runToken })
      questionClockOffset.current = 0
      setBossesEnabled(result.bosses === true)
      setSession({
        mode: input.mode,
        runId: result.runId,
        runToken: result.runToken,
        date: result.date,
        progress: result.progress,
        questionIndex: result.questionIndex,
        question: result.question,
        total: result.total,
      })
      // A resumed run can still have an unopened mystery box waiting.
      if (result.mystery && result.mystery.length === 2) {
        setMystery({ picked: null, result: null })
        setScreen('mystery')
      } else {
        setScreen('reel')
      }
    } catch {
      if (generation !== startGeneration.current) return
      setStartError(true)
      setApiStatus('error')
      setScreen('home')
    } finally {
      if (generation === startGeneration.current) setIsStarting(false)
    }
  }

  const startClassic = () => {
    void startRun({ mode: 'classic', sport: 'all', side: 'both' })
  }

  const openDaily = () => {
    const date = dailyDateKey()
    setToday(date)
    const previous = storedSummary(date)
    setTodaySummary(previous)
    if (previous) {
      setSession(null)
      setSummary(previous)
      setScreen('over')
      return
    }
    void startRun({ mode: 'daily' })
  }

  // A saved summary normally short-circuits openDaily; replay skips that so a
  // redealt set (or a just-for-fun rerun) can start a fresh run. The stored
  // summary is first-write-wins, so the replay can't overwrite the score.
  const replayDaily = () => {
    void startRun({ mode: 'daily' })
  }

  const saveDailyResult = (result: GameSummary) => {
    if (result.mode !== 'daily') return
    const storage = browserStorage()
    const tagged = { ...result, schedule: 'ct17' as const, deal: DAILY_DEAL }
    const winner = storage
      ? saveDailySummary(storage, result.date, tagged)
      : tagged
    if (result.date === dailyDateKey()) setTodaySummary(winner)
  }

  const loadQuestion = async (current: GameSession, questionIndex: number) => {
    setPendingRequest({ kind: 'question', questionIndex })
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: current.runId,
          runToken: current.runToken,
          questionIndex,
        }),
      })
      if (activeRunId.current !== current.runId) return
      if (response.status >= 500) {
        setPendingRequest(null)
        setIsSubmitting(false)
        setScreen('serverError')
        return
      }
      if (!response.ok) throw new Error('Question request failed')
      const result = (await response.json()) as QuestionResponse
      if (activeRunId.current !== current.runId) return
      setPendingRequest(null)
      setIsSubmitting(false)
      setTeachInfo(null)
      setPicked(null)
      setReveal(null)
      setMystery(null)
      questionClockOffset.current = Math.min(
        clockMsFor(result.question),
        Math.max(0, result.elapsedMs),
      )
      setSession({
        ...current,
        questionIndex: result.questionIndex,
        question: result.question,
      })
      setScreen('reel')
      if (result.question.boss) {
        setAnnouncement(
          `Boss question: ${bossLabel(result.question.boss.category)}. ${
            result.question.boss.clockMs / 1000
          } seconds. ${
            result.question.boss.bonus
              ? 'Bonus round: plus 500 if right, no penalty if wrong.'
              : 'Plus 500 if right, minus 250 if wrong, no strike.'
          }`,
        )
      }
    } catch {
      if (activeRunId.current !== current.runId) return
      setIsSubmitting(false)
      setScreen('connection')
    }
  }

  const sendAnswer = async (body: AnswerBody, current: GameSession) => {
    try {
      const response = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (activeRunId.current !== body.runId) return
      if (response.status >= 500) {
        setPendingRequest(null)
        setIsSubmitting(false)
        setScreen('serverError')
        return
      }
      if (!response.ok) throw new Error('Answer submission failed')
      const result = (await response.json()) as AnswerResponse
      if (activeRunId.current !== body.runId) return
      const timedOut =
        !result.correct &&
        (body.choice === null || body.choice === result.answer)
      const updatedCurrent = { ...current, progress: result.progress }
      const nextIndex = result.next?.questionIndex ?? null

      setPendingRequest(null)
      setIsSubmitting(false)
      setSession(updatedCurrent)
      setSummary(result.summary)
      if (result.summary) {
        saveDailyResult(result.summary)
        clearRun(current.mode)
      }
      setPendingSummary(result.summary)
      setPendingNextIndex(nextIndex)
      setTeachInfo(
        result.correct
          ? null
          : { answer: result.answer, teach: result.teach, source: result.source },
      )
      setReveal({
        correct: result.correct,
        answer: result.answer,
        picked: body.choice,
        points: result.points,
        multiplier: result.correct && !current.question.boss
          ? multiplierLabel(
              current.progress.streak,
              current.mode === 'daily' ? DAILY_STREAK_STEP : 0,
            )
          : null,
        callouts: result.correct
          ? revealCallouts(current.progress, result.progress, {
              levels: current.mode === 'classic',
              mystery: !!result.mystery,
            }).filter(
              (callout) => !current.question.boss || callout.kind !== 'multiplier',
            )
          : [],
      })
      setMystery(result.mystery ? { picked: null, result: null } : null)
      if (timedOut) setElapsedMs(clockMsFor(current.question))
      setScreen('reveal')
      setAnnouncement(
        result.correct
          ? `Correct! Plus ${result.points}. Streak ${result.progress.streak}.`
          : `${timedOut ? 'Time’s up' : 'Wrong'}. ${
              current.question.boss?.bonus
                ? 'No bonus points.'
                : current.question.boss
                ? `Minus ${-result.points}.`
                : current.mode === 'classic'
                ? result.shielded
                  ? 'Shield held — no strike.'
                  : `Strike ${result.progress.strikes} of ${STRIKES}.`
                : `${result.progress.strikes} missed.`
            }`,
      )
    } catch {
      if (activeRunId.current !== body.runId) return
      setIsSubmitting(false)
      setScreen('connection')
    }
  }

  const submitAnswer = (choice: string | null, clientMs: number | null) => {
    if (!session || screen !== 'question' || answered.current) return
    answered.current = true
    setPicked(choice)
    const body: AnswerBody = {
      runId: session.runId,
      runToken: session.runToken,
      questionIndex: session.questionIndex,
      choice,
      clientMs,
    }
    setPendingRequest({ kind: 'answer', body })
    setIsSubmitting(true)
    void sendAnswer(body, session)
  }

  const retryConnection = () => {
    if (!pendingRequest || !session || isSubmitting) return
    if (pendingRequest.kind === 'question') {
      void loadQuestion(session, pendingRequest.questionIndex)
      return
    }
    answered.current = true
    setIsSubmitting(true)
    void sendAnswer(pendingRequest.body, session)
  }

  const continueAfterTeach = () => {
    if (isSubmitting) return
    if (pendingSummary) {
      setSummary(pendingSummary)
      setPendingSummary(null)
      setPendingNextIndex(null)
      setScreen('over')
    } else if (pendingNextIndex !== null && session) {
      const nextIndex = pendingNextIndex
      setPendingNextIndex(null)
      void loadQuestion(session, nextIndex)
    } else {
      setScreen('home')
    }
  }

  useEffect(() => {
    submitAnswerRef.current = submitAnswer
  })

  useEffect(() => {
    loadQuestionRef.current = loadQuestion
  })

  const goHome = () => {
    homeFocusMode.current = session?.mode ?? summary?.mode ?? null
    startGeneration.current += 1
    activeRunId.current = null
    setPendingRequest(null)
    setPendingNextIndex(null)
    setPendingSummary(null)
    setPicked(null)
    setReveal(null)
    setIsSubmitting(false)
    setIsStarting(false)
    setSession(null)
    setSummary(null)
    setAnnouncement('')
    setMystery(null)
    setScreen('home')
  }

  const playAgain = () => startClassic()

  const pickMystery = async (pick: 0 | 1) => {
    if (!session || !mystery || mystery.picked !== null || isSubmitting) return
    setIsSubmitting(true)
    setMystery({ picked: pick, result: null })
    try {
      const response = await fetch('/api/mystery', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: session.runId,
          runToken: session.runToken,
          pick,
        }),
      })
      if (activeRunId.current !== session.runId) return
      if (response.status === 409) {
        // The box is already gone — most likely this pick applied on an earlier
        // attempt whose response was lost. The server sends authoritative
        // progress so an applied prize (e.g. bonus points) isn't dropped.
        const body = (await response.json().catch(() => null)) as {
          progress?: PublicProgress
        } | null
        if (activeRunId.current !== session.runId) return
        const applied = body?.progress
        if (applied) {
          setSession({ ...session, progress: applied })
          setPendingSummary((previous) =>
            previous ? { ...previous, score: applied.score } : previous,
          )
          setSummary((previous) =>
            previous ? { ...previous, score: applied.score } : previous,
          )
        }
        continueAfterMystery(applied)
        return
      }
      if (!response.ok) throw new Error('Mystery pick failed')
      const result = (await response.json()) as {
        prizes: MysteryPrizeDescriptor[]
        applied: MysteryPrizeDescriptor
        progress: PublicProgress
      }
      if (activeRunId.current !== session.runId) return
      setSession({ ...session, progress: result.progress })
      // A box can be the run's last event; keep the end screen's score honest.
      setPendingSummary((previous) =>
        previous ? { ...previous, score: result.progress.score } : previous,
      )
      setSummary((previous) =>
        previous ? { ...previous, score: result.progress.score } : previous,
      )
      setMystery({ picked: pick, result })
      setAnnouncement(`Mystery box: ${result.applied.label}.`)
    } catch {
      if (activeRunId.current !== session.runId) return
      // Response lost or offline: the pick may not have applied, so put the
      // boxes back and let the player try again instead of losing the prize.
      setMystery({ picked: null, result: null })
      setAnnouncement('Connection hiccup — tap a box to try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // recoveredProgress is passed in when a 409 reports an already-applied
  // pick: the setState calls above haven't rendered yet, so build the
  // session/summary this step uses directly from the recovered progress.
  const continueAfterMystery = (recoveredProgress?: PublicProgress) => {
    setMystery(null)
    const currentSession =
      recoveredProgress && session
        ? { ...session, progress: recoveredProgress }
        : session
    const currentSummary =
      recoveredProgress && pendingSummary
        ? { ...pendingSummary, score: recoveredProgress.score }
        : pendingSummary
    if (currentSummary) {
      setSummary(currentSummary)
      setPendingSummary(null)
      setPendingNextIndex(null)
      setScreen('over')
    } else if (pendingNextIndex !== null && currentSession) {
      const nextIndex = pendingNextIndex
      setPendingNextIndex(null)
      void loadQuestion(currentSession, nextIndex)
    } else if (currentSession) {
      // Box restored after a refresh: the un-answered question is still live.
      void loadQuestion(currentSession, currentSession.questionIndex)
    } else {
      setScreen('over')
    }
  }

  const useFiftyFifty = async () => {
    if (!session || screen !== 'question' || isSubmitting) return
    if ((session.progress.lifelines?.fiftyFifty ?? 0) < 1) return
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/lifeline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: session.runId,
          runToken: session.runToken,
          questionIndex: session.questionIndex,
          kind: 'fiftyFifty',
        }),
      })
      if (activeRunId.current !== session.runId) return
      if (!response.ok) throw new Error('Lifeline failed')
      const result = (await response.json()) as {
        question: PublicQuestion
        lifelines: Lifelines
      }
      if (activeRunId.current !== session.runId) return
      // Merge into the latest session only while this question is still live —
      // a late response must not resurrect a question the player already
      // answered or timed out on while the lifeline request was in flight.
      setSession((previous) =>
        previous &&
        previous.runId === session.runId &&
        previous.questionIndex === session.questionIndex &&
        !answered.current
          ? {
              ...previous,
              progress: { ...previous.progress, lifelines: result.lifelines },
              question: result.question,
            }
          : previous
      )
      if (!answered.current) setAnnouncement('50/50 used. Two choices left.')
    } catch {
      if (activeRunId.current !== session.runId) return
      setAnnouncement('Couldn’t use the lifeline. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const activeQuestionId = session?.question.id
  const activeClockMs = clockMsFor(session?.question)
  const activeReelMs = session?.question.boss?.reelMs ?? REEL_MS

  useEffect(() => {
    if (screen !== 'reel' || !activeQuestionId) return
    const timeout = window.setTimeout(() => {
      setElapsedMs(0)
      setScreen('question')
    }, activeReelMs)
    return () => window.clearTimeout(timeout)
  }, [screen, activeQuestionId, activeReelMs])

  useEffect(() => {
    if (screen !== 'reveal' || !reveal) return
    const timeout = window.setTimeout(() => {
      setReveal(null)
      if (!reveal.correct) {
        setScreen('teach')
      } else if (mystery) {
        setScreen('mystery')
      } else if (pendingSummary) {
        setPendingSummary(null)
        setPendingNextIndex(null)
        setScreen('over')
      } else if (pendingNextIndex !== null && session) {
        const nextIndex = pendingNextIndex
        setPendingNextIndex(null)
        loadQuestionRef.current(session, nextIndex)
      } else {
        setScreen('over')
      }
    }, REVEAL_MS)
    return () => window.clearTimeout(timeout)
  }, [screen, reveal, mystery, pendingSummary, pendingNextIndex, session])

  useEffect(() => {
    if (screen !== 'question' || !activeQuestionId) return
    answered.current = false
    answerStartedAt.current = performance.now() - questionClockOffset.current

    const updateClock = () => {
      if (answered.current) return
      const elapsed = performance.now() - answerStartedAt.current
      setElapsedMs(Math.min(activeClockMs, elapsed))
      if (elapsed >= activeClockMs) submitAnswerRef.current(null, null)
    }
    const interval = window.setInterval(updateClock, 40)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [screen, activeQuestionId, activeClockMs])

  useEffect(() => {
    const target =
      screen === 'question'
        ? questionHeadingRef.current
        : screen === 'teach'
          ? teachButtonRef.current
          : screen === 'over'
            ? resultHeadingRef.current
            : screen === 'connection'
              ? retryButtonRef.current
              : screen === 'serverError'
                ? serverErrorButtonRef.current
                : screen === 'noQuestions'
                  ? noQuestionsButtonRef.current
                  : null
    if (target) {
      target.focus()
      return
    }
    if (screen === 'home' && homeFocusMode.current) {
      const mode = homeFocusMode.current
      homeFocusMode.current = null
      ;(mode === 'daily' ? dailyButtonRef : classicButtonRef).current?.focus()
    }
  }, [screen, activeQuestionId])

  const questionChoices = screen === 'question' ? session?.question.choices : undefined

  useEffect(() => {
    if (!questionChoices) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      const index = answerIndexForKey(event.key)
      const choice = index === -1 ? undefined : questionChoices[index]
      if (choice === undefined) return
      event.preventDefault()
      submitAnswerRef.current(
        choice,
        Math.round(elapsedSince(answerStartedAt.current, activeClockMs)),
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [questionChoices, activeClockMs])

  const chooseAnswer = (choice: string) => {
    submitAnswer(
      choice,
      Math.round(elapsedSince(answerStartedAt.current, activeClockMs)),
    )
  }

  const currentSummary = screen === 'over' ? summary : null
  const progress = session?.progress
  const question = session?.question
  const lateCorrect =
    reveal !== null && !reveal.correct && reveal.picked === reveal.answer
  const remainingSeconds = Math.max(0, Math.ceil((activeClockMs - elapsedMs) / 1000))
  const resultLabel = currentSummary
    ? currentSummary.mode === 'daily'
      ? currentSummary.reason === 'complete'
        ? 'DAILY 10 COMPLETE'
        : 'DAILY 10 · SAVED RESULT'
      : currentSummary.reason === 'strikes'
        ? 'THREE STRIKES'
        : 'QUESTION BANK CLEARED'
    : ''
  const dailyTheme =
    session?.mode === 'daily' || (screen === 'over' && currentSummary?.mode === 'daily')
  const dailyAnswered = Math.min(
    session?.total ?? 10,
    !session
      ? 0
      : screen === 'reveal' || screen === 'teach'
        ? session.questionIndex + 1
        : pendingRequest?.kind === 'question'
          ? Math.max(session.questionIndex, pendingRequest.questionIndex)
          : session.questionIndex,
  )
  const clockStyle = {
    '--clock-progress': `${Math.max(0, 100 - (elapsedMs / activeClockMs) * 100)}%`,
  } as CSSProperties

  return (
    <main className={`app-shell${dailyTheme ? ' theme-daily' : ''}`}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {screen === 'home' && (
        <section className="home-panel">
          <div className="home-hero">
            <p className="eyebrow">Football · Basketball · Baseball trivia</p>
            <h1>Streaking Sports</h1>
            <p className="tagline">Know the rules when streaking.</p>
          </div>
          {startError && (
            <p className="connection-note" role="alert">
              Connection problem. Check your connection and try again.
            </p>
          )}
          <div className="daily-block">
            <button
              className="daily-button"
              onClick={openDaily}
              disabled={isStarting}
              ref={dailyButtonRef}
            >
              <span className="daily-button-label">
                <span className="daily-button-title">
                  {todaySummary ? 'Previous Results' : 'Play Daily 10'}
                </span>
                <span className="mode-subtitle">{modeSubtitle('daily')}</span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
            <p className="daily-meta">
              {dayStreak > 0 && <>{dayStreak}-day streak · </>}
              Next Daily in {formatCountdown(msUntilNextDailyReset(now))}
            </p>
          </div>
          <button
            className="secondary-button home-classic"
            onClick={startClassic}
            disabled={isStarting}
            ref={classicButtonRef}
          >
            Play Classic Mode <span aria-hidden="true">↗</span>
          </button>
          <details className="how-it-works">
            <summary>How it works</summary>
            <ul>
              {howItWorks({ bosses: bossesEnabled }).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </details>
        </section>
      )}

      {screen === 'noQuestions' && (
        <section className="home-panel">
          <p className="eyebrow">No questions available</p>
          <h1>Try again later</h1>
          <p className="tagline">
            There aren’t any questions available right now.
          </p>
          <button
            className="secondary-button"
            onClick={goHome}
            ref={noQuestionsButtonRef}
          >
            Back home
          </button>
        </section>
      )}

      {screen !== 'home' && session && question && progress && (
        <section className="game-panel">
          <header className="game-header">
            <button className="back-button" onClick={goHome} aria-label="Back home">
              <span aria-hidden="true">←</span>
            </button>
            <div className="game-mode-label">
              {session.mode === 'daily' ? 'DAILY 10' : 'CLASSIC'}
              {screen !== 'over' && (
                <span>
                  {session.question.boss?.bonus
                    ? 'BONUS BOSS'
                    : `QUESTION ${session.questionIndex + 1}`}
                  {!session.question.boss?.bonus && session.mode === 'daily' && session.total
                    ? ` OF ${session.total}`
                    : ''}
                </span>
              )}
            </div>
            <div className="score-label">
              <span>SCORE</span>
              <strong>{progress.score.toLocaleString()}</strong>
              {screen === 'reveal' && reveal && reveal.points > 0 && (
                <span className="points-pop">+{reveal.points}</span>
              )}
              {screen === 'reveal' && reveal && reveal.points < 0 && (
                <span className="points-pop points-pop--loss">
                  −{-reveal.points}
                </span>
              )}
              {screen === 'reveal' && reveal?.multiplier && (
                <span className="multiplier-chip">{reveal.multiplier}</span>
              )}
            </div>
          </header>

          {screen !== 'over' && (
            <div className="game-stats">
              {session.mode === 'classic' ? (
                <div className="strike-display">
                  <span className="strike-caption">STRIKES</span>
                  <div
                    className="strike-group"
                    role="img"
                    aria-label={`${progress.strikes} of ${STRIKES} strikes`}
                  >
                    {[0, 1, 2].map((strike) => (
                      <span
                        className={`strike-slot ${strike < progress.strikes ? 'is-active' : ''}`}
                        key={strike}
                        aria-label={strikeLabel(strike + 1)}
                        title={strikeLabel(strike + 1)}
                      >
                        K
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="daily-track"
                    role="progressbar"
                    aria-label="Daily 10 progress"
                    aria-valuemin={0}
                    aria-valuemax={session.total ?? 10}
                    aria-valuenow={dailyAnswered}
                    aria-valuetext={`${dailyAnswered} of ${session.total ?? 10} answered`}
                  >
                    {Array.from({ length: session.total ?? 10 }, (_, index) => (
                      <span
                        key={index}
                        className={
                          index < dailyAnswered
                            ? 'is-done'
                            : index === session.questionIndex
                              ? 'is-current'
                              : undefined
                        }
                      />
                    ))}
                  </div>
                  <div className="daily-misses">{progress.strikes} missed</div>
                </>
              )}
              {session.mode === 'classic' &&
                ((progress.lifelines?.fiftyFifty ?? 0) > 0 ||
                  progress.lifelines?.shield) && (
                  <div className="lifeline-row">
                    {(progress.lifelines?.fiftyFifty ?? 0) > 0 && (
                      <button
                        className="lifeline-button"
                        onClick={useFiftyFifty}
                        disabled={
                          screen !== 'question' ||
                          isSubmitting ||
                          progress.lifelines?.fiftyFiftyUsedOn ===
                            session.questionIndex
                        }
                        aria-label={`Use 50/50 lifeline, ${progress.lifelines?.fiftyFifty} left`}
                      >
                        50/50
                        {(progress.lifelines?.fiftyFifty ?? 0) > 1 &&
                          ` ×${progress.lifelines?.fiftyFifty}`}
                      </button>
                    )}
                    {progress.lifelines?.shield && (
                      <span
                        className="lifeline-chip"
                        title="Your next miss won't cost a strike"
                      >
                        Shield
                      </span>
                    )}
                  </div>
                )}
              {session.mode === 'classic' && (
                <div
                  className={`streak-ring ${screen === 'reveal' && reveal?.correct ? 'is-pulsing' : ''}`}
                  style={{
                    '--streak-fill': `${streakFill(progress.streak) * 100}%`,
                  } as CSSProperties}
                  role="img"
                  aria-label={`${progress.streak} streak, strike back at ${STRIKE_BACK_EVERY}`}
                >
                  <span>{progress.streak}</span>
                  <small>/{STRIKE_BACK_EVERY}</small>
                </div>
              )}
            </div>
          )}

          {screen === 'connection' && (
            <div className="connection-note" role="alert">
              Connection problem —{' '}
              <button
                onClick={retryConnection}
                disabled={isSubmitting}
                ref={retryButtonRef}
              >
                Retry
              </button>
            </div>
          )}

          {screen === 'serverError' && (
            <div className="server-error" role="alert">
              <strong>Something went wrong</strong>
              <span>This run can't continue. Your score so far is {progress.score}.</span>
              <button
                className="classic-button"
                onClick={goHome}
                ref={serverErrorButtonRef}
              >
                Back home
              </button>
            </div>
          )}

          {screen === 'reel' && question.boss && (
            <div
              className="boss-reel"
              data-category={question.boss.category}
              style={{ '--boss-turn': `${bossWheelTurn(question.boss.category)}deg` } as CSSProperties}
            >
              <h2 className="boss-banner">Boss question</h2>
              <div className="boss-wheel" aria-hidden="true">
                <span className="boss-wheel-pointer" />
                <div className="boss-wheel-disc">
                  {BOSS_WHEEL.map(([key, label]) => (
                    <span key={key} className="boss-wheel-label">{label}</span>
                  ))}
                </div>
              </div>
              <p className="boss-category">{bossLabel(question.boss.category)}</p>
              <p className="reel-caption">
                {question.boss.clockMs / 1000} seconds · +{question.boss.hitPoints} if right · {question.boss.bonus ? 'bonus round · no penalty if wrong' : `−${question.boss.missPoints} if wrong · no strike`}
              </p>
            </div>
          )}

          {screen === 'reel' && !question.boss && (
            <div className="reel-stage">
              <p className="eyebrow">Your next question</p>
              <ReelCards key={question.id} question={question} />
              <p className="reel-caption">Lock in. The clock starts after the reveal.</p>
            </div>
          )}

          {(screen === 'question' || screen === 'reveal') && (
            <section className="question-stage" data-boss-category={question.boss?.category}>
              <div className="clock-row">
                {question.boss ? (
                  <span>
                    <b className="boss-chip">Boss</b> {bossLabel(question.boss.category)}
                  </span>
                ) : (
                  <span>
                    {question.sport} <i>·</i> {question.category}
                  </span>
                )}
                <strong>{remainingSeconds}<small>s</small></strong>
              </div>
              <div
                className="clock-track"
                role="progressbar"
                aria-label="Time remaining"
                aria-valuemin={0}
                aria-valuemax={activeClockMs / 1000}
                aria-valuenow={remainingSeconds}
                aria-valuetext={`${remainingSeconds} seconds remaining`}
              >
                <div className="clock-fill" style={clockStyle} />
              </div>
              {screen === 'reveal' && reveal?.callouts.map((callout) => (
                <div
                  className="reveal-callout"
                  data-kind={callout.kind}
                  role="status"
                  key={`${callout.kind}-${callout.text}`}
                >
                  {callout.text}
                </div>
              ))}
              <article className="question-card">
                <p className="question-kicker">
                  {question.side === 'rules' ? 'RULEBOOK' : question.reel?.player}
                </p>
                <h2 tabIndex={-1} ref={questionHeadingRef}>
                  <span className="sr-only">Question {session.questionIndex + 1}: </span>
                  {question.prompt}
                </h2>
                {screen === 'reveal' && reveal && (reveal.picked === null || lateCorrect) && (
                  <div className="times-up">Time's up</div>
                )}
                <div className="answer-list">
                  {question.choices.map((choice, index) => (
                    <button
                      className={[
                        'answer-button',
                        picked === choice ? 'is-picked' : '',
                        screen === 'reveal' && reveal?.answer === choice
                          ? 'is-correct'
                          : '',
                        screen === 'reveal' &&
                        reveal !== null &&
                        !reveal.correct &&
                        reveal.picked === choice &&
                        choice !== reveal.answer
                          ? 'is-wrong'
                          : '',
                      ].filter(Boolean).join(' ')}
                      key={`${question.id}-${choice}`}
                      onClick={() => chooseAnswer(choice)}
                      disabled={isSubmitting || screen !== 'question'}
                      aria-keyshortcuts={
                        index < ANSWER_KEYS.length
                          ? `${ANSWER_KEYS[index].toUpperCase()} ${index + 1}`
                          : undefined
                      }
                    >
                      <span className="answer-key">
                        {String.fromCharCode(65 + index)}
                      </span>
                      {question.choiceBadges?.[index] && (
                        <Badge badge={question.choiceBadges[index]} />
                      )}
                      {choice}
                    </button>
                  ))}
                </div>
                <p className="key-hint" aria-hidden="true">
                  Press A–D or 1–4 to answer
                </p>
              </article>
            </section>
          )}

          {screen === 'mystery' && mystery && (
            <section className="mystery-stage" aria-live="polite">
              <p className="eyebrow">Boss beaten</p>
              <h2 className="mystery-title">
                {mystery.result ? 'You got:' : 'Pick a mystery box'}
              </h2>
              <div className="mystery-boxes">
                {[0, 1].map((index) => (
                  <button
                    key={index}
                    className="mystery-box"
                    data-picked={
                      mystery.picked === index
                        ? 'true'
                        : mystery.result
                          ? 'false'
                          : undefined
                    }
                    onClick={() => pickMystery(index as 0 | 1)}
                    disabled={isSubmitting || mystery.picked !== null}
                  >
                    {mystery.result
                      ? (mystery.result.prizes[index]?.label ?? '?')
                      : '?'}
                  </button>
                ))}
              </div>
              {mystery.result && (
                <button
                  className="classic-button"
                  onClick={() => continueAfterMystery()}
                >
                  Continue
                </button>
              )}
            </section>
          )}

          {screen === 'teach' && (
            <section className="teach-overlay">
              <p className="teach-prompt">{question.prompt}</p>
              <p className="teach-pick" id="teach-pick">
                {picked === null || picked === teachInfo?.answer ? (
                  "Time's up"
                ) : (
                  <>
                    Your pick:{' '}
                    {question.choiceBadges?.[question.choices.indexOf(picked)] && (
                      <Badge
                        badge={
                          question.choiceBadges[question.choices.indexOf(picked)]!
                        }
                      />
                    )}
                    {picked}
                  </>
                )}
              </p>
              <p className="teach-answer" id="teach-answer">
                Right answer:{' '}
                {question.choiceBadges?.[
                  question.choices.indexOf(teachInfo?.answer ?? '')
                ] && (
                  <Badge
                    badge={
                      question.choiceBadges[
                        question.choices.indexOf(teachInfo?.answer ?? '')
                      ]!
                    }
                  />
                )}
                {teachInfo?.answer}
              </p>
              <span id="teach-text">{teachInfo?.teach}</span>
              {teachInfo?.source && (
                <a
                  className="teach-source"
                  href={teachInfo.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Source: {teachInfo.source.ref}
                </a>
              )}
              <button
                className="classic-button"
                onClick={continueAfterTeach}
                ref={teachButtonRef}
                aria-describedby="teach-pick teach-answer teach-text"
              >
                {pendingSummary ? 'See results' : 'Continue'}
              </button>
            </section>
          )}

          {screen === 'over' && currentSummary && (
            <section className="game-over">
              <p className="eyebrow" aria-hidden="true">{resultLabel}</p>
              <h2 tabIndex={-1} ref={resultHeadingRef}>
                <span className="sr-only">{resultLabel}. Final score </span>
                {currentSummary.score.toLocaleString()}<span> pts</span>
              </h2>
              <div className="summary-grid">
                <div><strong>{currentSummary.bestStreak}</strong><span>BEST STREAK</span></div>
                <div><strong>{currentSummary.questionsAnswered}</strong><span>QUESTIONS</span></div>
                <div>
                  <strong>
                    {currentSummary.answeredCount
                      ? formatDuration(
                          currentSummary.totalAnswerMs / currentSummary.answeredCount,
                        )
                      : '—'}
                  </strong>
                  <span>AVG ANSWER</span>
                </div>
              </div>
              <ResultShare summary={currentSummary} dayStreak={dayStreak} />
              <div className="result-actions">
                {currentSummary.mode === 'daily' ? (
                  <button className="classic-button" onClick={startClassic}>Play Classic Mode</button>
                ) : (
                  <button className="classic-button" onClick={playAgain}>Play again</button>
                )}
                {currentSummary.mode === 'daily' && (
                  <button className="secondary-button" onClick={replayDaily}>Replay Daily</button>
                )}
                <button className="secondary-button" onClick={goHome}>Home</button>
              </div>
              {currentSummary.missed.length > 0 && (
                <div className="missed-list">
                  <h3>Review the misses</h3>
                  {currentSummary.missed.map((missed) => (
                    <article
                      className="missed-card"
                      key={`${missed.id}-${missed.factId}`}
                      data-boss-category={missed.side === 'boss' ? missed.category : undefined}
                    >
                      <p>{missed.side === 'boss' && <b className="boss-chip">Boss</b>}{missed.prompt}</p>
                      <strong>{missed.answer}</strong>
                      <span>{missed.teach}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>
      )}

      {screen === 'over' && !session && currentSummary && (
        <section className="game-panel game-panel--stored">
          <header className="game-header">
            <button className="back-button" onClick={goHome} aria-label="Back home"><span aria-hidden="true">←</span></button>
            <div className="game-mode-label">DAILY 10<span>SAVED RESULT · {currentSummary.date}</span></div>
            <div className="score-label"><span>SCORE</span><strong>{currentSummary.score.toLocaleString()}</strong></div>
          </header>
          <section className="game-over">
            <p className="eyebrow" aria-hidden="true">You’ve already played today</p>
            <h2 tabIndex={-1} ref={resultHeadingRef}>
              <span className="sr-only">You’ve already played today. Score </span>
              {currentSummary.score.toLocaleString()}<span> pts</span>
            </h2>
            <div className="summary-grid">
              <div><strong>{currentSummary.bestStreak}</strong><span>BEST STREAK</span></div>
              <div><strong>{currentSummary.questionsAnswered}</strong><span>QUESTIONS</span></div>
              <div>
                <strong>
                  {currentSummary.answeredCount
                    ? formatDuration(currentSummary.totalAnswerMs / currentSummary.answeredCount)
                    : '—'}
                </strong>
                <span>AVG ANSWER</span>
              </div>
            </div>
            <ResultShare summary={currentSummary} dayStreak={dayStreak} />
            <div className="result-actions">
              <button className="classic-button" onClick={startClassic}>Play Classic Mode</button>
              <button className="secondary-button" onClick={replayDaily}>Replay Daily</button>
              <button className="secondary-button" onClick={goHome}>Home</button>
            </div>
            {currentSummary.missed.length > 0 && (
              <div className="missed-list">
                <h3>Review the misses</h3>
                {currentSummary.missed.map((missed) => (
                  <article
                    className="missed-card"
                    key={`${missed.id}-${missed.factId}`}
                    data-boss-category={missed.side === 'boss' ? missed.category : undefined}
                  >
                    <p>{missed.side === 'boss' && <b className="boss-chip">Boss</b>}{missed.prompt}</p><strong>{missed.answer}</strong><span>{missed.teach}</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      )}

      <footer className="app-footer">
        <span>BUILT FOR THE LOVE OF THE GAME</span>
        <span className="app-credit">APP BY CONNORCOMET</span>
        {apiStatus === 'error' && (
          <span className="api-status api-status--error" role="status">
            Can’t reach the server
          </span>
        )}
      </footer>
    </main>
  )
}

export default App
