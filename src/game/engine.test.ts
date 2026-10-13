import { describe, expect, it } from 'vitest'
import {
  answerBossQuestion,
  answerQuestion,
  BOSS_CATEGORIES,
  BOSS_CLOCK_MS,
  CLOCK_MS,
  correctCount,
  createRunProgress,
  DAILY_STREAK_STEP,
  dailyQuestions,
  LEVELS,
  levelFor,
  levelIndexFor,
  presentQuestion,
  resolveAnswerMs,
  scoreAnswer,
  selectClassicQuestion,
  streakMultiplier,
  type BossOptions,
  type ClassicOptions,
  type RunProgress,
} from './engine'
import type {
  BossCategory,
  BossQuestion,
  Difficulty,
  Question,
  Side,
  Sport,
} from './types'

const difficulties: Difficulty[] = ['easy', 'medium', 'hard', 'expert']
const sports: Sport[] = ['football', 'basketball', 'baseball']
const defaultOptions: ClassicOptions = { sport: 'all', side: 'both' }

function makeQuestion(
  index: number,
  overrides: Partial<Question> = {},
): Question {
  const side = overrides.side ?? (Math.floor(index / 3) % 2 === 0 ? 'rules' : 'players')
  const sport = overrides.sport ?? sports[index % sports.length]
  return {
    id: `question-${index}`,
    factId: `fact-${index}`,
    side,
    sport,
    leagues: ['TEST'],
    difficulty:
      overrides.difficulty ?? difficulties[Math.floor(index / 6) % difficulties.length],
    category: side === 'rules' ? 'Scoring' : 'Country',
    prompt: `Synthetic question ${index}?`,
    answer: `Answer ${index}`,
    wrong: [`Wrong A ${index}`, `Wrong B ${index}`, `Wrong C ${index}`],
    teach: 'Synthetic teaching note.',
    source: { url: 'https://example.com/test', ref: 'synthetic' },
    ...(side === 'players'
      ? { reel: { season: 2099, player: `Sample Player ${index}` } }
      : {}),
    ...overrides,
  }
}

function makeLargeBank(length = 1200): Question[] {
  return Array.from({ length }, (_, index) => makeQuestion(index))
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('scoreAnswer', () => {
  it.each([
    [0, 300],
    [1500, 300],
    [5000, 238],
    [10000, 150],
  ])('scores medium at %ims as %i with no streak', (elapsedMs, expected) => {
    expect(scoreAnswer(elapsedMs, 'medium', 0)).toBe(expected)
  })

  it('applies the streak multiplier from before the answer', () => {
    expect(scoreAnswer(2500, 'easy', 12)).toBe(235)
  })

  it('stacks the daily streak step on top of speed', () => {
    const base = scoreAnswer(2500, 'medium', 5)
    const stepped = scoreAnswer(2500, 'medium', 5, 1 + DAILY_STREAK_STEP * 5)
    expect(stepped).toBeGreaterThan(base)
    expect(stepped).toBe(Math.round(150 * (1 + 7.5 / 8.5) * 1.5))
  })

  it('grows daily points with each consecutive correct answer', () => {
    const question = makeQuestion(0, {
      side: 'rules',
      difficulty: 'medium',
    })
    const early = answerQuestion(
      progressWith({ streak: 1 }),
      question,
      true,
      2500,
      DAILY_STREAK_STEP,
    )
    const late = answerQuestion(
      progressWith({ streak: 9 }),
      question,
      true,
      2500,
      DAILY_STREAK_STEP,
    )
    expect(late.points).toBeGreaterThan(early.points)
    expect(late.points).toBe(Math.round(scoreAnswer(2500, 'medium', 9, 1.9)))
  })

  it.each([
    [9, 1],
    [10, 1.25],
    [19, 1.25],
    [20, 1.5],
    [29, 1.5],
    [30, 2],
  ])('uses multiplier %s at streak %i', (streak, expectedMultiplier) => {
    expect(streakMultiplier(streak)).toBe(expectedMultiplier)
  })
})

describe('resolveAnswerMs', () => {
  it('accepts an honest client time despite reel/network slack', () => {
    expect(resolveAnswerMs(4800, 6000)).toBe(4800)
  })

  it('raises an implausibly fast client time to the slack floor', () => {
    expect(resolveAnswerMs(0, 6000)).toBe(3000)
  })

  it('caps a slower client time at server elapsed time', () => {
    expect(resolveAnswerMs(8000, 6000)).toBe(6000)
  })

  it('preserves timeouts and expires at the server clock limit', () => {
    expect(resolveAnswerMs(null, 1000)).toBeNull()
    expect(resolveAnswerMs(5000, 13_000)).toBeNull()
  })
})

describe('presentQuestion', () => {
  it('returns the question with a shuffled set of its four choices', () => {
    const question = makeQuestion(1)
    const presented = presentQuestion(question, seededRandom(1))

    expect(presented.question).toBe(question)
    expect([...presented.choices].sort()).toEqual(
      [question.answer, ...question.wrong].sort(),
    )
  })
})

describe('answerQuestion', () => {
  const question = makeQuestion(0, { side: 'rules', difficulty: 'medium' })

  it('records answer results, including timeouts', () => {
    expect(createRunProgress().results).toEqual([])
    expect(answerQuestion(createRunProgress(), question, true, 1000).progress.results).toEqual([
      'hit',
    ])
    expect(answerQuestion(createRunProgress(), question, false, 1000).progress.results).toEqual([
      'miss',
    ])
    expect(answerQuestion(createRunProgress(), question, true, null).progress.results).toEqual([
      'timeout',
    ])
    expect(answerQuestion(createRunProgress(), question, true, CLOCK_MS).progress.results).toEqual([
      'timeout',
    ])
  })

  it('backs off a strike at streaks 15 and 30 without banking', () => {
    let progress = { ...createRunProgress(), strikes: 1 }
    for (let index = 0; index < 15; index += 1) {
      progress = answerQuestion(progress, question, true, 1000).progress
    }
    expect(progress.strikes).toBe(0)
    expect(progress.streak).toBe(15)

    progress = createRunProgress()
    for (let index = 0; index < 15; index += 1) {
      progress = answerQuestion(progress, question, true, 1000).progress
    }
    expect(progress.strikes).toBe(0)
    progress = answerQuestion(progress, question, false, 1000).progress
    expect(progress.strikes).toBe(1)
    expect(progress.streak).toBe(0)

    progress = { ...createRunProgress(), strikes: 2 }
    for (let index = 0; index < 30; index += 1) {
      progress = answerQuestion(progress, question, true, 1000).progress
    }
    expect(progress.strikes).toBe(0)
  })

  it('ends on the third strike', () => {
    const outcome = answerQuestion(
      { ...createRunProgress(), strikes: 2 },
      question,
      false,
      1200,
    )
    expect(outcome.endReason).toBe('strikes')
    expect(outcome.progress.strikes).toBe(3)
  })

  it('counts a timeout as a strike and resets the streak', () => {
    const outcome = answerQuestion(
      { ...createRunProgress(), streak: 4, bestStreak: 4 },
      question,
      true,
      null,
    )
    expect(outcome.correct).toBe(false)
    expect(outcome.points).toBe(0)
    expect(outcome.progress.strikes).toBe(1)
    expect(outcome.progress.streak).toBe(0)
    expect(outcome.progress.answeredCount).toBe(0)
  })
})

describe('Classic question selection', () => {
  it('never selects the same factId twice in a long run', () => {
    const sharedFactBank = [
      ...makeLargeBank(250).map((question, index) => ({
        ...question,
        factId: `shared-${Math.floor(index / 2)}`,
      })),
    ]
    const used = new Set<string>()
    const rng = seededRandom(223)
    for (let questionNumber = 1; questionNumber <= 100; questionNumber += 1) {
      const selection = selectClassicQuestion(
        sharedFactBank,
        used,
        questionNumber,
        defaultOptions,
        rng,
      )
      if (selection.type === 'end') break
      expect(used.has(selection.question.factId)).toBe(false)
      used.add(selection.question.factId)
      expect(selection.choices).toHaveLength(4)
      expect(new Set(selection.choices).size).toBe(4)
    }
  })

  it('respects sport and side filters', () => {
    const bank = makeLargeBank(90)
    for (const [sport, side] of [
      ['football', 'players'],
      ['basketball', 'rules'],
      ['baseball', 'players'],
    ] as [Sport, Side][]) {
      const selection = selectClassicQuestion(
        bank,
        new Set(),
        1,
        { sport, side },
        seededRandom(3),
      )
      expect(selection.type).toBe('question')
      if (selection.type === 'question') {
        expect(selection.question.sport).toBe(sport)
        expect(selection.question.side).toBe(side)
      }
    }
  })

  it('falls back to rules when Baseball has no eligible player questions', () => {
    const baseballRules = makeLargeBank(90).filter(
      (question) => question.sport === 'baseball' && question.side === 'rules',
    )
    const randomValues = [0.9, 0.2, 0.1, 0.4]
    let randomIndex = 0
    const rng = () => randomValues[randomIndex++] ?? 0.3
    const selection = selectClassicQuestion(
      baseballRules,
      new Set(),
      1,
      { sport: 'baseball', side: 'both' },
      rng,
    )

    expect(selection.type).toBe('question')
    if (selection.type === 'question') {
      expect(selection.question.sport).toBe('baseball')
      expect(selection.question.side).toBe('rules')
    }
  })

  it('levels up on correct answers at the configured thresholds', () => {
    expect(LEVELS.map(({ minCorrect }) => minCorrect)).toEqual([0, 10, 20, 35, 50])
    expect(levelFor(0)).toBe(1)
    expect(levelFor(9)).toBe(1)
    expect(levelFor(10)).toBe(2)
    expect(levelFor(34)).toBe(3)
    expect(levelFor(35)).toBe(4)
    expect(levelFor(500)).toBe(5)
    for (const { weights } of LEVELS) {
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
    }
  })

  it('ramps from easy-only to mostly expert as correct answers grow', () => {
    const bank = makeLargeBank()
    const counts = (correct: number) => {
      const tally: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 }
      const rng = seededRandom(correct + 7)
      for (let draw = 0; draw < 400; draw += 1) {
        const selection = selectClassicQuestion(bank, new Set(), correct, defaultOptions, rng)
        if (selection.type === 'question') tally[selection.question.difficulty] += 1
      }
      return tally
    }

    expect(counts(0)).toEqual({ easy: 400, medium: 0, hard: 0, expert: 0 })
    expect(counts(9).easy).toBe(400)
    const level2 = counts(15)
    expect(level2.easy + level2.medium).toBe(400)
    expect(level2.medium).toBeGreaterThan(100)
    const level3 = counts(25)
    expect(level3.medium + level3.hard).toBe(400)
    const level4 = counts(40)
    expect(level4.hard + level4.expert).toBe(400)
    expect(counts(60).expert / 400).toBeGreaterThan(0.6)
  })

  it('falls back to harder tiers before easier ones', () => {
    const bank = [
      makeQuestion(0, { sport: 'football', side: 'rules', difficulty: 'medium' }),
      makeQuestion(1, { sport: 'football', side: 'rules', difficulty: 'expert' }),
      makeQuestion(2, { sport: 'football', side: 'rules', difficulty: 'easy' }),
    ]
    const options: ClassicOptions = { sport: 'football', side: 'rules' }
    const pick = (correct: number, used: string[] = []) => {
      const selection = selectClassicQuestion(bank, new Set(used), correct, options, seededRandom(1))
      return selection.type === 'question' ? selection.question.difficulty : null
    }

    expect(pick(0, [bank[2].factId])).toBe('medium')
    expect(pick(40)).toBe('expert')
    expect(pick(40, [bank[1].factId])).toBe('medium')
    expect(pick(40, [bank[0].factId, bank[1].factId])).toBe('easy')
  })

  it('ends with bank exhaustion when there are no eligible facts', () => {
    const [question] = makeLargeBank(1)
    expect(
      selectClassicQuestion(
        [question],
        new Set([question.factId]),
        1,
        defaultOptions,
        seededRandom(4),
      ),
    ).toEqual({ type: 'end', reason: 'bank' })
  })
})

describe('Daily 10', () => {
  const bank = makeLargeBank(90)

  it('is deterministic with five questions per side and distinct, ramped facts', () => {
    const first = dailyQuestions('2099-12-31', bank)
    const second = dailyQuestions('2099-12-31', bank)
    expect(first.map((question) => question.id)).toEqual(
      second.map((question) => question.id),
    )
    expect(first).toHaveLength(10)
    expect(first.filter((question) => question.side === 'rules')).toHaveLength(5)
    expect(first.filter((question) => question.side === 'players')).toHaveLength(5)
    expect(new Set(first.map((question) => question.factId)).size).toBe(10)
    expect(
      first.every(
        (question, index) =>
          index === 0 ||
          difficulties.indexOf(first[index - 1].difficulty) <=
            difficulties.indexOf(question.difficulty),
      ),
    ).toBe(true)
  })

  it('targets a hard mix with at most one easy question', () => {
    const tally = { easy: 0, medium: 0, hard: 0, expert: 0 }
    dailyQuestions('2099-12-31', bank).forEach((question) => {
      tally[question.difficulty] += 1
    })
    expect(tally).toEqual({ easy: 1, medium: 3, hard: 3, expert: 3 })
  })

  it('falls back to harder questions when a side lacks a quota slot', () => {
    const sparse = bank.filter(
      (question) =>
        question.side !== 'players' || question.difficulty !== 'expert',
    )
    const players = dailyQuestions('2099-12-31', sparse).filter(
      (question) => question.side === 'players',
    )
    expect(players).toHaveLength(5)
    // The two unfilled expert slots fall back to hard before medium.
    const tally = { easy: 0, medium: 0, hard: 0, expert: 0 }
    players.forEach((question) => {
      tally[question.difficulty] += 1
    })
    expect(tally).toEqual({ easy: 0, medium: 2, hard: 3, expert: 0 })
  })

  it('keeps the same questions when future-gated questions are appended', () => {
    const date = '2099-12-31'
    const extra = bank
      .filter((question) => question.side === 'rules')
      .slice(0, 10)
      .map((question, index) => ({
        ...question,
        id: `${question.id}-future-${index}`,
        factId: `${question.factId}-future-${index}`,
        dailyFrom: '2100-01-01',
      }))

    expect(dailyQuestions(date, [...bank, ...extra])).toEqual(
      dailyQuestions(date, bank),
    )
  })

  it('includes questions whose dailyFrom is the current date', () => {
    const date = '2099-12-31'
    const eligibleBank = bank.map((question) =>
      question.side === 'rules' ? { ...question, dailyFrom: date } : question,
    )

    expect(
      dailyQuestions(date, eligibleBank).filter(
        (question) => question.side === 'rules',
      ),
    ).toHaveLength(5)
  })
})

function makeBoss(index: number, category: BossCategory): BossQuestion {
  return {
    ...makeQuestion(index),
    id: `boss-${index}`,
    factId: `boss-fact-${index}`,
    side: 'boss',
    sport: 'boss',
    leagues: [],
    difficulty: 'expert',
    category,
    reel: undefined,
  }
}

const bossBank = BOSS_CATEGORIES.flatMap((category, offset) =>
  [0, 1].map((index) => makeBoss(offset * 2 + index, category)),
)

function bossOptions(levelsConsumed: number[] = []): BossOptions {
  return { bank: bossBank, levelsConsumed }
}

function progressWith(overrides: Partial<RunProgress>): RunProgress {
  return { ...createRunProgress(), ...overrides }
}

describe('Boss questions', () => {
  const bank = makeLargeBank(200)

  it('maps correct counts to level indexes', () => {
    expect(LEVELS.map(({ minCorrect }) => levelIndexFor(minCorrect))).toEqual([
      0, 1, 2, 3, 4,
    ])
    expect(levelIndexFor(9)).toBe(0)
    expect(levelIndexFor(19)).toBe(1)
  })

  it('triggers once at each level threshold after the first', () => {
    const consumed: number[] = []
    const triggeredAt: number[] = []
    for (let correct = 0; correct <= 60; correct += 1) {
      const selection = selectClassicQuestion(
        bank,
        new Set(),
        correct,
        defaultOptions,
        seededRandom(correct),
        bossOptions(consumed),
      )
      if (selection.type === 'boss') {
        consumed.push(selection.level)
        triggeredAt.push(correct)
      }
    }
    expect(triggeredAt).toEqual([10, 20, 35, 50])
    expect(consumed).toEqual([1, 2, 3, 4])
  })

  it('serves a regular question once the level is consumed or bosses are off', () => {
    expect(
      selectClassicQuestion(bank, new Set(), 10, defaultOptions, seededRandom(1), bossOptions([1]))
        .type,
    ).toBe('question')
    expect(
      selectClassicQuestion(bank, new Set(), 10, defaultOptions, seededRandom(1)).type,
    ).toBe('question')
  })

  it('catches up on a level skipped by a legacy run', () => {
    const selection = selectClassicQuestion(
      bank,
      new Set(),
      23,
      defaultOptions,
      seededRandom(2),
      bossOptions([1]),
    )
    expect(selection.type === 'boss' && selection.level).toBe(2)
  })

  it('draws an unused boss with four shuffled choices from a category that has one', () => {
    const used = new Set(
      bossBank.filter((question) => question.category !== 'art').map((question) => question.factId),
    )
    for (let seed = 0; seed < 20; seed += 1) {
      const selection = selectClassicQuestion(
        bank,
        used,
        10,
        defaultOptions,
        seededRandom(seed),
        bossOptions(),
      )
      expect(selection.type).toBe('boss')
      if (selection.type !== 'boss') return
      expect(selection.question.category).toBe('art')
      expect([...selection.choices].sort()).toEqual(
        [selection.question.answer, ...selection.question.wrong].sort(),
      )
    }
  })

  it('falls back to a regular question when the boss pool is empty', () => {
    const used = new Set(bossBank.map((question) => question.factId))
    const selection = selectClassicQuestion(
      bank,
      used,
      10,
      defaultOptions,
      seededRandom(3),
      bossOptions(),
    )
    expect(selection.type).toBe('question')
  })

  it('scores a hit as a flat 500 and extends the streak', () => {
    const outcome = answerBossQuestion(
      progressWith({ score: 1000, streak: 12, bestStreak: 12, questionsAnswered: 12 }),
      bossBank[0],
      true,
      14_000,
    )
    expect(outcome.correct).toBe(true)
    expect(outcome.points).toBe(500)
    expect(outcome.answerMs).toBe(14_000)
    expect(outcome.progress).toMatchObject({
      score: 1500,
      streak: 13,
      bestStreak: 13,
      questionsAnswered: 13,
      answeredCount: 0,
      totalAnswerMs: 0,
      results: ['boss-hit'],
    })
  })

  it('backs off a strike when a boss hit reaches a strike-back streak', () => {
    const outcome = answerBossQuestion(
      progressWith({ score: 1000, streak: 14, strikes: 2 }),
      bossBank[0],
      true,
      2_000,
    )
    expect(outcome.progress.strikes).toBe(1)
  })

  it('takes 250 on a miss without a strike or streak reset, and keeps the question for review', () => {
    const progress = progressWith({ score: 1000, streak: 12, strikes: 1 })
    const outcome = answerBossQuestion(progress, bossBank[0], false, 3_000)
    expect(outcome.correct).toBe(false)
    expect(outcome.points).toBe(-250)
    expect(outcome.endReason).toBeUndefined()
    expect(outcome.progress).toMatchObject({
      score: 750,
      strikes: 1,
      streak: 12,
      missed: [],
      results: ['boss-miss'],
      bossMissed: [bossBank[0]],
    })
  })

  it('floors the score at zero and records timeouts', () => {
    const outcome = answerBossQuestion(progressWith({ score: 100 }), bossBank[0], true, BOSS_CLOCK_MS)
    expect(outcome.correct).toBe(false)
    expect(outcome.points).toBe(-100)
    expect(outcome.answerMs).toBeNull()
    expect(outcome.progress.score).toBe(0)
    expect(outcome.progress.results).toEqual(['boss-timeout'])
  })

  it('accepts boss answers past the regular clock', () => {
    expect(resolveAnswerMs(12_000, 12_500)).toBe(CLOCK_MS)
    expect(resolveAnswerMs(12_000, 12_500, BOSS_CLOCK_MS)).toBe(12_000)
    expect(resolveAnswerMs(20_000, 20_000, BOSS_CLOCK_MS)).toBeNull()
    expect(resolveAnswerMs(9_000, 9_500, CLOCK_MS)).toBe(9_000)
  })

  it('keeps the correct count for legacy runs that miss a boss', () => {
    const legacy = progressWith({ questionsAnswered: 10, results: [] })
    expect(correctCount(legacy)).toBe(10)
    const outcome = answerBossQuestion(legacy, bossBank[0], false, 2_000)
    expect(outcome.progress.missed).toEqual([])
    expect(outcome.progress.bossMisses).toBe(1)
    expect(outcome.progress.bossMissed).toEqual([bossBank[0]])
    expect(correctCount(outcome.progress)).toBe(10)
    const hit = answerBossQuestion(outcome.progress, bossBank[1], true, 2_000)
    expect(correctCount(hit.progress)).toBe(11)
  })
})
