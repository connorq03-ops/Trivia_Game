import {
  CLOCK_MS,
  MULTIPLIER_TIERS,
  STRIKES,
  STRIKE_BACK_EVERY,
  streakMultiplier,
} from './engine'

export const REVEAL_MS = 700

function formatMultiplier(multiplier: number): string {
  return `×${multiplier}`
}

function andList(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

export function howItWorks(): string[] {
  const tiers = [...MULTIPLIER_TIERS].sort((left, right) => left.streak - right.streak)
  const streaks = andList(tiers.map(({ streak }) => String(streak)))
  const multipliers = andList(
    tiers.map(({ multiplier }) => formatMultiplier(multiplier)),
  )

  return [
    `You get ${CLOCK_MS / 1000} seconds per question. Faster answers score more.`,
    `Classic: ${STRIKES} strikes and your run is over.`,
    `Get ${STRIKE_BACK_EVERY} in a row to clear a strike.`,
    `Streaks of ${streaks} multiply your points by ${multipliers}.`,
    'Daily 10: the same 10 questions for everyone today, easy to hard. No strikes.',
  ]
}

export function modeSubtitle(mode: 'classic' | 'daily'): string {
  return mode === 'classic'
    ? `Endless run. ${STRIKES} strikes and you're out.`
    : 'Same 10 questions for everyone today.'
}

export function multiplierLabel(streakBefore: number): string | null {
  const multiplier = streakMultiplier(streakBefore)
  return multiplier === 1 ? null : formatMultiplier(multiplier)
}

export type Callout = 'multiplier' | 'strikeCleared'

export function revealCallouts(
  before: { streak: number; strikes: number },
  after: { streak: number; strikes: number },
): { kind: Callout; text: string }[] {
  const callouts: { kind: Callout; text: string }[] = []
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
