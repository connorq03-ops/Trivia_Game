import type { AnswerResult } from './engine'
import type { GameSummary } from './dailyStore'

// Swap to https://streakingsports.com once the domain is live.
export const SHARE_URL = 'https://streaking-sports.vercel.app'
export const MAX_SHARE_SQUARES = 30

export function resultSquares(results: AnswerResult[]): string {
  return results
    .map((result) =>
      result === 'hit' ? '🟩' : result === 'miss' ? '🟥' : '⬛',
    )
    .join('')
}

export function formatCountdown(ms: number): string {
  if (ms < 60_000) return '<1m'
  const totalMinutes = Math.floor(ms / 60_000)
  if (ms < 3_600_000) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

export function buildShareText(
  summary: GameSummary,
  dayStreak: number,
): string {
  const lines = [
    summary.mode === 'daily'
      ? `Streaking Sports Daily 10 · ${summary.date}`
      : 'Streaking Sports Classic',
  ]
  if (
    summary.results?.length &&
    summary.results.length <= MAX_SHARE_SQUARES
  ) {
    lines.push(resultSquares(summary.results))
  }

  let meta = `${summary.score.toLocaleString('en-US')} pts · Best streak ${summary.bestStreak}`
  if (summary.mode === 'daily' && dayStreak > 0) {
    meta += ` · 🔥 ${dayStreak}-day streak`
  }
  lines.push(meta, SHARE_URL)

  return lines.join('\n')
}
