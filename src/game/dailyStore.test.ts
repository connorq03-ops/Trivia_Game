import { describe, expect, it } from 'vitest'
import {
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
})
