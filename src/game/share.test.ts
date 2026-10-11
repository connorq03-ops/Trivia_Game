import { describe, expect, it } from 'vitest'
import type { GameSummary } from './dailyStore'
import { buildShareText, formatCountdown, resultSquares, SHARE_URL } from './share'

function summary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    mode: 'daily',
    date: '2027-02-03',
    score: 1234,
    bestStreak: 4,
    questionsAnswered: 3,
    answeredCount: 3,
    totalAnswerMs: 6000,
    missed: [],
    results: ['hit', 'miss', 'timeout'],
    reason: 'complete',
    ...overrides,
  }
}

describe('share helpers', () => {
  it('maps answer results to share squares', () => {
    expect(resultSquares(['hit', 'miss', 'timeout'])).toBe('🟩🟥⬛')
  })

  it.each([
    [11_100_000, '3h 5m'],
    [3_540_000, '59m'],
    [59_999, '<1m'],
  ])('formats %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatCountdown(milliseconds)).toBe(expected)
  })

  it('builds exact Daily share text with a day streak', () => {
    expect(buildShareText(summary(), 7)).toBe(
      [
        'Streaking Sports Daily 10 · 2027-02-03',
        '🟩🟥⬛',
        '1,234 pts · Best streak 4 · 🔥 7-day streak',
        SHARE_URL,
      ].join('\n'),
    )
  })

  it('builds Classic text without a date or Daily streak', () => {
    expect(buildShareText(summary({ mode: 'classic' }), 7)).toBe(
      [
        'Streaking Sports Classic',
        '🟩🟥⬛',
        '1,234 pts · Best streak 4',
        SHARE_URL,
      ].join('\n'),
    )
  })

  it('omits the squares line for a legacy summary without results', () => {
    expect(buildShareText(summary({ results: undefined }), 0)).toBe(
      [
        'Streaking Sports Daily 10 · 2027-02-03',
        '1,234 pts · Best streak 4',
        SHARE_URL,
      ].join('\n'),
    )
  })

  it('ends the share text with the share URL', () => {
    expect(buildShareText(summary(), 0).split('\n').at(-1)).toBe(SHARE_URL)
  })
})
