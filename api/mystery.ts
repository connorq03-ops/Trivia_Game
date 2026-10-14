import { getSql } from '../lib/db.js'
import { hashRunToken, isRunToken } from '../lib/runToken.js'
import {
  correctCount,
  type Lifelines,
  type MysteryPrize,
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
  results?: string[]
  questionsAnswered?: number
  missed?: unknown[]
  bossMisses?: number
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

type ProgressRow = {
  score: number
  strikes: number
  streak: number
  results: string[]
  questionsAnswered: number
  missed: unknown[]
  bossMisses?: number
  lifelines?: Lifelines
}

// Applies the player's mystery-box pick. The two prizes were drawn and stored
// on the boss hit; the pick is only valid while pendingMystery is set, so a
// replayed or forged request gets a 409 and the prizes can't be redrawn.
// The prize is applied inside the UPDATE expression itself (computed from the
// row under its write lock), so a pick racing an answer or a 50/50 can't
// overwrite either one's changes with a stale whole-progress snapshot.
// A pending box is also claimable on a just-ended run (a final boss hit can
// end the run), and the stored summary is updated to match.
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
      select status, progress
      from runs
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
        and mode = 'classic'
      limit 1
    `) as {
      status: string
      progress: StoredMysteryProgress | string
    }[]
    const run = rows[0]
    if (!run) return Response.json({ error: 'no_mystery' }, { status: 409 })

    const stored =
      typeof run.progress === 'string'
        ? (JSON.parse(run.progress) as StoredMysteryProgress)
        : run.progress
    const progressFor = (p: StoredMysteryProgress) => ({
      score: p.score ?? 0,
      strikes: p.strikes ?? 0,
      streak: p.streak ?? 0,
      lifelines: p.lifelines ?? { fiftyFifty: 0, shield: false },
    })
    const pending = stored.pendingMystery
    if (!pending || !Array.isArray(pending) || pending.length !== 2) {
      // The box is gone — most often because the player's pick already applied
      // and the response was lost. Send authoritative progress so the client
      // can still reflect the prize (e.g. bonus points) before moving on.
      return Response.json(
        { error: 'no_mystery', progress: progressFor(stored) },
        { status: 409 },
      )
    }
    const prize0 = prizeFromStored(pending[0])
    const prize1 = prizeFromStored(pending[1])
    if (!prize0 || !prize1) {
      return Response.json(
        { error: 'no_mystery', progress: progressFor(stored) },
        { status: 409 },
      )
    }
    const prizes: [MysteryPrize, MysteryPrize] = [prize0, prize1]
    const prize = prizes[input.pick]

    // One guarded UPDATE per prize kind: the new value is computed from the
    // locked row, never from the select's snapshot.
    const update =
      prize.kind === 'points'
        ? sql`
            update runs
            set progress = jsonb_set(
              progress - 'pendingMystery',
              '{score}',
              to_jsonb(coalesce((progress ->> 'score')::int, 0) + ${prize.points}::int)
            )
            where id = ${input.runId}
              and token_hash = ${hashRunToken(input.runToken)}
              and (progress -> 'pendingMystery') is not null
            returning progress
          `
        : prize.kind === 'fiftyFifty'
          ? sql`
              update runs
              set progress = jsonb_set(
                progress - 'pendingMystery',
                '{lifelines}',
                coalesce(progress -> 'lifelines', '{}'::jsonb)
                  || jsonb_build_object(
                    'fiftyFifty',
                    coalesce((progress #>> '{lifelines,fiftyFifty}')::int, 0) + 1
                  )
              )
              where id = ${input.runId}
                and token_hash = ${hashRunToken(input.runToken)}
                and (progress -> 'pendingMystery') is not null
              returning progress
            `
          : prize.kind === 'strikeEraser'
            ? sql`
                update runs
                set progress = jsonb_set(
                  progress - 'pendingMystery',
                  '{strikes}',
                  to_jsonb(greatest((progress ->> 'strikes')::int - 1, 0))
                )
                where id = ${input.runId}
                  and token_hash = ${hashRunToken(input.runToken)}
                  and (progress -> 'pendingMystery') is not null
                returning progress
              `
            : prize.kind === 'shield'
              ? sql`
                  update runs
                  set progress = jsonb_set(
                    progress - 'pendingMystery',
                    '{lifelines}',
                    coalesce(progress -> 'lifelines', '{}'::jsonb)
                      || '{"shield": true}'::jsonb
                  )
                  where id = ${input.runId}
                    and token_hash = ${hashRunToken(input.runToken)}
                    and (progress -> 'pendingMystery') is not null
                  returning progress
                `
              : sql`
                  update runs
                  set progress = progress - 'pendingMystery'
                  where id = ${input.runId}
                    and token_hash = ${hashRunToken(input.runToken)}
                    and (progress -> 'pendingMystery') is not null
                  returning progress
                `

    const updated = (await update) as { progress: ProgressRow | string }[]
    const updatedRow = updated[0]
    if (!updatedRow) return Response.json({ error: 'no_mystery' }, { status: 409 })

    const applied =
      typeof updatedRow.progress === 'string'
        ? (JSON.parse(updatedRow.progress) as ProgressRow)
        : updatedRow.progress

    // A final boss hit can end the run before the box opens; keep the stored
    // summary's score in step so a replayed answer reports the same result.
    if (prize.kind === 'points' || prize.kind === 'strikeEraser') {
      await sql`
        update runs
        set last_response = jsonb_set(
          jsonb_set(last_response, '{summary,score}', to_jsonb(${applied.score}::int)),
          '{progress,score}', to_jsonb(${applied.score}::int)
        )
        where id = ${input.runId}
          and last_response ? 'summary'
      `
    }

    return Response.json({
      picked: input.pick,
      prizes: prizes.map(describePrize),
      applied: describePrize(prize),
      progress: {
        score: applied.score,
        strikes: applied.strikes,
        streak: applied.streak,
        correct: correctCount({
          results: (applied.results ?? []) as ProgressRow['results'] & never[],
          questionsAnswered: applied.questionsAnswered ?? 0,
          missed: (applied.missed ?? []) as ProgressRow['missed'] & never[],
          bossMisses: applied.bossMisses ?? 0,
        } as Parameters<typeof correctCount>[0]),
        lifelines: applied.lifelines ?? { fiftyFifty: 0, shield: false },
      },
    })
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
