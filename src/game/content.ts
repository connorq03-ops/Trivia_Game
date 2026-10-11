import players from '../../content/players.json' with { type: 'json' }
import rules from '../../content/rules.json' with { type: 'json' }
import type { Question } from './types.js'

export const questionBank = [...rules, ...players] as Question[]
