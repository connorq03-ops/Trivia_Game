import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { badgeFor } from './badges'
import { publicQuestion, questionBank } from './questions'

const BADGE_CATEGORIES = ['Alma mater', 'Drafted by', 'Country']
const badgeQuestions = questionBank.filter((question) =>
  BADGE_CATEGORIES.includes(question.category),
)
const otherQuestions = questionBank.filter(
  (question) => !BADGE_CATEGORIES.includes(question.category),
)

describe('choice badges', () => {
  it('covers every answer and wrong choice in the badge categories', () => {
    expect(badgeQuestions.length).toBeGreaterThan(0)
    for (const question of badgeQuestions) {
      for (const choice of [question.answer, ...question.wrong]) {
        const badge = badgeFor(question, choice)
        expect(badge, `${question.id}: ${choice}`).not.toBeNull()
      }
    }
  })

  it('returns null for other categories', () => {
    for (const question of otherQuestions) {
      for (const choice of [question.answer, ...question.wrong]) {
        expect(badgeFor(question, choice), `${question.id}`).toBeNull()
      }
    }
  })

  it('uses valid hex colors and 2-4 letter abbreviations', () => {
    const seen = new Set<string>()
    for (const question of badgeQuestions) {
      for (const choice of [question.answer, ...question.wrong]) {
        const badge = badgeFor(question, choice)
        if (badge?.kind !== 'team' || seen.has(choice)) continue
        seen.add(choice)
        expect(badge.abbr, choice).toMatch(/^[A-Z&]{2,4}$/)
        expect(badge.primary, choice).toMatch(/^#[0-9a-f]{6}$/i)
        expect(badge.secondary, choice).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('keeps the four abbreviations within a question distinct', () => {
    for (const question of badgeQuestions) {
      const abbrs = [question.answer, ...question.wrong]
        .map((choice) => badgeFor(question, choice))
        .filter((badge) => badge?.kind === 'team')
        .map((badge) => (badge?.kind === 'team' ? badge.abbr : null))
      expect(new Set(abbrs).size, question.id).toBe(abbrs.length)
    }
  })

  it('has a flag file on disk for every flag badge', () => {
    for (const question of badgeQuestions) {
      for (const choice of [question.answer, ...question.wrong]) {
        const badge = badgeFor(question, choice)
        if (badge?.kind !== 'flag') continue
        expect(
          existsSync(join('public', 'flags', `${badge.code}.svg`)),
          `${choice} → ${badge.code}`,
        ).toBe(true)
      }
    }
  })
})

describe('publicQuestion choiceBadges', () => {
  const choices = (question: (typeof questionBank)[number]) => [
    question.answer,
    ...question.wrong,
  ]

  it('returns badges in choice order for a college question', () => {
    const question = badgeQuestions.find((q) => q.category === 'Alma mater')!
    const result = publicQuestion(question, choices(question))
    expect(result.choiceBadges).toHaveLength(4)
    expect(result.choiceBadges?.[0]).toEqual(badgeFor(question, question.answer))
    for (const [index, choice] of result.choices.entries()) {
      expect(result.choiceBadges?.[index]).toEqual(badgeFor(question, choice))
    }
  })

  it('omits choiceBadges for rules and jersey questions', () => {
    const rules = questionBank.find((q) => q.side === 'rules')!
    expect(
      publicQuestion(rules, choices(rules)),
    ).not.toHaveProperty('choiceBadges')
    const jersey = questionBank.find((q) => q.category === 'Jersey number')!
    expect(
      publicQuestion(jersey, choices(jersey)),
    ).not.toHaveProperty('choiceBadges')
  })
})
