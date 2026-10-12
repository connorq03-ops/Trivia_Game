import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CLOCK_MS, STRIKES, STRIKE_BACK_EVERY } from './game/engine'
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
  msUntilNextUtcMidnight,
  readDailySummary,
  saveDailySummaryIfFirst,
  type GameSummary,
} from './game/dailyStore'
import { formatCountdown } from './game/share'
import type { Question, Side, Sport } from './game/types'
import { ResultShare } from './ResultShare'
import './App.css'

const REEL_MS = 1200

type Screen =
  | 'home'
  | 'reel'
  | 'question'
  | 'reveal'
  | 'teach'
  | 'over'
  | 'connection'
  | 'serverError'
  | 'noQuestions'
type Mode = 'classic' | 'daily'

type PublicQuestion = Pick<
  Question,
  'id' | 'side' | 'sport' | 'leagues' | 'difficulty' | 'category' | 'prompt' | 'reel'
> & { choices: string[] }

type PublicProgress = {
  score: number
  strikes: number
  streak: number
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
  next: { questionIndex: number } | null
  summary: GameSummary | null
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
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function storedSummary(date: string): GameSummary | null {
  const storage = browserStorage()
  return storage ? readDailySummary(storage, date) : null
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

function elapsedSince(startedAt: number): number {
  return Math.min(CLOCK_MS, Math.max(0, performance.now() - startedAt))
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>(
    'checking',
  )
  const [sport, setSport] = useState<'all' | Sport>('all')
  const [side, setSide] = useState<'both' | Side>('both')
  const [today, setToday] = useState(utcDate)
  const [now, setNow] = useState(() => Date.now())
  const [todaySummary, setTodaySummary] = useState<GameSummary | null>(() =>
    typeof window === 'undefined' ? null : storedSummary(utcDate()),
  )
  const [dailyStorageVersion, setDailyStorageVersion] = useState(0)
  const dayStreak = useMemo(() => {
    const storage = browserStorage()
    return storage ? dailyStreak(storage, today) : 0
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
    const date = utcDate()
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
        const result = (await response.json()) as { ok: boolean }
        setApiStatus(result.ok ? 'ok' : 'error')
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
      }, msUntilNextUtcMidnight(Date.now()) + 1000)
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
    if (screen !== 'home' || !todaySummary) return
    const updateNow = () => setNow(Date.now())
    updateNow()
    const interval = window.setInterval(updateNow, 30_000)
    return () => window.clearInterval(interval)
  }, [screen, todaySummary])

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
    setIsStarting(true)
    setStartError(false)
    setSummary(null)
    setSession(null)
    setAnnouncement('')
    setPendingSummary(null)
    setPendingNextIndex(null)
    setScreen('home')
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
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
      questionClockOffset.current = 0
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
      setScreen('reel')
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
    void startRun({ mode: 'classic', sport, side })
  }

  const openDaily = () => {
    const date = utcDate()
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

  const saveDailyResult = (result: GameSummary) => {
    if (result.mode !== 'daily') return
    const storage = browserStorage()
    const winner = storage
      ? saveDailySummaryIfFirst(storage, result.date, result)
      : result
    if (result.date === utcDate()) setTodaySummary(winner)
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
      questionClockOffset.current = Math.min(
        CLOCK_MS,
        Math.max(0, result.elapsedMs),
      )
      setSession({
        ...current,
        questionIndex: result.questionIndex,
        question: result.question,
      })
      setScreen('reel')
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
      const updatedCurrent = { ...current, progress: result.progress }
      const nextIndex = result.next?.questionIndex ?? null

      setPendingRequest(null)
      setIsSubmitting(false)
      setSession(updatedCurrent)
      setSummary(result.summary)
      if (result.summary) saveDailyResult(result.summary)
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
        multiplier: result.correct
          ? multiplierLabel(current.progress.streak)
          : null,
        callouts: result.correct
          ? revealCallouts(current.progress, result.progress)
          : [],
      })
      setScreen('reveal')
      setAnnouncement(
        result.correct
          ? `Correct! Plus ${result.points}. Streak ${result.progress.streak}.`
          : `${body.choice === null || body.choice === result.answer ? 'Time’s up' : 'Wrong'}. ${
              current.mode === 'classic'
                ? `Strike ${result.progress.strikes} of ${STRIKES}.`
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
    setScreen('home')
  }

  const playAgain = () => startClassic()

  const activeQuestionId = session?.question.id

  useEffect(() => {
    if (screen !== 'reel' || !activeQuestionId) return
    const timeout = window.setTimeout(() => {
      setElapsedMs(0)
      setScreen('question')
    }, REEL_MS)
    return () => window.clearTimeout(timeout)
  }, [screen, activeQuestionId])

  useEffect(() => {
    if (screen !== 'reveal' || !reveal) return
    const timeout = window.setTimeout(() => {
      setReveal(null)
      if (!reveal.correct) {
        setScreen('teach')
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
  }, [screen, reveal, pendingSummary, pendingNextIndex, session])

  useEffect(() => {
    if (screen !== 'question' || !activeQuestionId) return
    answered.current = false
    answerStartedAt.current = performance.now() - questionClockOffset.current

    const updateClock = () => {
      const elapsed = performance.now() - answerStartedAt.current
      setElapsedMs(Math.min(CLOCK_MS, elapsed))
      if (elapsed >= CLOCK_MS) submitAnswerRef.current(null, null)
    }
    const interval = window.setInterval(updateClock, 40)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [screen, activeQuestionId])

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
        Math.round(elapsedSince(answerStartedAt.current)),
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [questionChoices])

  const chooseAnswer = (choice: string) => {
    submitAnswer(choice, Math.round(elapsedSince(answerStartedAt.current)))
  }

  const currentSummary = screen === 'over' ? summary : null
  const progress = session?.progress
  const question = session?.question
  const lateCorrect =
    reveal !== null && !reveal.correct && reveal.picked === reveal.answer
  const remainingSeconds = Math.max(0, Math.ceil((CLOCK_MS - elapsedMs) / 1000))
  const resultLabel = currentSummary
    ? currentSummary.mode === 'daily'
      ? currentSummary.reason === 'complete'
        ? 'DAILY 10 COMPLETE'
        : 'DAILY 10 · SAVED RESULT'
      : currentSummary.reason === 'strikes'
        ? 'THREE STRIKES'
        : 'QUESTION BANK CLEARED'
    : ''
  const clockStyle = {
    '--clock-progress': `${Math.max(0, 100 - (elapsedMs / CLOCK_MS) * 100)}%`,
  } as CSSProperties

  return (
    <main className="app-shell">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {screen === 'home' && (
        <section className="home-panel">
          <p className="eyebrow">Football · Basketball · Baseball trivia</p>
          <h1>Streaking Sports</h1>
          <p className="tagline">No rulebook when you’re streaking.</p>
          {startError && (
            <p className="connection-note" role="alert">
              Connection problem. Check your connection and try again.
            </p>
          )}
          <button
            className="daily-button"
            onClick={openDaily}
            disabled={isStarting}
            ref={dailyButtonRef}
          >
            <span className="daily-button-label">
              <span>{todaySummary ? 'Review today’s Daily 10' : 'Play Daily 10'}</span>
              <span className="mode-subtitle">{modeSubtitle('daily')}</span>
            </span>
            <span aria-hidden="true">→</span>
          </button>
          {todaySummary && (
            <p className="daily-meta">
              {dayStreak > 0 && <>{dayStreak}-day streak · </>}
              Next Daily in {formatCountdown(msUntilNextUtcMidnight(now))}
            </p>
          )}
          <section className="classic-panel" aria-labelledby="classic-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Make it your game</p>
                <h2 id="classic-title">Classic</h2>
                <p className="mode-subtitle">{modeSubtitle('classic')}</p>
              </div>
              <span className="mode-chip">ENDLESS RUN</span>
            </div>
            <label className="select-label">
              Sport
              <select
                value={sport}
                onChange={(event) => setSport(event.target.value as 'all' | Sport)}
              >
                <option value="all">All sports</option>
                <option value="football">Football</option>
                <option value="basketball">Basketball</option>
                <option value="baseball">Baseball</option>
              </select>
            </label>
            <label className="select-label">
              Question side
              <select
                value={side}
                onChange={(event) => setSide(event.target.value as 'both' | Side)}
              >
                <option value="both">Both</option>
                <option value="rules">Rulebook</option>
                <option value="players">Players</option>
              </select>
            </label>
            <button
              className="classic-button"
              onClick={startClassic}
              disabled={isStarting}
              ref={classicButtonRef}
            >
              Start classic <span aria-hidden="true">↗</span>
            </button>
          </section>
          <details className="how-it-works">
            <summary>How it works</summary>
            <ul>
              {howItWorks().map((line) => <li key={line}>{line}</li>)}
            </ul>
          </details>
        </section>
      )}

      {screen === 'noQuestions' && (
        <section className="home-panel">
          <p className="eyebrow">No questions available</p>
          <h1>Try another matchup</h1>
          <p className="tagline">
            There aren’t any questions for those filters yet.
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
              SS
            </button>
            <div className="game-mode-label">
              {session.mode === 'daily' ? 'DAILY 10' : 'CLASSIC'}
              {screen !== 'over' && <span>QUESTION {session.questionIndex + 1}</span>}
            </div>
            <div className="score-label">
              <span>SCORE</span>
              <strong>{progress.score.toLocaleString()}</strong>
              {screen === 'reveal' && reveal && reveal.points > 0 && (
                <span className="points-pop">+{reveal.points}</span>
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
                <div className="daily-misses">{progress.strikes} missed</div>
              )}
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

          {screen === 'reel' && (
            <div className="reel-stage">
              <p className="eyebrow">Your next question</p>
              <div className={`reel-stack ${question.side === 'players' ? 'reel-stack--player' : ''}`}>
                {question.side === 'players' ? (
                  <>
                    <div className="reel-card"><span>SEASON</span><strong>{question.reel?.season}</strong></div>
                    <div className="reel-card"><span>PLAYER</span><strong>{question.reel?.player}</strong></div>
                    <div className="reel-card"><span>CATEGORY</span><strong>{question.category}</strong></div>
                  </>
                ) : (
                  <>
                    <div className="reel-card"><span>SPORT</span><strong>{question.sport}</strong></div>
                    <div className="reel-card"><span>CATEGORY</span><strong>{question.category}</strong></div>
                  </>
                )}
              </div>
              <p className="reel-caption">Lock in. The clock starts after the reveal.</p>
            </div>
          )}

          {(screen === 'question' || screen === 'reveal') && (
            <section className="question-stage">
              <div className="clock-row">
                <span>{question.sport} <i>·</i> {question.category}</span>
                <strong>{remainingSeconds}<small>s</small></strong>
              </div>
              <div
                className="clock-track"
                role="progressbar"
                aria-label="Time remaining"
                aria-valuemin={0}
                aria-valuemax={CLOCK_MS / 1000}
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
                      <span>{String.fromCharCode(65 + index)}</span>
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

          {screen === 'teach' && (
            <section className="teach-overlay">
              <p className="teach-prompt">{question.prompt}</p>
              <p className="teach-pick" id="teach-pick">
                {picked === null || picked === teachInfo?.answer
                  ? "Time's up"
                  : `Your pick: ${picked}`}
              </p>
              <p className="teach-answer" id="teach-answer">Right answer: {teachInfo?.answer}</p>
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
              {currentSummary.missed.length > 0 && (
                <div className="missed-list">
                  <h3>Review the misses</h3>
                  {currentSummary.missed.map((missed) => (
                    <article className="missed-card" key={`${missed.id}-${missed.factId}`}>
                      <p>{missed.prompt}</p>
                      <strong>{missed.answer}</strong>
                      <span>{missed.teach}</span>
                    </article>
                  ))}
                </div>
              )}
              <div className="result-actions">
                {currentSummary.mode === 'daily' ? (
                  <button className="classic-button" onClick={startClassic}>Play Classic</button>
                ) : (
                  <button className="classic-button" onClick={playAgain}>Play again</button>
                )}
                <button className="secondary-button" onClick={goHome}>Home</button>
              </div>
            </section>
          )}
        </section>
      )}

      {screen === 'over' && !session && currentSummary && (
        <section className="game-panel game-panel--stored">
          <header className="game-header">
            <button className="back-button" onClick={goHome} aria-label="Back home">SS</button>
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
            {currentSummary.missed.length > 0 && (
              <div className="missed-list">
                <h3>Review the misses</h3>
                {currentSummary.missed.map((missed) => (
                  <article className="missed-card" key={`${missed.id}-${missed.factId}`}>
                    <p>{missed.prompt}</p><strong>{missed.answer}</strong><span>{missed.teach}</span>
                  </article>
                ))}
              </div>
            )}
            <div className="result-actions">
              <button className="classic-button" onClick={startClassic}>Play Classic</button>
              <button className="secondary-button" onClick={goHome}>Home</button>
            </div>
          </section>
        </section>
      )}

      <footer className="app-footer">
        <span>BUILT FOR THE LOVE OF THE GAME</span>
        <span className={`api-status api-status--${apiStatus}`} role="status">
          API · {apiStatus}
        </span>
      </footer>
    </main>
  )
}

export default App
