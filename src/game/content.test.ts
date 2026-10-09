import rules from '../../content/rules.json'
import players from '../../content/players.json'
import { describe, expect, it } from 'vitest'
import type { Question } from './types'

const ruleCategories = [
  'Clock and timing',
  'Numbers and dimensions',
  "What's the call?",
  'Scoring',
]
const playerCategories = [
  'Alma mater',
  'Drafted by',
  'Jersey number',
  'Position',
  'Country',
]
const sports = ['football', 'basketball', 'baseball']
const difficulties = ['easy', 'medium', 'hard']
const allQuestions = [...rules, ...players] as Question[]

describe('question content', () => {
  it('keeps the rules and players banks on their declared sides', () => {
    expect(rules.length).toBeGreaterThanOrEqual(30)
    expect(players.length).toBeGreaterThanOrEqual(100)
    expect(rules.every((question) => question.side === 'rules')).toBe(true)
    expect(players.every((question) => question.side === 'players')).toBe(true)
  })

  it('validates every question against the runtime content contract', () => {
    const ids = allQuestions.map((question) => question.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const question of allQuestions) {
      expect(question.id.trim()).not.toBe('')
      expect(question.factId.trim()).not.toBe('')
      expect(['rules', 'players']).toContain(question.side)
      expect(sports).toContain(question.sport)
      expect(difficulties).toContain(question.difficulty)
      expect(
        question.side === 'rules'
          ? ruleCategories
          : playerCategories,
      ).toContain(question.category)
      expect(question.prompt.length).toBeLessThanOrEqual(110)
      expect(question.answer.length).toBeLessThanOrEqual(24)
      expect(question.wrong).toHaveLength(3)
      expect(question.wrong.every((choice) => choice.length <= 24)).toBe(true)
      expect(new Set([question.answer, ...question.wrong]).size).toBe(4)
      expect(question.teach.length).toBeLessThanOrEqual(140)
      expect(question.leagues.length).toBeGreaterThan(0)
      expect(question.leagues.every((league) => league.toLowerCase() !== 'all')).toBe(
        true,
      )
      expect(question.source.url.startsWith('https://')).toBe(true)
      expect(question.source.ref.trim()).not.toBe('')

      if (question.side === 'players') {
        expect(question.reel).toBeDefined()
        expect(Number.isInteger(question.reel?.season)).toBe(true)
        expect(question.reel?.player.trim()).not.toBe('')
      } else {
        expect(Object.hasOwn(question, 'reel')).toBe(false)
      }

      if (question.validFrom !== undefined) {
        expect(Number.isInteger(question.validFrom)).toBe(true)
      }
    }
  })
})
