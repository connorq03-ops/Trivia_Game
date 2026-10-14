import { getSql } from '../lib/db.js'
import { hashRunToken, isRunToken } from '../lib/runToken.js'
import { publicQuestion, questionsById } from '../lib/questions.js'
import type { Lifelines } from '../src/game/engine.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LifelineInput = {
  runId: string
  runToken: string
  questionIndex: number
  kind: 'fiftyFifty'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLifelineInput(value: unknown): LifelineInput | null {
  if (
    !isRecord(value) ||
    typeof value.runId !== 'string' ||
    !UUID_PATTERN.test(value.runId) ||
    !isRunToken(value.runToken) ||
    !Number.isInteger(value.questionIndex) ||
    (value.questionIndex as number) < 0 ||
    (value.questionIndex as number) > 500 ||
    value.kind !== 'fiftyFifty'
  ) {
    return null
  }
  return {
    runId: value.runId,
    runToken: value.runToken as string,
    questionIndex: value.questionIndex as number,
    kind: 'fiftyFifty',
  }
}

type StoredLifelineProgress = {
  lifelines?: Lifelines
  [key: string]: unknown
}

// Spends a stored 50/50 charge: rewrites the current question's choices to the
// answer plus one wrong option. Idempotent per question — a second call on the
// same question index returns the narrowed choices without burning a charge.
// The server clock keeps running the whole time.
export async function POST(request: Request): Promise<Response> {
  let input: LifelineInput | null
  try {
    input = parseLifelineInput(await request.json())
  } catch {
    input = null
  }
  if (!input) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const sql = getSql()
    const rows = (await sql`
      select mode, progress, current_question_id, current_choices,
        (issued_at is not null and issued_at <= now()) as revealed
      from runs
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
        and question_index = ${input.questionIndex}
        and mode = 'classic'
        and status = 'active'
      limit 1
    `) as {
      mode: string
      progress: StoredLifelineProgress | string
      current_question_id: string | null
      current_choices: string[] | null
      revealed: boolean
    }[]
    const run = rows[0]
    if (!run) return Response.json({ error: 'not_found' }, { status: 404 })

    // The 50/50 is only fair while the question clock is running. Before the
    // reveal (issued_at unset or still in the future while the reel spins), a
    // narrowed 2-choice board could be studied untimed.
    if (!run.revealed) {
      return Response.json({ error: 'not_revealed' }, { status: 409 })
    }

    const question = run.current_question_id
      ? questionsById.get(run.current_question_id)
      : undefined
    if (!question || !run.current_choices) {
      return Response.json({ error: 'server_error' }, { status: 500 })
    }

    const stored =
      typeof run.progress === 'string'
        ? (JSON.parse(run.progress) as StoredLifelineProgress)
        : run.progress
    const lifelines: Lifelines = {
      fiftyFifty: 0,
      shield: false,
      ...stored.lifelines,
    }

    // Same-question replay: the charge was already spent and the choices are
    // already narrowed, so just hand them back.
    if (lifelines.fiftyFiftyUsedOn === input.questionIndex) {
      return Response.json({
        question: publicQuestion(question, run.current_choices),
        lifelines,
      })
    }
    if (lifelines.fiftyFifty < 1) {
      return Response.json({ error: 'no_charges' }, { status: 409 })
    }

    const kept = [
      question.answer,
      question.wrong[Math.floor(Math.random() * question.wrong.length)],
    ].sort(() => Math.random() - 0.5)
    // Decrement the charge and stamp the question index inside the UPDATE
    // itself so a concurrent write to other lifelines fields isn't clobbered.
    const updated = (await sql`
      update runs
      set
        current_choices = ARRAY[${kept[0]}, ${kept[1]}]::text[],
        progress = jsonb_set(
          jsonb_set(
            progress,
            '{lifelines,fiftyFifty}',
            to_jsonb(
              coalesce((progress #>> '{lifelines,fiftyFifty}')::int, 0) - 1
            )
          ),
          '{lifelines,fiftyFiftyUsedOn}',
          to_jsonb(${input.questionIndex})
        )
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
        and question_index = ${input.questionIndex}
        and status = 'active'
        and coalesce((progress -> 'lifelines' ->> 'fiftyFifty')::int, 0) > 0
        and coalesce(
          (progress -> 'lifelines' ->> 'fiftyFiftyUsedOn')::int, -1
        ) <> ${input.questionIndex}
      returning progress
    `) as { progress: StoredLifelineProgress | string }[]
    const updatedRow = updated[0]
    if (!updatedRow) return Response.json({ error: 'stale' }, { status: 409 })

    const appliedProgress =
      typeof updatedRow.progress === 'string'
        ? (JSON.parse(updatedRow.progress) as StoredLifelineProgress)
        : updatedRow.progress
    const nextLifelines: Lifelines = {
      fiftyFifty: 0,
      shield: false,
      ...appliedProgress.lifelines,
    }

    return Response.json({
      question: publicQuestion(question, kept),
      lifelines: nextLifelines,
    })
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
