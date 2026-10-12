import { getSql } from '../lib/db.js'
import { hashRunToken, isRunToken } from '../lib/runToken.js'
import { questionBank, questionsById } from '../lib/questions.js'
import {
  answerQuestion,
  dailyQuestions,
  presentQuestion,
  resolveAnswerMs,
  selectClassicQuestion,
  type AnswerResult,
  type RunProgress,
} from '../src/game/engine.js'
import type { Question } from '../src/game/types.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AnswerInput = {
  runId: string
  runToken: string
  questionIndex: number
  choice: string | null
  clientMs: number | null
}

type StoredProgress = Omit<RunProgress, 'missed' | 'results'> & {
  missed: string[]
  results?: AnswerResult[]
}

type RunRow = {
  mode: 'classic' | 'daily'
  sport: string
  side: string
  daily_date: string | Date | null
  status: 'active' | 'ended'
  progress: StoredProgress | string
  used_fact_ids: string[] | null
  question_index: number
  current_question_id: string | null
  current_choices: string[] | null
  last_response: unknown
  server_ms: number | string | null
  created_at: string | Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAnswerInput(value: unknown): AnswerInput | null {
  if (
    !isRecord(value) ||
    typeof value.runId !== 'string' ||
    !UUID_PATTERN.test(value.runId) ||
    !isRunToken(value.runToken) ||
    !Number.isInteger(value.questionIndex) ||
    (value.questionIndex as number) < 0 ||
    (value.questionIndex as number) > 500 ||
    !(typeof value.choice === 'string' || value.choice === null) ||
    !(
      value.clientMs === null ||
      (Number.isInteger(value.clientMs) &&
        (value.clientMs as number) >= 0 &&
        (value.clientMs as number) <= 60_000)
    )
  ) {
    return null
  }
  return {
    runId: value.runId,
    runToken: value.runToken as string,
    questionIndex: value.questionIndex as number,
    choice: value.choice,
    clientMs: value.clientMs as number | null,
  }
}

function responseFromJson(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value) as unknown
  return value
}

function deserializeProgress(value: RunRow['progress']): RunProgress {
  const stored =
    typeof value === 'string' ? (JSON.parse(value) as StoredProgress) : value
  const missed = stored.missed
    .map((id) => questionsById.get(id))
    .filter((question): question is Question => question !== undefined)
  return { ...stored, missed, results: stored.results ?? [] }
}

function serializeProgress(progress: RunProgress): StoredProgress {
  return { ...progress, missed: progress.missed.map((question) => question.id) }
}

function dateOnly(value: string | Date | null): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}


export async function POST(request: Request): Promise<Response> {
  let input: AnswerInput | null
  try {
    input = parseAnswerInput(await request.json())
  } catch {
    input = null
  }
  if (!input) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const sql = getSql()
    const rows = (await sql`
      select
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
        last_response,
        created_at,
        case
          when issued_at is null then null
          else greatest(
            0,
            floor(extract(epoch from (now() - issued_at)) * 1000)
          )::bigint
        end as server_ms
      from runs
      where id = ${input.runId}
        and token_hash = ${hashRunToken(input.runToken)}
      limit 1
    `) as RunRow[]
    const run = rows[0]
    if (!run) return Response.json({ error: 'not_found' }, { status: 404 })

    if (
      input.questionIndex === run.question_index - 1 &&
      run.last_response !== null
    ) {
      return Response.json(responseFromJson(run.last_response))
    }
    if (run.status !== 'active' || input.questionIndex !== run.question_index) {
      return Response.json({ error: 'stale' }, { status: 409 })
    }

    const question = run.current_question_id
      ? questionsById.get(run.current_question_id)
      : undefined
    if (!question || !run.current_choices) {
      return Response.json({ error: 'server_error' }, { status: 500 })
    }
    if (run.server_ms === null) {
      return Response.json({ error: 'not_revealed' }, { status: 409 })
    }
    if (input.choice !== null && !run.current_choices.includes(input.choice)) {
      return Response.json({ error: 'invalid_choice' }, { status: 400 })
    }

    const correct = input.choice === question.answer
    const answerMs = resolveAnswerMs(input.clientMs, Number(run.server_ms))
    const outcome = answerQuestion(
      deserializeProgress(run.progress),
      question,
      correct,
      answerMs,
    )
    const usedFactIds = new Set(run.used_fact_ids ?? [])
    usedFactIds.add(question.factId)

    let next: { question: Question; choices: string[] } | null = null
    let endReason: 'strikes' | 'bank' | 'complete' | null = null
    const nextQuestionIndex = input.questionIndex + 1

    if (run.mode === 'classic') {
      if (outcome.endReason) {
        endReason = 'strikes'
      } else {
        const selection = selectClassicQuestion(
          questionBank,
          usedFactIds,
          nextQuestionIndex + 1,
          {
            sport: run.sport as 'all' | Question['sport'],
            side: run.side as 'both' | Question['side'],
          },
          Math.random,
        )
        if (selection.type === 'end') {
          endReason = 'bank'
        } else {
          next = { question: selection.question, choices: selection.choices }
        }
      }
    } else {
      const date = dateOnly(run.daily_date)
      const questions = dailyQuestions(date, questionBank)
      if (nextQuestionIndex >= questions.length) {
        endReason = 'complete'
      } else {
        next = presentQuestion(questions[nextQuestionIndex], Math.random)
      }
    }

    const summary =
      endReason === null
        ? null
        : {
            mode: run.mode,
            date: run.daily_date
              ? dateOnly(run.daily_date)
              : dateOnly(run.created_at),
            score: outcome.progress.score,
            bestStreak: outcome.progress.bestStreak,
            questionsAnswered: outcome.progress.questionsAnswered,
            answeredCount: outcome.progress.answeredCount,
            totalAnswerMs: outcome.progress.totalAnswerMs,
            missed: outcome.progress.missed,
            results:
              outcome.progress.results.length ===
              outcome.progress.questionsAnswered
                ? outcome.progress.results
                : undefined,
            reason: endReason,
          }
    const nextPublic = next ? { questionIndex: nextQuestionIndex } : null
    const responseBody = {
      correct: outcome.correct,
      points: outcome.points,
      answer: question.answer,
      teach: question.teach,
      source: question.source,
      progress: {
        score: outcome.progress.score,
        strikes: outcome.progress.strikes,
        streak: outcome.progress.streak,
      },
      next: nextPublic,
      summary,
    }
    const nextQuestionId = next?.question.id ?? null
    const [choice0, choice1, choice2, choice3] = next?.choices ?? [
      null,
      null,
      null,
      null,
    ]
    const status = endReason === null ? 'active' : 'ended'
    const logged = (await sql`
      with updated as (
        update runs
        set
          progress = ${JSON.stringify(serializeProgress(outcome.progress))}::jsonb,
          used_fact_ids = case
            when ${question.factId} = any(used_fact_ids) then used_fact_ids
            else array_append(used_fact_ids, ${question.factId})
          end,
          current_question_id = ${nextQuestionId},
          current_choices = case
            when ${nextQuestionId}::text is null then null
            else ARRAY[${choice0}, ${choice1}, ${choice2}, ${choice3}]::text[]
          end,
          status = ${status},
          end_reason = ${endReason},
          question_index = question_index + 1,
          last_response = ${JSON.stringify(responseBody)}::jsonb,
          issued_at = null,
          ended_at = case when ${status} = 'ended' then now() else null end
        where id = ${input.runId}
          and question_index = ${input.questionIndex}
          and status = 'active'
        returning id
      )
      insert into answer_log (
        run_id,
        mode,
        question_id,
        question_index,
        answer_ms,
        correct
      )
      select
        id,
        ${run.mode},
        ${question.id},
        ${input.questionIndex},
        ${outcome.answerMs},
        ${outcome.correct}
      from updated
      returning run_id
    `) as { run_id: string }[]
    if (!logged[0]) return Response.json({ error: 'stale' }, { status: 409 })

    return Response.json(responseBody)
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
