import { describe, expect, it } from 'vitest'
import {
  dailyStreak,
  dailyStorageKey,
  msUntilNextUtcMidnight,
  readDailySummary,
  saveDailySummaryIfFirst,
  type GameSummary,
} from './dailyStore'

function makeStorage() {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  }
}

function result(score: number): GameSummary {
  return {
    mode: 'daily',
    date: '2026-06-01',
    score,
    bestStreak: 0,
    questionsAnswered: 10,
    answeredCount: 10,
    totalAnswerMs: 10000,
    missed: [],
    reason: 'complete',
  }
}

describe('daily store', () => {
  it('stores and returns the first result', () => {
    const { storage, values } = makeStorage()
    const first = result(100)

    expect(saveDailySummaryIfFirst(storage, first.date, first)).toEqual(first)
    expect(JSON.parse(values.get(dailyStorageKey(first.date)) ?? 'null')).toEqual(
      first,
    )
  })

  it('keeps the first result when concurrent runs finish later', () => {
    const { storage } = makeStorage()
    const first = result(100)
    const second = result(200)

    saveDailySummaryIfFirst(storage, first.date, first)

    expect(saveDailySummaryIfFirst(storage, second.date, second)).toEqual(first)
    expect(readDailySummary(storage, first.date)).toEqual(first)
  })

  it('returns null for corrupt JSON', () => {
    const { storage, values } = makeStorage()
    values.set(dailyStorageKey('2026-06-01'), '{')

    expect(readDailySummary(storage, '2026-06-01')).toBeNull()
  })

  it('calculates the next UTC midnight delay', () => {
    expect(
      msUntilNextUtcMidnight(Date.parse('2026-06-01T23:59:59.000Z')),
    ).toBe(1000)
    expect(
      msUntilNextUtcMidnight(Date.parse('2026-06-02T00:00:00.000Z')),
    ).toBe(86_400_000)
  })

  it('counts consecutive Daily summaries and stops at gaps or corrupt entries', () => {
    const { storage, values } = makeStorage()

    expect(dailyStreak(storage, '2026-06-03')).toBe(0)

    values.set(dailyStorageKey('2026-06-03'), JSON.stringify(result(100)))
    expect(dailyStreak(storage, '2026-06-03')).toBe(1)

    values.set(dailyStorageKey('2026-06-02'), JSON.stringify(result(100)))
    values.set(dailyStorageKey('2026-06-01'), JSON.stringify(result(100)))
    expect(dailyStreak(storage, '2026-06-03')).toBe(3)

    values.delete(dailyStorageKey('2026-06-02'))
    expect(dailyStreak(storage, '2026-06-03')).toBe(1)

    values.delete(dailyStorageKey('2026-06-03'))
    expect(dailyStreak(storage, '2026-06-03')).toBe(0)
  })

  it('keeps a streak alive through today until a full day is missed', () => {
    const { storage, values } = makeStorage()
    values.set(dailyStorageKey('2026-06-02'), JSON.stringify(result(100)))
    values.set(dailyStorageKey('2026-06-01'), JSON.stringify(result(100)))

    expect(dailyStreak(storage, '2026-06-03')).toBe(2)
  })

  it('walks across month and year boundaries and stops on corrupt JSON', () => {
    const { storage, values } = makeStorage()
    values.set(dailyStorageKey('2027-01-01'), JSON.stringify(result(100)))
    values.set(dailyStorageKey('2026-12-31'), JSON.stringify(result(100)))
    expect(dailyStreak(storage, '2027-01-01')).toBe(2)

    values.set(dailyStorageKey('2026-12-31'), '{')
    expect(dailyStreak(storage, '2027-01-01')).toBe(1)
  })
})
