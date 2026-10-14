import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  bossContentFiles,
  bossQuestions,
  contentFiles,
  questionBank,
  questionsById,
} from '../../lib/questions'
import { BOSS_CATEGORIES, dailyQuestions } from './engine'
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
  'Stats and records',
]
const sports = ['football', 'basketball', 'baseball']
const difficulties = ['easy', 'medium', 'hard', 'expert']
const allQuestions = questionBank
const filesFor = (side: Question['side']) =>
  Object.entries(contentFiles).filter(([name]) => name.startsWith(`${side}`))
const rules = filesFor('rules').flatMap(([, questions]) => questions)
const players = filesFor('players').flatMap(([, questions]) => questions)

const stopwords = new Set([
  'a', 'an', 'and', 'at', 'by', 'did', 'for', 'from', 'he', 'his', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'then', 'to', 'was', 'what',
  'where', 'which', 'who', 'with', 'wore', 'no', 'number', 'country',
  'every', 'worth',
])
const words = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((word) => word.replace(/(?<=\p{L}{3})(ed|es|s|ing)$/u, '')) ?? []

describe('question content', () => {
  it('loads every content/*.json file into the bank', () => {
    const onDisk = readdirSync('content').filter((name) => name.endsWith('.json'))
    expect(
      [...Object.keys(contentFiles), ...Object.keys(bossContentFiles)].sort(),
    ).toEqual(onDisk.sort())
    for (const name of Object.keys(contentFiles)) {
      expect(name.startsWith('rules') || name.startsWith('players'), name).toBe(true)
    }
    for (const name of Object.keys(bossContentFiles)) {
      expect(name.startsWith('boss'), name).toBe(true)
    }
  })

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

      if (question.dailyFrom !== undefined) {
        expect(question.dailyFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const date = new Date(`${question.dailyFrom}T00:00:00Z`)
        expect(Number.isNaN(date.getTime())).toBe(false)
        expect(date.toISOString().slice(0, 10)).toBe(question.dailyFrom)
      }
    }
  })

  it('keeps the real Daily bank unchanged before the new questions launch', () => {
    expect(dailyQuestions('2026-10-13', allQuestions)).toEqual(
      dailyQuestions(
        '2026-10-13',
        allQuestions.filter((question) => !question.dailyFrom),
      ),
    )
  })

  it('gives every teach line a fact beyond the question and answer', () => {
    for (const question of [...allQuestions, ...bossQuestions]) {
      const known = new Set(
        words(
          [
            question.prompt,
            question.answer,
            question.reel?.player ?? '',
            String(question.reel?.season ?? ''),
          ].join(' '),
        ),
      )
      const added = words(question.teach).filter(
        (word) => !known.has(word) && !stopwords.has(word),
      )
      expect(added, `${question.id}: ${question.teach}`).not.toEqual([])
    }
  })
})

describe('boss question content', () => {
  it('keeps boss questions out of the regular bank but resolvable by id', () => {
    expect(questionBank.some((question) => question.side === 'boss')).toBe(false)
    for (const question of bossQuestions) {
      expect(questionsById.get(question.id)).toBe(question)
    }
  })

  it('has enough questions in every category', () => {
    for (const category of BOSS_CATEGORIES) {
      expect(
        bossQuestions.filter((question) => question.category === category).length,
        category,
      ).toBeGreaterThanOrEqual(5)
    }
  })

  it('validates every boss question against the boss contract', () => {
    for (const question of bossQuestions) {
      expect(question.id).toMatch(/^boss-[a-z0-9-]+$/)
      expect(question.factId).toMatch(/^boss-[a-z0-9-]+$/)
      expect(question.side).toBe('boss')
      expect(question.sport).toBe('boss')
      expect(question.difficulty).toBe('expert')
      expect(question.leagues).toEqual([])
      expect(BOSS_CATEGORIES).toContain(question.category)
      expect(question.prompt.length).toBeLessThanOrEqual(110)
      expect(question.answer.length).toBeLessThanOrEqual(24)
      expect(question.wrong).toHaveLength(3)
      expect(question.wrong.every((choice) => choice.length <= 24)).toBe(true)
      expect(new Set([question.answer, ...question.wrong]).size).toBe(4)
      expect(question.teach.length).toBeLessThanOrEqual(140)
      expect(question.source.url.startsWith('https://')).toBe(true)
      expect(question.source.ref.trim()).not.toBe('')
      expect(Object.hasOwn(question, 'reel')).toBe(false)
      expect(Object.hasOwn(question, 'dailyFrom')).toBe(false)
    }
  })

  it('keeps ids and factIds unique across both banks', () => {
    const ids = [...questionBank, ...bossQuestions].map((question) => question.id)
    expect(new Set(ids).size).toBe(ids.length)
    const regularFacts = new Set(questionBank.map((question) => question.factId))
    const bossFacts = bossQuestions.map((question) => question.factId)
    expect(new Set(bossFacts).size).toBe(bossFacts.length)
    expect(bossFacts.filter((factId) => regularFacts.has(factId))).toEqual([])
  })
})
