import { getSql } from '../lib/db.js'
import { hashRunToken, isRunToken } from '../lib/runToken.js'
import { publicQuestion, questionsById } from '../lib/questions.js'
import { REEL_MS } from '../src/game/engine.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type QuestionInput = { runId: string; runToken: string; questionIndex: number }

function parseQuestionInput(value: unknown): QuestionInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const { runId, runToken, questionIndex } = value as Record<string, unknown>
  if (
    typeof runId !== 'string' ||
    !UUID_PATTERN.test(runId) ||
    !isRunToken(runToken) ||
    !Number.isInteger(questionIndex) ||
    (questionIndex as number) < 0 ||
    (questionIndex as number) > 500
  ) {
    return null
  }
  return { runId, runToken, questionIndex: questionIndex as number }
}

// Reveals the run's current question and starts its clock. Repeat calls
// return the same question, keep the first start time, and report how long
// the clock has already been running.
export async function POST(request: Request): Promise<Response> {
  let input: QuestionInput | null
  try {
    input = parseQuestionInput(await request.json())
  } catch {
    input = null
  }
  if (!input) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const sql = getSql()
    const rows = (await sql`
      update runs
      set issued_at = coalesce(issued_at, now() + make_interval(secs => ${REEL_MS / 1000}))
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
        and question_index = ${input.questionIndex}
        and status = 'active'
      returning current_question_id, current_choices,
        greatest(0, floor(extract(epoch from (now() - issued_at)) * 1000))::bigint as elapsed_ms
    `) as {
      current_question_id: string | null
      current_choices: string[] | null
      elapsed_ms: number | string | null
    }[]
    const row = rows[0]
    if (!row) return Response.json({ error: 'stale' }, { status: 409 })

    const question = row.current_question_id
      ? questionsById.get(row.current_question_id)
      : undefined
    if (!question || !row.current_choices) {
      return Response.json({ error: 'server_error' }, { status: 500 })
    }
    return Response.json({
      questionIndex: input.questionIndex,
      question: publicQuestion(question, row.current_choices),
      elapsedMs: Number(row.elapsed_ms ?? 0),
    })
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
