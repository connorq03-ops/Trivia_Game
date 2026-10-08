import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  answerQuestion,
  CLOCK_MS,
  createRunProgress,
  dailyQuestions,
  selectClassicQuestion,
  STRIKES,
  type ClassicOptions,
  type RunProgress,
} from './game/engine'
import { questionBank } from './game/content'
import type { Question, Side, Sport } from './game/types'
import './App.css'

const REEL_MS = 1200
const DAILY_STORAGE_KEY = 'streaking-sports:daily:'

type Screen = 'home' | 'reel' | 'question' | 'teach' | 'over'
type Mode = 'classic' | 'daily'
type EndReason = 'strikes' | 'bank' | 'complete'

type GameSession = {
  mode: Mode
  runId: string
  date: string
  progress: RunProgress
  questionIndex: number
  question: Question
  choices: string[]
  classicOptions: ClassicOptions
  usedFactIds: string[]
  dailyQuestions: Question[]
}

type GameSummary = {
  mode: Mode
  date: string
  score: number
  bestStreak: number
  questionsAnswered: number
  answeredCount: number
  totalAnswerMs: number
  missed: Question[]
  reason: EndReason
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function dailyStorageKey(date: string): string {
  return `${DAILY_STORAGE_KEY}${date}`
}

function readDailySummary(date: string): GameSummary | null {
  try {
    const value = window.localStorage.getItem(dailyStorageKey(date))
    return value ? (JSON.parse(value) as GameSummary) : null
  } catch {
    return null
  }
}

function shuffleChoices(question: Question): string[] {
  const choices = [question.answer, ...question.wrong]
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[choices[index], choices[other]] = [choices[other], choices[index]]
  }
  return choices
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

function elapsedSince(startedAt: number): number {
  return Math.min(CLOCK_MS, performance.now() - startedAt)
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>(
    'checking',
  )
  const [sport, setSport] = useState<'all' | Sport>('all')
  const [side, setSide] = useState<'both' | Side>('both')
  const [today] = useState(utcDate)
  const [todaySummary, setTodaySummary] = useState<GameSummary | null>(() =>
    typeof window === 'undefined' ? null : readDailySummary(utcDate()),
  )
  const [session, setSession] = useState<GameSession | null>(null)
  const [summary, setSummary] = useState<GameSummary | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const answerStartedAt = useRef(0)
  const answered = useRef(false)
  const submitAnswerRef = useRef<(correct: boolean, elapsed: number | null) => void>(
    () => {},
  )
  const continueAfterTeachRef = useRef<() => void>(() => {})

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

  const finishRun = (completed: GameSession, reason: EndReason) => {
    const result: GameSummary = {
      mode: completed.mode,
      date: completed.date,
      score: completed.progress.score,
      bestStreak: completed.progress.bestStreak,
      questionsAnswered: completed.progress.questionsAnswered,
      answeredCount: completed.progress.answeredCount,
      totalAnswerMs: completed.progress.totalAnswerMs,
      missed: completed.progress.missed,
      reason,
    }
    setSummary(result)
    setSession(completed)
    setScreen('over')
    if (completed.mode === 'daily') {
      try {
        window.localStorage.setItem(
          dailyStorageKey(completed.date),
          JSON.stringify(result),
        )
      } catch {
        // The result still remains available in memory.
      }
      if (completed.date === today) setTodaySummary(result)
    }
  }

  const showNextQuestion = (current: GameSession) => {
    if (current.mode === 'classic') {
      const selection = selectClassicQuestion(
        questionBank,
        new Set(current.usedFactIds),
        current.progress.questionsAnswered + 1,
        current.classicOptions,
        Math.random,
      )
      if (selection.type === 'end') {
        finishRun(current, 'bank')
        return
      }
      const next: GameSession = {
        ...current,
        questionIndex: current.questionIndex + 1,
        question: selection.question,
        choices: selection.choices,
        usedFactIds: [...current.usedFactIds, selection.question.factId],
      }
      setSession(next)
      setScreen('reel')
      return
    }

    const nextIndex = current.questionIndex + 1
    if (nextIndex >= current.dailyQuestions.length) {
      finishRun(current, 'complete')
      return
    }
    const question = current.dailyQuestions[nextIndex]
    setSession({
      ...current,
      questionIndex: nextIndex,
      question,
      choices: shuffleChoices(question),
    })
    setScreen('reel')
  }

  const continueAfterTeach = () => {
    if (!session) {
      setScreen('over')
      return
    }
    if (session.mode === 'classic' && session.progress.strikes >= STRIKES) {
      finishRun(session, 'strikes')
      return
    }
    showNextQuestion(session)
  }
  const submitAnswer = (isCorrect: boolean, elapsed: number | null) => {
    if (!session || screen !== 'question' || answered.current) return
    answered.current = true
    const outcome = answerQuestion(
      session.progress,
      session.question,
      isCorrect,
      elapsed,
    )
    const updatedSession = { ...session, progress: outcome.progress }
    setSession(updatedSession)
    void fetch('/api/answers', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: session.runId,
        mode: session.mode,
        questionId: session.question.id,
        questionIndex: session.questionIndex,
        answerMs: outcome.answerMs,
        correct: outcome.correct,
      }),
    }).catch(() => {})

    if (!outcome.correct) {
      setScreen('teach')
      return
    }
    if (session.mode === 'classic' && outcome.endReason === 'strikes') {
      finishRun(updatedSession, 'strikes')
      return
    }
    showNextQuestion(updatedSession)
  }
  useEffect(() => {
    continueAfterTeachRef.current = continueAfterTeach
  })

  useEffect(() => {
    submitAnswerRef.current = submitAnswer
  })

  const startClassic = () => {
    const options = { sport, side }
    const selection = selectClassicQuestion(
      questionBank,
      new Set(),
      1,
      options,
      Math.random,
    )
    if (selection.type === 'end') {
      finishRun(
        {
          mode: 'classic',
          runId: crypto.randomUUID(),
          date: today,
          progress: createRunProgress(),
          questionIndex: 0,
          question: questionBank[0],
          choices: [],
          classicOptions: options,
          usedFactIds: [],
          dailyQuestions: [],
        },
        'bank',
      )
      return
    }
    setSummary(null)
    setSession({
      mode: 'classic',
      runId: crypto.randomUUID(),
      date: today,
      progress: createRunProgress(),
      questionIndex: 0,
      question: selection.question,
      choices: selection.choices,
      classicOptions: options,
      usedFactIds: [selection.question.factId],
      dailyQuestions: [],
    })
    setScreen('reel')
  }

  const openDaily = () => {
    const previous = readDailySummary(today)
    if (previous) {
      setTodaySummary(previous)
      setSummary(previous)
      setScreen('over')
      return
    }

    const questions = dailyQuestions(today, questionBank)
    const question = questions[0]
    setSummary(null)
    setSession({
      mode: 'daily',
      runId: crypto.randomUUID(),
      date: today,
      progress: createRunProgress(),
      questionIndex: 0,
      question,
      choices: shuffleChoices(question),
      classicOptions: { sport: 'all', side: 'both' },
      usedFactIds: [],
      dailyQuestions: questions,
    })
    setScreen('reel')
  }

  const goHome = () => {
    setSession(null)
    setSummary(null)
    setScreen('home')
  }

  const playAgain = () => {
    if (summary?.mode === 'daily') {
      openDaily()
    } else {
      startClassic()
    }
  }

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
    if (screen !== 'teach') return
    const timeout = window.setTimeout(
      () => continueAfterTeachRef.current(),
      2500,
    )
    return () => window.clearTimeout(timeout)
  }, [screen, session?.questionIndex])

  useEffect(() => {
    if (screen !== 'question' || !activeQuestionId) return
    answered.current = false
    answerStartedAt.current = performance.now()

    const updateClock = () => {
      const elapsed = performance.now() - answerStartedAt.current
      setElapsedMs(Math.min(CLOCK_MS, elapsed))
      if (elapsed >= CLOCK_MS) submitAnswerRef.current(false, null)
    }
    const interval = window.setInterval(updateClock, 40)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [screen, activeQuestionId])

  const chooseAnswer = (choice: string) => {
    const elapsed = elapsedSince(answerStartedAt.current)
    submitAnswer(choice === session?.question.answer, elapsed)
  }

  const currentSummary = screen === 'over' ? summary : null
  const progress = session?.progress
  const question = session?.question
  const remainingSeconds = Math.max(0, Math.ceil((CLOCK_MS - elapsedMs) / 1000))
  const clockStyle = {
    '--clock-progress': `${Math.max(0, 100 - (elapsedMs / CLOCK_MS) * 100)}%`,
  } as CSSProperties

  return (
    <main className="app-shell">
      {screen === 'home' && (
        <section className="home-panel">
          <p className="eyebrow">Football · Basketball · Baseball trivia</p>
          <h1>Streaking Sports</h1>
          <p className="tagline">No rulebook when you’re streaking.</p>
          <button className="daily-button" onClick={openDaily}>
            <span>{todaySummary ? 'Review today’s Daily 10' : 'Play Daily 10'}</span>
            <span aria-hidden="true">→</span>
          </button>
          <section className="classic-panel" aria-labelledby="classic-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Make it your game</p>
                <h2 id="classic-title">Classic</h2>
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
            <button className="classic-button" onClick={startClassic}>
              Start classic <span aria-hidden="true">↗</span>
            </button>
          </section>
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
              <span>QUESTION {session.questionIndex + 1}</span>
            </div>
            <div className="score-label">
              <span>SCORE</span>
              <strong>{progress.score.toLocaleString()}</strong>
            </div>
          </header>

          <div className="game-stats">
            <div className="strike-group" aria-label={`${progress.strikes} strikes`}>
              {[0, 1, 2].map((strike) => (
                <span
                  className={`strike-slot ${strike < progress.strikes ? 'is-active' : ''}`}
                  key={strike}
                >
                  K
                </span>
              ))}
            </div>
            <div
              className="streak-ring"
              aria-label={`${progress.streak} streak, strike back at 15`}
            >
              <span>{progress.streak}</span>
              <small>/15</small>
            </div>
          </div>

          {screen === 'reel' && (
            <div className="reel-stage" aria-live="polite">
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

          {screen === 'question' && (
            <section className="question-stage">
              <div className="clock-row">
                <span>{question.sport} <i>·</i> {question.category}</span>
                <strong>{remainingSeconds}<small>s</small></strong>
              </div>
              <div className="clock-track" aria-label={`${remainingSeconds} seconds remaining`}>
                <div className="clock-fill" style={clockStyle} />
              </div>
              <article className="question-card">
                <p className="question-kicker">
                  {question.side === 'rules' ? 'RULEBOOK' : question.reel?.player}
                </p>
                <h2>{question.prompt}</h2>
                <div className="answer-list">
                  {session.choices.map((choice, index) => (
                    <button
                      className="answer-button"
                      key={`${question.id}-${choice}`}
                      onClick={() => chooseAnswer(choice)}
                    >
                      <span>{String.fromCharCode(65 + index)}</span>
                      {choice}
                    </button>
                  ))}
                </div>
              </article>
            </section>
          )}

          {screen === 'teach' && (
            <button className="teach-overlay" onClick={continueAfterTeach}>
              <span className="teach-label">THE RIGHT ANSWER</span>
              <strong>{question.answer}</strong>
              <span>{question.teach}</span>
              <small>Tap to continue · auto-continues in 2.5s</small>
            </button>
          )}

          {screen === 'over' && currentSummary && (
            <section className="game-over">
              <p className="eyebrow">
                {currentSummary.mode === 'daily'
                  ? currentSummary.reason === 'complete'
                    ? 'DAILY 10 COMPLETE'
                    : 'DAILY 10 · SAVED RESULT'
                  : currentSummary.reason === 'strikes'
                    ? 'THREE STRIKES'
                    : 'QUESTION BANK CLEARED'}
              </p>
              <h2>{currentSummary.score.toLocaleString()}<span> pts</span></h2>
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
                <button className="classic-button" onClick={playAgain}>Play again</button>
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
            <p className="eyebrow">You’ve already played today</p>
            <h2>{currentSummary.score.toLocaleString()}<span> pts</span></h2>
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
              <button className="classic-button" onClick={openDaily}>View result</button>
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
