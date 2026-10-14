import { getSql } from '../lib/db.js'
import { hashRunToken, isRunToken } from '../lib/runToken.js'
import {
  applyMysteryPrize,
  correctCount,
  type Lifelines,
  type MysteryPrize,
  type RunProgress,
} from '../src/game/engine.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type MysteryInput = { runId: string; runToken: string; pick: 0 | 1 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMysteryInput(value: unknown): MysteryInput | null {
  if (
    !isRecord(value) ||
    typeof value.runId !== 'string' ||
    !UUID_PATTERN.test(value.runId) ||
    !isRunToken(value.runToken) ||
    (value.pick !== 0 && value.pick !== 1)
  ) {
    return null
  }
  return {
    runId: value.runId,
    runToken: value.runToken as string,
    pick: value.pick as 0 | 1,
  }
}

// The public descriptor of a prize: everything the client needs to label it.
function describePrize(prize: MysteryPrize) {
  switch (prize.kind) {
    case 'points':
      return { kind: prize.kind, points: prize.points, label: `+${prize.points} points` }
    case 'fiftyFifty':
      return { kind: prize.kind, label: '50/50 lifeline' }
    case 'strikeEraser':
      return { kind: prize.kind, label: 'Strike eraser' }
    case 'shield':
      return { kind: prize.kind, label: 'Score shield' }
    case 'nothing':
      return { kind: prize.kind, label: 'Nothing' }
  }
}

type StoredMysteryProgress = {
  score?: number
  strikes?: number
  streak?: number
  bestStreak?: number
  questionsAnswered?: number
  answeredCount?: number
  totalAnswerMs?: number
  lifelines?: Lifelines
  pendingMystery?: [MysteryPrize, MysteryPrize]
  [key: string]: unknown
}

function prizeFromStored(value: unknown): MysteryPrize | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'points') {
    return Number.isInteger(value.points) && (value.points as number) > 0
      ? { kind: 'points', points: value.points as number }
      : null
  }
  return ['nothing', 'fiftyFifty', 'strikeEraser', 'shield'].includes(value.kind)
    ? ({ kind: value.kind } as MysteryPrize)
    : null
}

// Applies the player's mystery-box pick. The two prizes were drawn and stored
// on the boss hit; the pick is only valid while pendingMystery is set, so a
// replayed or forged request gets a 409 and the prizes can't be redrawn.
export async function POST(request: Request): Promise<Response> {
  let input: MysteryInput | null
  try {
    input = parseMysteryInput(await request.json())
  } catch {
    input = null
  }
  if (!input) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const sql = getSql()
    const rows = (await sql`
      select mode, status, progress
      from runs
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
        and mode = 'classic'
        and status = 'active'
      limit 1
    `) as {
      mode: string
      status: string
      progress: StoredMysteryProgress | string
      results_found?: boolean
    }[]
    const run = rows[0]
    if (!run) return Response.json({ error: 'no_mystery' }, { status: 409 })

    const stored =
      typeof run.progress === 'string'
        ? (JSON.parse(run.progress) as StoredMysteryProgress)
        : run.progress
    const pending = stored.pendingMystery
    if (!pending || !Array.isArray(pending) || pending.length !== 2) {
      return Response.json({ error: 'no_mystery' }, { status: 409 })
    }
    const prizes: [MysteryPrize, MysteryPrize] | null = pending.every(prizeFromStored)
      ? [prizeFromStored(pending[0])!, prizeFromStored(pending[1])!]
      : null
    if (!prizes) return Response.json({ error: 'no_mystery' }, { status: 409 })

    const progress = {
      ...stored,
      lifelines: {
        fiftyFifty: 0,
        shield: false,
        ...stored.lifelines,
      },
    } as unknown as RunProgress & StoredMysteryProgress
    const applied = applyMysteryPrize(progress, prizes[input.pick])
    const nextProgress: StoredMysteryProgress = { ...applied }
    delete nextProgress.pendingMystery

    const updated = (await sql`
      update runs
      set progress = ${JSON.stringify(nextProgress)}::jsonb
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
        and status = 'active'
        and (progress -> 'pendingMystery') is not null
      returning id
    `) as { id: string }[]
    if (!updated[0]) return Response.json({ error: 'no_mystery' }, { status: 409 })

    return Response.json({
      picked: input.pick,
      prizes: prizes.map(describePrize),
      applied: describePrize(prizes[input.pick]),
      progress: {
        score: applied.score,
        strikes: applied.strikes,
        streak: applied.streak,
        correct: correctCount(applied),
        lifelines: applied.lifelines,
      },
    })
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
