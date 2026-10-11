import players from '../content/players.json' with { type: 'json' }
import rules from '../content/rules.json' with { type: 'json' }
import type { Question } from '../src/game/types.js'

export const questionBank = [...rules, ...players] as Question[]
export const questionsById = new Map(
  questionBank.map((question) => [question.id, question]),
)

export type PublicQuestion = Pick<
  Question,
  'id' | 'side' | 'sport' | 'leagues' | 'difficulty' | 'category' | 'prompt' | 'reel'
> & { choices: string[] }

export function publicQuestion(
  question: Question,
  choices: string[],
): PublicQuestion {
  return {
    id: question.id,
    side: question.side,
    sport: question.sport,
    leagues: question.leagues,
    difficulty: question.difficulty,
    category: question.category,
    prompt: question.prompt,
    choices,
    ...(question.reel ? { reel: question.reel } : {}),
  }
}
