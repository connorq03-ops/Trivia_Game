import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { questionBank } from '../lib/questions.js'
import { dailyQuestions } from '../src/game/engine.js'
import { POST } from './answer.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

const runId = '123e4567-e89b-12d3-a456-426614174000'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeRun(
  question = questionBank[0],
  overrides: Record<string, unknown> = {},
) {
  return {
    mode: 'classic',
    sport: 'all',
    side: 'both',
    daily_date: null,
    status: 'active',
    progress: {
      score: 0,
      strikes: 0,
      streak: 0,
      bestStreak: 0,
      questionsAnswered: 0,
      answeredCount: 0,
      totalAnswerMs: 0,
      missed: [],
    },
    used_fact_ids: [question.factId],
    question_index: 0,
    current_question_id: question.id,
    current_choices: [question.answer, ...question.wrong],
    last_response: null,
    server_ms: 2000,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mockSql({
  rows = [makeRun()],
  updated = [{ id: runId }],
}: {
  rows?: unknown[]
  updated?: unknown[]
} = {}) {
  const sql = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
    const query = strings.join(' ').toLowerCase()
    if (query.includes('from runs')) return Promise.resolve(rows)
    if (query.includes('update runs')) return Promise.resolve(updated)
    return Promise.resolve([])
  })
  vi.mocked(getSql).mockReturnValue(sql as never)
  return sql
}

const validBody = {
  runId,
  questionIndex: 0,
  choice: questionBank[0].answer,
  clientMs: 1000,
}

describe('answer handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 404 for a missing run', async () => {
    mockSql({ rows: [] })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  })

  it('returns 400 when the choice was not issued for the question', async () => {
    mockSql()
    const response = await POST(
      makeRequest({ ...validBody, choice: 'not an issued choice' }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_choice' })
  })

  it('returns 409 for a stale question index', async () => {
    mockSql({ rows: [makeRun(questionBank[0], { question_index: 2 })] })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale' })
  })

  it('returns 409 when the guarded update loses a race', async () => {
    const sql = mockSql({ updated: [] })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale' })
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('returns the cached response for an idempotent retry', async () => {
    const cached = { correct: true, points: 300, next: null, summary: null }
    mockSql({
      rows: [makeRun(questionBank[0], { question_index: 1, last_response: cached })],
    })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(cached)
  })

  it('grades a correct answer and awards points on the server', async () => {
    const sql = mockSql()
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.correct).toBe(true)
    expect(body.points).toBeGreaterThan(0)
    expect(body.answer).toBe(questionBank[0].answer)
    expect(sql.mock.calls.some(([strings]) => strings.join(' ').includes('insert into answer_log'))).toBe(true)
  })

  it('ends a Classic run on its third strike', async () => {
    const question = questionBank[0]
    mockSql({
      rows: [
        makeRun(question, {
          progress: {
            ...makeRun(question).progress,
            strikes: 2,
          },
        }),
      ],
    })
    const response = await POST(
      makeRequest({ ...validBody, choice: question.wrong[0] }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.progress.strikes).toBe(3)
    expect(body.next).toBeNull()
    expect(body.summary.reason).toBe('strikes')
  })

  it('completes Daily 10 after the tenth answer regardless of strikes', async () => {
    const dailyDate = '2099-12-31'
    const daily = dailyQuestions(dailyDate, questionBank)
    const question = daily[9]
    const run = makeRun(question, {
      mode: 'daily',
      daily_date: dailyDate,
      question_index: 9,
      used_fact_ids: daily.map((item) => item.factId),
      progress: {
        ...makeRun(question).progress,
        questionsAnswered: 9,
        strikes: 2,
      },
    })
    mockSql({ rows: [run] })
    const response = await POST(
      makeRequest({
        ...validBody,
        questionIndex: 9,
        choice: question.wrong[0],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.progress.strikes).toBe(3)
    expect(body.next).toBeNull()
    expect(body.summary.reason).toBe('complete')
    expect(body.summary.questionsAnswered).toBe(10)
  })
})
