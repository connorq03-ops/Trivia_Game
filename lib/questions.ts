import players from '../content/players.json' with { type: 'json' }
import rules from '../content/rules.json' with { type: 'json' }
import type { Question } from '../src/game/types.js'

export const questionBank = [...rules, ...players] as Question[]
export const questionsById = new Map(
  questionBank.map((question) => [question.id, question]),
)
