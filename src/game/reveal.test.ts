import { describe, expect, it } from 'vitest'
import {
  BOSS_CLOCK_MS,
  CLOCK_MS,
  LEVELS,
  MULTIPLIER_TIERS,
  STRIKES,
  STRIKE_BACK_EVERY,
} from './engine'
import {
  difficultyLabel,
  howItWorks,
  modeSubtitle,
  multiplierLabel,
  revealCallouts,
  streakFill,
  strikeLabel,
} from './reveal'

describe('howItWorks', () => {
  it('explains the game using the configured timing, strikes, and multiplier tiers', () => {
    const lines = howItWorks()
    const tiers = [...MULTIPLIER_TIERS].sort((left, right) => left.streak - right.streak)
    const joinWithAnd = (values: string[]) =>
      `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`
    const streaks = joinWithAnd(tiers.map((tier) => String(tier.streak)))
    const multipliers = joinWithAnd(tiers.map((tier) => `×${tier.multiplier}`))
    const levelSteps = joinWithAnd(LEVELS.slice(1).map((level) => String(level.minCorrect)))

    expect(lines[0]).toContain(`${CLOCK_MS / 1000} seconds`)
    expect(lines).toEqual([
      `You get ${CLOCK_MS / 1000} seconds per question. Faster answers score more.`,
      `Classic: ${STRIKES} strikes and your run is over.`,
      `Get ${STRIKE_BACK_EVERY} in a row to clear a strike.`,
      `Streaks of ${streaks} multiply your points by ${multipliers}.`,
      `Classic starts easy and levels up at ${levelSteps} correct answers. Harder questions score more.`,
      `Each level-up brings a boss question on science, history, art or pop culture: ${BOSS_CLOCK_MS / 1000} seconds, +500 if right, −250 if wrong, no strike.`,
      'Daily 10: the same 10 questions for everyone today, easy to hard. No strikes.',
    ])
  })
})

describe('modeSubtitle', () => {
  it('describes classic and daily modes', () => {
    expect(modeSubtitle('classic')).toBe(`Endless run. ${STRIKES} strikes and you're out.`)
    expect(modeSubtitle('daily')).toBe('Same 10 questions for everyone today.')
  })
})

describe('multiplierLabel', () => {
  it('returns no label until a multiplier tier is reached', () => {
    expect(multiplierLabel(9)).toBeNull()
    expect(multiplierLabel(10)).toBe('×1.25')
    expect(multiplierLabel(30)).toBe('×2')
  })
})

describe('revealCallouts', () => {
  it('announces a multiplier when the streak reaches a tier', () => {
    expect(
      revealCallouts(
        { streak: 9, strikes: 0 },
        { streak: 10, strikes: 0 },
      ),
    ).toEqual([{ kind: 'multiplier', text: '×1.25 points!' }])
  })

  it('announces a strike clear on the strike-back milestone', () => {
    expect(
      revealCallouts(
        { streak: 14, strikes: 1 },
        { streak: 15, strikes: 0 },
      ),
    ).toEqual([{ kind: 'strikeCleared', text: 'Strike cleared!' }])
  })

  it('does not announce a strike clear when there were no strikes', () => {
    expect(
      revealCallouts(
        { streak: 14, strikes: 0 },
        { streak: 15, strikes: 0 },
      ),
    ).toEqual([])
  })

  it('only announces exact, increasing multiplier tiers', () => {
    expect(
      revealCallouts(
        { streak: 15, strikes: 0 },
        { streak: 16, strikes: 0 },
      ),
    ).toEqual([])
    expect(
      revealCallouts(
        { streak: 10, strikes: 0 },
        { streak: 10, strikes: 0 },
      ),
    ).toEqual([])
  })
})

describe('level callouts', () => {
  it('announces a new level only in Classic when correct answers cross a threshold', () => {
    const before = { streak: 3, strikes: 0, correct: 9 }
    const after = { streak: 4, strikes: 0, correct: 10 }
    expect(revealCallouts(before, after, { levels: true })).toEqual([
      { kind: 'levelUp', text: 'Level 2! Tougher questions ahead.' },
    ])
    expect(revealCallouts(before, after)).toEqual([])
    expect(
      revealCallouts({ ...before, correct: 10 }, { ...after, correct: 11 }, { levels: true }),
    ).toEqual([])
  })

  it('skips the level callout for progress from before levels existed', () => {
    expect(
      revealCallouts({ streak: 9, strikes: 0 }, { streak: 10, strikes: 0, correct: 10 }, { levels: true }),
    ).toEqual([{ kind: 'multiplier', text: '×1.25 points!' }])
  })

  it('labels every difficulty', () => {
    expect(['easy', 'medium', 'hard', 'expert'].map((d) => difficultyLabel(d as never))).toEqual([
      'Easy',
      'Medium',
      'Hard',
      'Expert',
    ])
  })
})

describe('streakFill', () => {
  it('fills the strike-back ring and handles milestone boundaries', () => {
    expect(streakFill(0)).toBe(0)
    expect(streakFill(14)).toBe(14 / STRIKE_BACK_EVERY)
    expect(streakFill(15)).toBe(1)
    expect(streakFill(16)).toBe(1 / STRIKE_BACK_EVERY)
  })
})

describe('strikeLabel', () => {
  it('includes the strike number and configured limit', () => {
    expect(strikeLabel(2)).toBe(`Strike 2 of ${STRIKES}`)
  })
})
