import { describe, expect, it } from 'vitest'
import {
  dailyStreak,
  dailyStorageKey,
  dailyDateKey,
  isCurrentDailySummary,
  msUntilNextDailyReset,
  readDailySummary,
  saveDailySummary,
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
    schedule: 'ct17',
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

    expect(saveDailySummary(storage, first.date, first)).toEqual(first)
    expect(JSON.parse(values.get(dailyStorageKey(first.date)) ?? 'null')).toEqual(
      first,
    )
  })

  it('keeps the first result when concurrent runs finish later', () => {
    const { storage } = makeStorage()
    const first = result(100)
    const second = result(200)

    saveDailySummary(storage, first.date, first)

    expect(saveDailySummary(storage, second.date, second)).toEqual(first)
    expect(readDailySummary(storage, first.date)).toEqual(first)
  })

  it('returns null for corrupt JSON', () => {
    const { storage, values } = makeStorage()
    values.set(dailyStorageKey('2026-06-01'), '{')

    expect(readDailySummary(storage, '2026-06-01')).toBeNull()
  })

  it('keeps the new Daily playable when a UTC-era summary shares its key', () => {
    const { storage, values } = makeStorage()
    // A summary written before the 5pm-CT rollout has no schedule tag.
    const legacy = result(100)
    delete legacy.schedule
    values.set(dailyStorageKey(legacy.date), JSON.stringify(legacy))

    expect(isCurrentDailySummary(legacy)).toBe(false)

    const fresh = result(200)
    expect(saveDailySummary(storage, fresh.date, fresh)).toEqual(fresh)
    expect(readDailySummary(storage, fresh.date)).toEqual(fresh)
  })

  it('treats a stale-deal summary as unplayed and lets the new deal overwrite it', () => {
    const { storage, values } = makeStorage()
    const stale = { ...result(100), deal: 'old-deal' }
    values.set(dailyStorageKey(stale.date), JSON.stringify(stale))

    expect(isCurrentDailySummary(stale, 'new-deal')).toBe(false)
    expect(isCurrentDailySummary(stale, 'old-deal')).toBe(true)

    const fresh = { ...result(200), deal: 'new-deal' }
    expect(saveDailySummary(storage, fresh.date, fresh)).toEqual(fresh)
    expect(readDailySummary(storage, fresh.date)).toEqual(fresh)

    // A replay of the same deal still can't overwrite the first result.
    const replay = { ...result(300), deal: 'new-deal' }
    expect(saveDailySummary(storage, replay.date, replay)).toEqual(fresh)

    // The stale deal doesn't count today toward the streak.
    values.set(dailyStorageKey(stale.date), JSON.stringify(stale))
    expect(dailyStreak(storage, stale.date, 'new-deal')).toBe(0)
    expect(dailyStreak(storage, stale.date, 'old-deal')).toBe(1)
  })

  it('labels the daily date by the 5pm Central reset', () => {
    // 4:54pm CT on Oct 13 (CDT, UTC-5) -> still the previous daily date.
    expect(dailyDateKey(Date.parse('2026-10-13T21:54:00.000Z'))).toBe(
      '2026-10-12',
    )
    // 5:00pm CT on Oct 13 -> the Oct 13 daily goes live.
    expect(dailyDateKey(Date.parse('2026-10-13T22:00:00.000Z'))).toBe(
      '2026-10-13',
    )
    // Same wall time in CST (UTC-6): 4:54pm vs 5:00pm CT on Dec 1.
    expect(dailyDateKey(Date.parse('2026-12-01T22:54:00.000Z'))).toBe(
      '2026-11-30',
    )
    expect(dailyDateKey(Date.parse('2026-12-01T23:00:00.000Z'))).toBe(
      '2026-12-01',
    )
    // Spring DST: Mar 8 2026, 22:00Z is 5pm CDT — the Mar 8 daily is live.
    expect(dailyDateKey(Date.parse('2026-03-08T22:00:00.000Z'))).toBe(
      '2026-03-08',
    )
    // One minute earlier is 4:59pm CDT — still the Mar 7 daily.
    expect(dailyDateKey(Date.parse('2026-03-08T21:59:00.000Z'))).toBe(
      '2026-03-07',
    )
  })

  it('calculates the delay to the next 5pm Central reset', () => {
    // 4:00pm CT on Oct 13 (CDT) -> 1 hour until the 5pm reset.
    expect(
      msUntilNextDailyReset(Date.parse('2026-10-13T21:00:00.000Z')),
    ).toBe(3_600_000)
    // Right at 5pm CT -> a full day until the next reset.
    expect(
      msUntilNextDailyReset(Date.parse('2026-10-13T22:00:00.000Z')),
    ).toBe(86_400_000)
    // 4:30pm CT on Dec 1 (CST, UTC-6) -> 30 minutes.
    expect(
      msUntilNextDailyReset(Date.parse('2026-12-01T22:30:00.000Z')),
    ).toBe(1_800_000)
    // Spring DST morning: 3pm CDT Mar 8 -> 2 hours until the 5pm reset.
    expect(
      msUntilNextDailyReset(Date.parse('2026-03-08T20:00:00.000Z')),
    ).toBe(7_200_000)
    // Fall-back morning: 4pm CST Nov 1 -> 1 hour until the 5pm reset.
    expect(
      msUntilNextDailyReset(Date.parse('2026-11-01T22:00:00.000Z')),
    ).toBe(3_600_000)
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

  it('does not count an untagged today toward the streak until it is played', () => {
    const { storage, values } = makeStorage()
    const legacy = result(100)
    delete legacy.schedule
    values.set(dailyStorageKey(legacy.date), JSON.stringify(legacy))

    // UTC-era summary under today's key: playable but not yet counted.
    expect(dailyStreak(storage, legacy.date)).toBe(0)

    // After the daily is finished the tagged result lands on the streak.
    saveDailySummary(storage, legacy.date, { ...legacy, schedule: 'ct17' })
    expect(dailyStreak(storage, legacy.date)).toBe(1)
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
