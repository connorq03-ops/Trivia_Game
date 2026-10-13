import {
  BOSS_CLOCK_MS,
  BOSS_HIT_POINTS,
  BOSS_MISS_POINTS,
  CLOCK_MS,
  DAILY_BONUS_AVG_MS,
  DAILY_STREAK_STEP,
  levelFor,
  LEVELS,
  MULTIPLIER_TIERS,
  streakMultiplier,
  STRIKE_BACK_EVERY,
  STRIKES,
} from './engine'
import type { Difficulty } from './types'

export const REVEAL_MS = 700

function formatMultiplier(multiplier: number): string {
  return `×${Number(multiplier.toFixed(2))}`
}

function andList(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

export function howItWorks({ bosses = false }: { bosses?: boolean } = {}): string[] {
  const tiers = [...MULTIPLIER_TIERS].sort((left, right) => left.streak - right.streak)
  const streaks = andList(tiers.map(({ streak }) => String(streak)))
  const multipliers = andList(
    tiers.map(({ multiplier }) => formatMultiplier(multiplier)),
  )
  const levelSteps = andList(
    LEVELS.slice(1).map(({ minCorrect }) => String(minCorrect)),
  )

  return [
    `You get ${CLOCK_MS / 1000} seconds per question. Faster answers score more.`,
    `Classic: ${STRIKES} strikes and your run is over.`,
    `Get ${STRIKE_BACK_EVERY} in a row to clear a strike.`,
    `Streaks of ${streaks} multiply your points by ${multipliers}.`,
    `Classic starts easy and levels up at ${levelSteps} correct answers. Harder questions score more.`,
    ...(bosses
      ? [
          `Each level-up brings a boss question on science, history, art or pop culture: ${BOSS_CLOCK_MS / 1000} seconds, +${BOSS_HIT_POINTS} if right, −${BOSS_MISS_POINTS} if wrong, no strike.`,
          `A perfect, fast Daily 10 earns a bonus boss: all 10 right in under ${DAILY_BONUS_AVG_MS / 1000}s each on average, +${BOSS_HIT_POINTS} if right and no penalty if wrong.`,
        ]
      : []),
    `Daily 10: the same 10 questions for everyone today, easy to hard. No strikes. Each correct answer in a row adds +${Math.round(DAILY_STREAK_STEP * 100)}% to your points.`,
  ]
}

export function modeSubtitle(mode: 'classic' | 'daily'): string {
  return mode === 'classic'
    ? `Endless run. ${STRIKES} strikes and you're out.`
    : 'Same 10 questions for everyone today.'
}

export function multiplierLabel(
  streakBefore: number,
  streakStep = 0,
): string | null {
  const multiplier =
    streakMultiplier(streakBefore) * (1 + streakStep * streakBefore)
  return multiplier === 1 ? null : formatMultiplier(multiplier)
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
}

export function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_LABELS[difficulty]
}

export type Callout = 'multiplier' | 'strikeCleared' | 'levelUp'

type CalloutProgress = { streak: number; strikes: number; correct?: number }

export function revealCallouts(
  before: CalloutProgress,
  after: CalloutProgress,
  { levels = false }: { levels?: boolean } = {},
): { kind: Callout; text: string }[] {
  const callouts: { kind: Callout; text: string }[] = []
  if (
    levels &&
    before.correct !== undefined &&
    after.correct !== undefined &&
    levelFor(after.correct) > levelFor(before.correct)
  ) {
    callouts.push({
      kind: 'levelUp',
      text: `Level ${levelFor(after.correct)}! Tougher questions ahead.`,
    })
  }
  if (after.strikes < before.strikes) {
    callouts.push({ kind: 'strikeCleared', text: 'Strike cleared!' })
  }
  if (
    after.streak > before.streak &&
    MULTIPLIER_TIERS.some((tier) => tier.streak === after.streak)
  ) {
    const label = multiplierLabel(after.streak)
    if (label) callouts.push({ kind: 'multiplier', text: `${label} points!` })
  }
  return callouts
}

export function streakFill(streak: number): number {
  if (streak > 0 && streak % STRIKE_BACK_EVERY === 0) return 1
  return (streak % STRIKE_BACK_EVERY) / STRIKE_BACK_EVERY
}

export function strikeLabel(n: number): string {
  return `Strike ${n} of ${STRIKES}`
}
