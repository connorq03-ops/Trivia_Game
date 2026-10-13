import type { Difficulty, Question, Side, Sport } from './types.js'

export const STRIKES = 3
export const STRIKE_BACK_EVERY = 15
export const CLOCK_MS = 10_000
export const REEL_MS = 2_000
export const GRACE_MS = 1_500
export const SLACK_MS = 3_000
export const MULTIPLIER_TIERS = [
  { streak: 30, multiplier: 2 },
  { streak: 20, multiplier: 1.5 },
  { streak: 10, multiplier: 1.25 },
] as const
export const BASE: Record<Difficulty, number> = {
  easy: 100,
  medium: 150,
  hard: 200,
  expert: 300,
}
export const LEVELS: readonly {
  minCorrect: number
  weights: Readonly<Record<Difficulty, number>>
}[] = [
  { minCorrect: 0, weights: { easy: 1, medium: 0, hard: 0, expert: 0 } },
  { minCorrect: 10, weights: { easy: 0.6, medium: 0.4, hard: 0, expert: 0 } },
  { minCorrect: 20, weights: { easy: 0, medium: 0.6, hard: 0.4, expert: 0 } },
  { minCorrect: 35, weights: { easy: 0, medium: 0, hard: 0.6, expert: 0.4 } },
  { minCorrect: 50, weights: { easy: 0, medium: 0, hard: 0.25, expert: 0.75 } },
]

const SPORTS: Sport[] = ['football', 'basketball', 'baseball']
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert']
const DIFFICULTY_RANK: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
  expert: 3,
}

export type ClassicOptions = {
  sport: 'all' | Sport
  side: 'both' | Side
}

export type AnswerResult = 'hit' | 'miss' | 'timeout'

export type RunProgress = {
  score: number
  strikes: number
  streak: number
  bestStreak: number
  questionsAnswered: number
  answeredCount: number
  totalAnswerMs: number
  missed: Question[]
  results: AnswerResult[]
}

export type ClassicSelection =
  | { type: 'question'; question: Question; choices: string[] }
  | { type: 'end'; reason: 'bank' }

export type AnswerOutcome = {
  progress: RunProgress
  correct: boolean
  points: number
  answerMs: number | null
  endReason?: 'strikes'
}

function randomIndex(length: number, rng: () => number): number {
  return Math.min(length - 1, Math.floor(rng() * length))
}

function choose<T>(items: T[], rng: () => number): T {
  return items[randomIndex(items.length, rng)]
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1, rng)
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

export function streakMultiplier(streakBefore: number): number {
  return (
    MULTIPLIER_TIERS.find((tier) => streakBefore >= tier.streak)?.multiplier ?? 1
  )
}

export function scoreAnswer(
  elapsedMs: number,
  difficulty: Difficulty,
  streakBefore: number,
): number {
  const timeSeconds = Math.min(10, Math.max(0, elapsedMs / 1000))
  const speed = 1 + Math.min(1, (10 - timeSeconds) / 8.5)
  return Math.round(BASE[difficulty] * speed * streakMultiplier(streakBefore))
}

export function levelFor(correctCount: number): number {
  let level = 1
  LEVELS.forEach((candidate, index) => {
    if (correctCount >= candidate.minCorrect) level = index + 1
  })
  return level
}

export function correctCount(
  progress: Pick<RunProgress, 'results' | 'questionsAnswered' | 'missed'>,
): number {
  // Runs started before per-answer results were stored only have a partial list.
  if (progress.results.length < progress.questionsAnswered) {
    return Math.max(0, progress.questionsAnswered - progress.missed.length)
  }
  return progress.results.filter((result) => result === 'hit').length
}

function drawDifficulty(correct: number, rng: () => number): Difficulty {
  const { weights } = LEVELS[levelFor(correct) - 1]
  const draw = rng()
  let cumulative = 0

  for (const difficulty of DIFFICULTIES) {
    cumulative += weights[difficulty]
    if (draw < cumulative) return difficulty
  }
  return DIFFICULTIES.findLast((difficulty) => weights[difficulty] > 0) ?? 'easy'
}

// Harder tiers first, so a run never drifts back to easy questions late.
function fallbackOrder(difficulty: Difficulty): Difficulty[] {
  const rank = DIFFICULTY_RANK[difficulty]
  return [
    ...DIFFICULTIES.slice(rank),
    ...DIFFICULTIES.slice(0, rank).reverse(),
  ]
}

export function presentQuestion(
  question: Question,
  rng: () => number,
): { question: Question; choices: string[] } {
  return {
    question,
    choices: shuffle([question.answer, ...question.wrong], rng),
  }
}

function present(question: Question, rng: () => number): ClassicSelection {
  return { type: 'question', ...presentQuestion(question, rng) }
}

export function resolveAnswerMs(
  clientMs: number | null,
  serverMs: number,
): number | null {
  if (clientMs === null || serverMs - SLACK_MS >= CLOCK_MS) return null
  const lowerBound = Math.max(0, serverMs - SLACK_MS)
  const adjusted = Math.min(serverMs, Math.max(lowerBound, clientMs))
  return Math.min(CLOCK_MS, Math.max(0, adjusted))
}

export function selectClassicQuestion(
  bank: Question[],
  usedFactIds: ReadonlySet<string>,
  correct: number,
  options: ClassicOptions,
  rng: () => number,
): ClassicSelection {
  const available = bank.filter((question) => !usedFactIds.has(question.factId))
  const selectedSide: Side =
    options.side === 'both'
      ? rng() < 0.5
        ? 'rules'
        : 'players'
      : options.side
  const fitsSport = (question: Question) =>
    options.sport === 'all' || question.sport === options.sport
  let candidates = available.filter(
    (question) => question.side === selectedSide && fitsSport(question),
  )

  if (options.side === 'both' && candidates.length === 0) {
    const fallbackSide = selectedSide === 'rules' ? 'players' : 'rules'
    candidates = available.filter(
      (question) => question.side === fallbackSide && fitsSport(question),
    )
  }

  if (options.sport === 'all') {
    const availableSports = SPORTS.filter((sport) =>
      candidates.some((question) => question.sport === sport),
    )
    if (availableSports.length === 0) return { type: 'end', reason: 'bank' }
    const selectedSport = choose(availableSports, rng)
    candidates = candidates.filter((question) => question.sport === selectedSport)
  } else {
    candidates = candidates.filter((question) => question.sport === options.sport)
  }

  if (candidates.length === 0) return { type: 'end', reason: 'bank' }

  const targetDifficulty = drawDifficulty(correct, rng)
  const chosenDifficulty = fallbackOrder(targetDifficulty).find((difficulty) =>
    candidates.some((question) => question.difficulty === difficulty),
  )
  if (!chosenDifficulty) return { type: 'end', reason: 'bank' }

  const question = choose(
    candidates.filter((candidate) => candidate.difficulty === chosenDifficulty),
    rng,
  )
  return present(question, rng)
}

export function dailyQuestions(dateUtc: string, bank: Question[]): Question[] {
  const eligible = bank.filter(
    (question) => !question.dailyFrom || question.dailyFrom <= dateUtc,
  )
  const rng = createSeededRandom(hashString(dateUtc))
  const usedFactIds = new Set<string>()
  const selected: Question[] = []

  for (const side of ['rules', 'players'] as const) {
    const candidates = shuffle(
      eligible.filter((question) => question.side === side),
      rng,
    )
    for (const question of candidates) {
      if (usedFactIds.has(question.factId)) continue
      selected.push(question)
      usedFactIds.add(question.factId)
      if (selected.filter((item) => item.side === side).length === 5) break
    }
    if (selected.filter((item) => item.side === side).length !== 5) {
      throw new Error(`Daily 10 requires five distinct ${side} questions`)
    }
  }

  return shuffle(selected, rng).sort(
    (left, right) =>
      DIFFICULTY_RANK[left.difficulty] - DIFFICULTY_RANK[right.difficulty],
  )
}

export function createRunProgress(): RunProgress {
  return {
    score: 0,
    strikes: 0,
    streak: 0,
    bestStreak: 0,
    questionsAnswered: 0,
    answeredCount: 0,
    totalAnswerMs: 0,
    missed: [],
    results: [],
  }
}

export function answerQuestion(
  progress: RunProgress,
  question: Question,
  isCorrect: boolean,
  elapsedMs: number | null,
): AnswerOutcome {
  const timedOut = elapsedMs === null || elapsedMs >= CLOCK_MS
  const correct = isCorrect && !timedOut
  const normalizedAnswerMs = timedOut
    ? null
    : Math.round(Math.min(CLOCK_MS, Math.max(0, elapsedMs)))
  const points = correct
    ? scoreAnswer(normalizedAnswerMs ?? CLOCK_MS, question.difficulty, progress.streak)
    : 0
  const streak = correct ? progress.streak + 1 : 0
  let strikes = progress.strikes

  if (correct) {
    if (streak % STRIKE_BACK_EVERY === 0 && strikes > 0) strikes -= 1
  } else {
    strikes += 1
  }

  const nextProgress: RunProgress = {
    score: progress.score + points,
    strikes,
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    questionsAnswered: progress.questionsAnswered + 1,
    answeredCount: progress.answeredCount + (timedOut ? 0 : 1),
    totalAnswerMs: progress.totalAnswerMs + (timedOut ? 0 : normalizedAnswerMs ?? 0),
    missed: correct ? progress.missed : [...progress.missed, question],
    results: [
      ...progress.results,
      timedOut ? 'timeout' : correct ? 'hit' : 'miss',
    ],
  }

  return {
    progress: nextProgress,
    correct,
    points,
    answerMs: normalizedAnswerMs,
    ...(strikes >= STRIKES ? { endReason: 'strikes' } : {}),
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
