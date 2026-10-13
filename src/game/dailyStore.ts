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

// The Daily 10 resets at 5pm Central: a new "daily date" goes live at
// DAILY_RESET_HOUR_CT each day in DAILY_RESET_ZONE, so the day boundary is
// wherever CT wall time says it is (handles CDT/CST automatically).
export const DAILY_RESET_ZONE = 'America/Chicago'
export const DAILY_RESET_HOUR_CT = 17

const dailyClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DAILY_RESET_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

// CT wall-clock time of `ms`, expressed as if it were a UTC timestamp.
// (Intl can report midnight as hour 24 for the *previous* day; normalize.)
function chicagoWallMs(ms: number): number {
  const parts = dailyClockFormat.formatToParts(ms)
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0)
  const hour = part('hour') % 24
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    hour,
    part('minute'),
    part('second'),
  )
  return part('hour') === 24 ? wall + 86_400_000 : wall
}

function wallToDate(wallMs: number): string {
  const date = new Date(wallMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

// The Daily 10 "date" for a given instant: the CT calendar date of the
// 5pm-anchored day, i.e. today CT once it's past 5pm, else yesterday CT.
export function dailyDateKey(nowMs: number = Date.now()): string {
  return wallToDate(chicagoWallMs(nowMs - DAILY_RESET_HOUR_CT * 3_600_000))
}

export function msUntilNextDailyReset(nowMs: number): number {
  const nowWall = chicagoWallMs(nowMs)
  const dayStart = wallMsDayStart(nowWall)
  let targetWall = dayStart + DAILY_RESET_HOUR_CT * 3_600_000
  if (targetWall <= nowWall) targetWall += 86_400_000
  // CT wall -> UTC needs the zone offset; compute it at `now`, then fix up
  // once in case the target sits on the other side of a DST transition.
  let candidate = targetWall - (nowWall - nowMs)
  const drift = targetWall - chicagoWallMs(candidate)
  if (drift !== 0) candidate += drift
  return candidate - nowMs
}

function wallMsDayStart(wallMs: number): number {
  const date = new Date(wallMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}
