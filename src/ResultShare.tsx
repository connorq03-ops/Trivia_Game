import { useEffect, useRef, useState } from 'react'
import { msUntilNextUtcMidnight, type GameSummary } from './game/dailyStore'
import { buildShareText, formatCountdown, resultSquares } from './game/share'

export function ResultShare({
  summary,
  dayStreak,
}: {
  summary: GameSummary
  dayStreak: number
}) {
  const [now, setNow] = useState(() => Date.now())
  const [status, setStatus] = useState('')
  const statusTimeout = useRef<number | null>(null)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(
    () => () => {
      if (statusTimeout.current !== null) {
        window.clearTimeout(statusTimeout.current)
      }
    },
    [],
  )

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied!')
      if (statusTimeout.current !== null) {
        window.clearTimeout(statusTimeout.current)
      }
      statusTimeout.current = window.setTimeout(() => setStatus(''), 2_000)
    } catch {
      setStatus("Couldn't share")
    }
  }

  const share = async () => {
    const text = buildShareText(summary, dayStreak)
    if (statusTimeout.current !== null) {
      window.clearTimeout(statusTimeout.current)
      statusTimeout.current = null
    }
    setStatus('')
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError'
        ) {
          return
        }
        await copyToClipboard(text)
      }
      return
    }
    await copyToClipboard(text)
  }

  const squares = summary.results?.length
    ? resultSquares(summary.results)
    : null
  const hits = summary.results?.filter((result) => result === 'hit').length ?? 0

  return (
    <div className="result-share">
      {squares && (
        <p
          className="result-squares"
          aria-label={`${hits} of ${summary.results?.length} correct`}
        >
          {squares}
        </p>
      )}
      <p className="result-meta">
        {dayStreak > 0 && <>🔥 {dayStreak}-day streak · </>}
        Next Daily in {formatCountdown(msUntilNextUtcMidnight(now))}
      </p>
      <button
        className="secondary-button result-share-button"
        type="button"
        onClick={() => void share()}
      >
        Share
      </button>
      <span aria-live="polite">{status}</span>
    </div>
  )
}
