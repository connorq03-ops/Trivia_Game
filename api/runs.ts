import { createHash } from 'node:crypto'
import { getSql } from '../lib/db.js'
import { bossQuestionsEnabled } from '../lib/flags.js'
import { createRunToken, hashRunToken, isRunToken } from '../lib/runToken.js'
import {
  publicQuestion,
  questionBank,
  questionsById,
} from '../lib/questions.js'
import { dailyDateKey } from '../src/game/dailyStore.js'
import {
  correctCount,
  createRunProgress,
  dailyQuestions,
  presentQuestion,
  REEL_MS,
  selectClassicQuestion,
  type AnswerResult,
  type ClassicOptions,
  type Lifelines,
} from '../src/game/engine.js'
import type { Question, Side, Sport } from '../src/game/types.js'

type StartInput =
  | { mode: 'daily'; resume?: ResumeInput }
  | { mode: 'classic'; sport: 'all' | Sport; side: 'both' | Side; resume?: ResumeInput }

type ResumeInput = { runId: string; runToken: string }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_RUN_ID = '00000000-0000-0000-0000-000000000000'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseResume(value: unknown): ResumeInput | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (
    !isRecord(value) ||
    typeof value.runId !== 'string' ||
    !UUID_PATTERN.test(value.runId) ||
    !isRunToken(value.runToken)
  ) {
    return 'invalid'
  }
  return { runId: value.runId, runToken: value.runToken as string }
}

function parseStartInput(value: unknown): StartInput | null {
  if (!isRecord(value)) return null
  const resume = parseResume(value.resume)
  if (resume === 'invalid') return null
  if (value.mode === 'daily') {
    return resume ? { mode: 'daily', resume } : { mode: 'daily' }
  }
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
    ...(resume ? { resume } : {}),
  }
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
    // On Vercel these headers come from the edge, not from the client.
    const ip =
      request.headers.get('x-real-ip')?.trim() ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const salt = process.env.RUN_HASH_SALT || 'streaking-sports-development-salt'
    const ipHash = createHash('sha256').update(`${salt}${ip || 'local'}`).digest('hex')
    const rawLimit = process.env.RUNS_PER_IP_PER_DAY
    const configuredLimit = rawLimit === undefined ? 100 : Number(rawLimit)
    const limit =
      Number.isInteger(configuredLimit) && configuredLimit >= 0
        ? configuredLimit
        : 100

    const date = dailyDateKey()
    let question: Question
    let choices: string[]
    let options: ClassicOptions = { sport: 'all', side: 'both' }
    let dailyDate: string | null = null
    let dailyQuestionIds: string[] | undefined

    if (input.mode === 'daily') {
      dailyDate = date
      const questions = dailyQuestions(date, questionBank)
      question = questions[0]
      dailyQuestionIds = questions.map((item) => item.id)
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
    if (dailyQuestionIds) initialProgress.dailyQuestionIds = dailyQuestionIds
    const [choice0, choice1, choice2, choice3] = choices
    const runToken = createRunToken()
    // Resume instead of replace: a client that still holds the runToken for
    // an active run gets that run back, so backing out or refreshing can't
    // dodge a miss. The token is the credential — matching on ip_hash alone
    // would let a shared-IP player take over someone else's run.
    const resumeId = input.resume?.runId ?? NO_RUN_ID
    const resumeTokenHash = hashRunToken(input.resume?.runToken ?? '')
    // A run is only resumable under the same game parameters: today's date for
    // Daily, the same sport/side filters for Classic.
    const resumeFilter =
      input.mode === 'daily'
        ? sql`and mode = 'daily' and daily_date = ${date}::date`
        : sql`and mode = 'classic' and sport = ${input.sport} and side = ${input.side}`
    const resumeQuery = sql`
      select id, question_index, current_question_id, current_choices,
        progress, daily_date
      from runs
      where id = ${resumeId}::uuid
        and token_hash = ${resumeTokenHash}
        and status = 'active'
        ${resumeFilter}
      limit 1
    `
    const [, resumed, inserted] = (await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`,
      resumeQuery,
      sql`
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
          ip_hash,
          token_hash
        )
        select
          ${input.mode},
          ${options.sport},
          ${options.side},
          ${dailyDate}::date,
          'active',
          ${JSON.stringify({ ...initialProgress, missed: [] })}::jsonb,
          ARRAY[${question.factId}]::text[],
          0,
          ${question.id},
          ARRAY[${choice0}, ${choice1}, ${choice2}, ${choice3}]::text[],
          now() + make_interval(secs => ${REEL_MS / 1000}),
          ${ipHash},
          ${hashRunToken(runToken)}
        where (
          select count(*)
          from runs
          where ip_hash = ${ipHash}
            and created_at >= now() - interval '24 hours'
        ) < ${limit}
          and not exists (
            select 1 from runs
            where id = ${resumeId}::uuid
              and token_hash = ${resumeTokenHash}
              and status = 'active'
              ${resumeFilter}
          )
        returning id
      `,
    ])) as [
      unknown,
      {
        id: string
        question_index: number
        current_question_id: string | null
        current_choices: string[] | null
        progress: {
          score: number
          strikes: number
          streak: number
          results?: string[]
          questionsAnswered: number
          missed: string[]
          bossMisses?: number
        } | string | null
        daily_date: string | Date | null
      }[],
      { id: string }[],
    ]
    const resumedRun = resumed[0]
    if (resumedRun) {
      const stored = (
        typeof resumedRun.progress === 'string'
          ? JSON.parse(resumedRun.progress)
          : resumedRun.progress
      ) as {
        score?: number
        strikes?: number
        streak?: number
        results?: AnswerResult[]
        questionsAnswered?: number
        missed?: Question[]
        bossMisses?: number
        lifelines?: Lifelines
        pendingMystery?: unknown[]
      } | null
      const liveQuestion = resumedRun.current_question_id
        ? questionsById.get(resumedRun.current_question_id)
        : undefined
      if (!liveQuestion || !resumedRun.current_choices) {
        return Response.json({ error: 'server_error' }, { status: 500 })
      }
      return Response.json({
        runId: resumedRun.id,
        runToken: input.resume?.runToken ?? runToken,
        date: resumedRun.daily_date
          ? String(resumedRun.daily_date).slice(0, 10)
          : date,
        questionIndex: resumedRun.question_index,
        question: publicQuestion(liveQuestion, resumedRun.current_choices, {
          bonus: input.mode === 'daily',
        }),
        progress: {
          score: stored?.score ?? 0,
          strikes: stored?.strikes ?? 0,
          streak: stored?.streak ?? 0,
          correct: correctCount({
            results: stored?.results ?? [],
            questionsAnswered: stored?.questionsAnswered ?? 0,
            missed: stored?.missed ?? [],
            bossMisses: stored?.bossMisses ?? 0,
          }),
          lifelines: stored?.lifelines ?? { fiftyFifty: 0, shield: false },
        },
        total: input.mode === 'daily' ? 10 : null,
        bosses: bossQuestionsEnabled(),
        // An unresolved mystery box survives a refresh: opaque flag only, the
        // prizes stay hidden until the pick.
        ...(Array.isArray(stored?.pendingMystery) && stored.pendingMystery.length === 2
          ? { mystery: ['a', 'b'] }
          : {}),
      })
    }
    if (!inserted[0]) {
      return Response.json({ error: 'rate_limited' }, { status: 429 })
    }
    const runId = inserted[0]?.id
    if (!runId) throw new Error('Run insert returned no id')

    return Response.json(
      {
        runId,
        runToken,
        date,
        questionIndex: 0,
        question: publicQuestion(question, choices, {
          bonus: input.mode === 'daily',
        }),
        progress: {
          score: initialProgress.score,
          strikes: initialProgress.strikes,
          streak: initialProgress.streak,
          correct: 0,
          lifelines: initialProgress.lifelines,
        },
        total: input.mode === 'daily' ? 10 : null,
        bosses: bossQuestionsEnabled(),
      },
      { status: 201 },
    )
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
