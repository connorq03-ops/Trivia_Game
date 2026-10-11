import type { Question } from './types'

export type GameSummary = {
  mode: 'classic' | 'daily'
  date: string
  score: number
  bestStreak: number
  questionsAnswered: number
  answeredCount: number
  totalAnswerMs: number
  missed: Question[]
  reason: 'strikes' | 'bank' | 'complete'
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function dailyStorageKey(date: string): string {
  return `streaking-sports:daily:${date}`
}

export function readDailySummary(
  storage: StorageLike,
  date: string,
): GameSummary | null {
  try {
    const value = storage.getItem(dailyStorageKey(date))
    return value ? (JSON.parse(value) as GameSummary) : null
  } catch {
    return null
  }
}

export function saveDailySummaryIfFirst(
  storage: StorageLike,
  date: string,
  result: GameSummary,
): GameSummary {
  const existing = readDailySummary(storage, date)
  if (existing) return existing
  try {
    storage.setItem(dailyStorageKey(date), JSON.stringify(result))
  } catch {
    return result
  }
  return result
}

export function msUntilNextUtcMidnight(nowMs: number): number {
  const now = new Date(nowMs)
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
    nowMs
  )
}
