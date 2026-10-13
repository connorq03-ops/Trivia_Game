import boss from '../content/boss.json' with { type: 'json' }
import playersNbaDeep from '../content/players-nba-deep.json' with { type: 'json' }
import playersNflDeep from '../content/players-nfl-deep.json' with { type: 'json' }
import playersMlb from '../content/players-mlb.json' with { type: 'json' }
import players from '../content/players.json' with { type: 'json' }
import rulesDeep from '../content/rules-deep.json' with { type: 'json' }
import rules from '../content/rules.json' with { type: 'json' }
import type { BossQuestion, ChoiceBadge, Question } from '../src/game/types.js'
import { badgeCategory, badgeFor } from './badges.js'

// Every content/*.json file is in contentFiles or bossContentFiles;
// content.test.ts fails if one is missing.
export const contentFiles: Record<string, Question[]> = {
  'rules.json': rules as Question[],
  'rules-deep.json': rulesDeep as Question[],
  'players.json': players as Question[],
  'players-mlb.json': playersMlb as Question[],
  'players-nfl-deep.json': playersNflDeep as Question[],
  'players-nba-deep.json': playersNbaDeep as Question[],
}

// Boss questions stay out of questionBank so Daily and normal Classic
// selection never draw them; questionsById still resolves them.
export const bossContentFiles: Record<string, BossQuestion[]> = {
  'boss.json': boss as unknown as BossQuestion[],
}

export const questionBank = Object.values(contentFiles).flat()
export const bossQuestions = Object.values(bossContentFiles).flat()
export const questionsById = new Map<string, Question>(
  [...questionBank, ...bossQuestions].map((question) => [question.id, question]),
)

export function isBossQuestion(question: Question): question is BossQuestion {
  return question.side === 'boss'
}

export type PublicQuestion = Pick<
  Question,
  'id' | 'side' | 'sport' | 'leagues' | 'difficulty' | 'category' | 'prompt' | 'reel'
> & { choices: string[]; choiceBadges?: (ChoiceBadge | null)[] }

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
    ...(badgeCategory(question.category)
      ? { choiceBadges: choices.map((choice) => badgeFor(question, choice)) }
      : {}),
    ...(question.reel ? { reel: question.reel } : {}),
  }
}
