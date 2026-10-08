import { questionBank } from '../src/game/content'
import { getSql } from '../lib/db'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const questionIds = new Set(questionBank.map((question) => question.id))

type AnswerBody = {
  runId: string
  mode: 'classic' | 'daily'
  questionId: string
  questionIndex: number
  answerMs: number | null
  correct: boolean
}

function isAnswerBody(value: unknown): value is AnswerBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const body = value as Record<string, unknown>

  return (
    typeof body.runId === 'string' &&
    UUID_PATTERN.test(body.runId) &&
    (body.mode === 'classic' || body.mode === 'daily') &&
    typeof body.questionId === 'string' &&
    questionIds.has(body.questionId) &&
    Number.isInteger(body.questionIndex) &&
    (body.questionIndex as number) >= 0 &&
    (body.questionIndex as number) <= 500 &&
    (body.answerMs === null ||
      (Number.isInteger(body.answerMs) &&
        (body.answerMs as number) >= 0 &&
        (body.answerMs as number) <= 10_000)) &&
    typeof body.correct === 'boolean'
  )
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  if (!isAnswerBody(body)) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  try {
    const sql = getSql()
    await sql`
      insert into answer_log (
        run_id, mode, question_id, question_index, answer_ms, correct
      ) values (
        ${body.runId}, ${body.mode}, ${body.questionId}, ${body.questionIndex},
        ${body.answerMs}, ${body.correct}
      )
    `
    return new Response(null, { status: 204 })
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
