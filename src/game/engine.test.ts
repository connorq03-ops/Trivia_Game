import { describe, expect, it } from 'vitest'
import {
  answerQuestion,
  createRunProgress,
  dailyQuestions,
  scoreAnswer,
  selectClassicQuestion,
  streakMultiplier,
  type ClassicOptions,
} from './engine'
import type { Difficulty, Question, Side, Sport } from './types'

const difficulties: Difficulty[] = ['easy', 'medium', 'hard']
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

describe('answerQuestion', () => {
  const question = makeQuestion(0, { side: 'rules', difficulty: 'medium' })

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

  it('uses the ramp probabilities across many seeded runs', () => {
    const bank = makeLargeBank()
    const early = { easy: 0, medium: 0, hard: 0 }
    const late = { easy: 0, medium: 0, hard: 0 }

    for (let run = 0; run < 100; run += 1) {
      const rng = seededRandom(run + 100)
      const used = new Set<string>()
      for (let questionNumber = 1; questionNumber <= 60; questionNumber += 1) {
        const selection = selectClassicQuestion(
          bank,
          used,
          questionNumber,
          defaultOptions,
          rng,
        )
        if (selection.type === 'end') break
        used.add(selection.question.factId)
        if (questionNumber <= 15) early[selection.question.difficulty] += 1
        if (questionNumber >= 41) late[selection.question.difficulty] += 1
      }
    }

    expect(early.easy / 1500).toBeGreaterThan(0.5)
    expect(late.hard / 2000).toBeGreaterThan(0.4)
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
})
