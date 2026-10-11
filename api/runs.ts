import { createHash } from 'node:crypto'
import { getSql } from '../lib/db.js'
import { questionBank } from '../lib/questions.js'
import {
  createRunProgress,
  dailyQuestions,
  presentQuestion,
  selectClassicQuestion,
  type ClassicOptions,
} from '../src/game/engine.js'
import type { Question, Side, Sport } from '../src/game/types.js'

type StartInput =
  | { mode: 'daily' }
  | { mode: 'classic'; sport: 'all' | Sport; side: 'both' | Side }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStartInput(value: unknown): StartInput | null {
  if (!isRecord(value)) return null
  if (value.mode === 'daily') return { mode: 'daily' }
  if (
    value.mode !== 'classic' ||
    !['all', 'football', 'basketball', 'baseball'].includes(
      String(value.sport),
    ) ||
    !['both', 'rules', 'players'].includes(String(value.side))
  ) {
    return null
  }
  return {
    mode: 'classic',
    sport: value.sport as 'all' | Sport,
    side: value.side as 'both' | Side,
  }
}

function publicQuestion(
  question: Question,
  choices: string[],
): Record<string, unknown> {
  return {
    id: question.id,
    side: question.side,
    sport: question.sport,
    leagues: question.leagues,
    difficulty: question.difficulty,
    category: question.category,
    prompt: question.prompt,
    choices,
    ...(question.reel ? { reel: question.reel } : {}),
  }
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function POST(request: Request): Promise<Response> {
  let input: StartInput | null
  try {
    input = parseStartInput(await request.json())
  } catch {
    input = null
  }
  if (!input) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const sql = getSql()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const salt = process.env.RUN_HASH_SALT || 'streaking-sports-development-salt'
    const ipHash = createHash('sha256').update(`${salt}${ip || 'local'}`).digest('hex')
    const rawLimit = process.env.RUNS_PER_IP_PER_DAY
    const configuredLimit = rawLimit === undefined ? 100 : Number(rawLimit)
    const limit =
      Number.isInteger(configuredLimit) && configuredLimit >= 0
        ? configuredLimit
        : 100
    const rateRows = (await sql`
      select count(*)::int as count
      from runs
      where ip_hash = ${ipHash}
        and created_at >= now() - interval '24 hours'
    `) as { count: number | string }[]
    if (Number(rateRows[0]?.count ?? 0) >= limit) {
      return Response.json({ error: 'rate_limited' }, { status: 429 })
    }

    const date = utcDate()
    let question: Question
    let choices: string[]
    let options: ClassicOptions = { sport: 'all', side: 'both' }
    let dailyDate: string | null = null

    if (input.mode === 'daily') {
      dailyDate = date
      question = dailyQuestions(date, questionBank)[0]
      ;({ choices } = presentQuestion(question, Math.random))
    } else {
      options = { sport: input.sport, side: input.side }
      const selection = selectClassicQuestion(
        questionBank,
        new Set(),
        0,
        options,
        Math.random,
      )
      if (selection.type === 'end') {
        return Response.json({ error: 'no_questions' }, { status: 409 })
      }
      question = selection.question
      choices = selection.choices
    }

    const initialProgress = createRunProgress()
    const [choice0, choice1, choice2, choice3] = choices
    const inserted = (await sql`
      insert into runs (
        mode,
        sport,
        side,
        daily_date,
        status,
        progress,
        used_fact_ids,
        question_index,
        current_question_id,
        current_choices,
        issued_at,
        ip_hash
      )
      values (
        ${input.mode},
        ${options.sport},
        ${options.side},
        ${dailyDate},
        'active',
        ${JSON.stringify({ ...initialProgress, missed: [] })}::jsonb,
        ARRAY[${question.factId}]::text[],
        0,
        ${question.id},
        ARRAY[${choice0}, ${choice1}, ${choice2}, ${choice3}]::text[],
        now(),
        ${ipHash}
      )
      returning id
    `) as { id: string }[]
    const runId = inserted[0]?.id
    if (!runId) throw new Error('Run insert returned no id')

    return Response.json(
      {
        runId,
        date,
        questionIndex: 0,
        question: publicQuestion(question, choices),
        progress: {
          score: initialProgress.score,
          strikes: initialProgress.strikes,
          streak: initialProgress.streak,
        },
        total: input.mode === 'daily' ? 10 : null,
      },
      { status: 201 },
    )
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
