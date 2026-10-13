import playersNbaDeep from '../content/players-nba-deep.json' with { type: 'json' }
import playersNflDeep from '../content/players-nfl-deep.json' with { type: 'json' }
import players from '../content/players.json' with { type: 'json' }
import rulesDeep from '../content/rules-deep.json' with { type: 'json' }
import rules from '../content/rules.json' with { type: 'json' }
import type { Question } from '../src/game/types.js'

// Every content/*.json file; content.test.ts fails if one is missing here.
export const contentFiles: Record<string, Question[]> = {
  'rules.json': rules as Question[],
  'rules-deep.json': rulesDeep as Question[],
  'players.json': players as Question[],
  'players-nfl-deep.json': playersNflDeep as Question[],
  'players-nba-deep.json': playersNbaDeep as Question[],
}

export const questionBank = Object.values(contentFiles).flat()
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
