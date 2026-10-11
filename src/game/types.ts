export type Sport = 'football' | 'basketball' | 'baseball'
export type Side = 'rules' | 'players'
export type Difficulty = 'easy' | 'medium' | 'hard'
export interface Question {
  id: string // unique, stable
  factId: string // a run never shows two questions with the same factId
  side: Side
  sport: Sport
  leagues: string[] // e.g. ["NBA","NCAA"]; never "All"
  difficulty: Difficulty
  category: string // rules: 'Clock and timing' | 'Numbers and dimensions' | "What's the call?" | 'Scoring'; players: 'Alma mater' | 'Drafted by' | 'Jersey number' | 'Position' | 'Country'
  prompt: string // <= 110 chars
  answer: string // <= 24 chars
  wrong: [string, string, string] // <= 24 chars each; distinct from answer and each other
  teach: string // <= 140 chars, shown after a miss
  source: { url: string; ref: string }
  validFrom?: number // season year the fact holds from
  reel?: { season: number; player: string } // required when side === 'players'
}
