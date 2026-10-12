import type { AnswerResult } from './engine'
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
  results?: AnswerResult[]
  reason: 'strikes' | 'bank' | 'complete'
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const DAILY_STORAGE_PREFIX = 'streaking-sports:daily:'

function dateOffset(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

export function dailyStorageKey(date: string): string {
  return `${DAILY_STORAGE_PREFIX}${date}`
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

export function dailyStreak(storage: StorageLike, today: string): number {
  let date = readDailySummary(storage, today) ? today : dateOffset(today, -1)
  let streak = 0

  for (let day = 0; day < 366; day += 1) {
    if (!readDailySummary(storage, date)) break
    streak += 1
    date = dateOffset(date, -1)
  }

  return streak
}

export function msUntilNextUtcMidnight(nowMs: number): number {
  const now = new Date(nowMs)
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
    nowMs
  )
}
