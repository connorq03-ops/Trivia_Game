import players from '../../content/players.json'
import rules from '../../content/rules.json'
import type { Question } from './types'

export const questionBank = [...rules, ...players] as Question[]
