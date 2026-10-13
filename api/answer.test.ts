import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { questionBank } from '../lib/questions.js'
import { hashRunToken } from '../lib/runToken.js'
import { dailyQuestions, selectClassicQuestion } from '../src/game/engine.js'
import { POST } from './answer.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

vi.mock('../src/game/engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/game/engine.js')>()
  return { ...actual, selectClassicQuestion: vi.fn(actual.selectClassicQuestion) }
})

const runId = '123e4567-e89b-12d3-a456-426614174000'
const runToken = 'a'.repeat(43)

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
  updated = [{ run_id: runId }],
  updateError,
}: {
  rows?: unknown[]
  updated?: unknown[]
  updateError?: Error
} = {}) {
  const sql = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
    const query = strings.join(' ').toLowerCase()
    if (query.includes('from runs')) return Promise.resolve(rows)
    if (query.includes('update runs')) {
      return updateError ? Promise.reject(updateError) : Promise.resolve(updated)
    }
    return Promise.resolve([])
  })
  vi.mocked(getSql).mockReturnValue(sql as never)
  return sql
}

const validBody = {
  runId,
  runToken,
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
    const persistedProgress = sql.mock.calls[1]
      .slice(1)
      .find(
        (value): value is string =>
          typeof value === 'string' && value.includes('"results"'),
      )

    expect(response.status).toBe(200)
    expect(body.correct).toBe(true)
    expect(body.points).toBeGreaterThan(0)
    expect(body.answer).toBe(questionBank[0].answer)
    expect(JSON.parse(persistedProgress ?? '{}').results).toEqual(['hit'])
    expect(sql.mock.calls.some(([strings]) => strings.join(' ').includes('insert into answer_log'))).toBe(true)
  })

  it('rejects a missing or malformed run token before querying', async () => {
    const sql = mockSql()
    const missing = await POST(makeRequest({ ...validBody, runToken: undefined }))
    const malformed = await POST(makeRequest({ ...validBody, runToken: 'short' }))

    expect(missing.status).toBe(400)
    expect(malformed.status).toBe(400)
    expect(sql).not.toHaveBeenCalled()
  })

  it('looks the run up by id and token hash so a known id alone is not enough', async () => {
    const sql = mockSql({ rows: [] })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(404)
    const [strings, ...values] = sql.mock.calls[0]
    expect(strings.join('?')).toContain('token_hash = ?')
    expect(values).toContain(hashRunToken(runToken))
    expect(values).not.toContain(runToken)
  })

  it('refuses answers for a question whose clock has not started', async () => {
    const sql = mockSql({ rows: [makeRun(questionBank[0], { server_ms: null })] })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'not_revealed' })
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('times out a long-abandoned run instead of overflowing', async () => {
    const sql = mockSql({
      rows: [makeRun(questionBank[0], { server_ms: '3000000000' })],
    })
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.correct).toBe(false)
    expect(body.progress.strikes).toBe(1)
    expect(sql.mock.calls[0][0].join(' ')).toContain('::bigint')
  })

  it('updates the run and writes the answer log in one statement', async () => {
    const sql = mockSql()
    await POST(makeRequest(validBody))

    expect(sql).toHaveBeenCalledTimes(2)
    const write = sql.mock.calls[1][0].join(' ')
    expect(write).toMatch(/with updated as \(\s*update runs[\s\S]*insert into answer_log[\s\S]*from updated/)
    expect(write).toContain('issued_at = null')
  })

  it('fails the request when the combined write fails', async () => {
    mockSql({ updateError: new Error('log write failed') })
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'server_error' })
  })

  it('returns only the next index, not the next question', async () => {
    mockSql()
    const body = await (await POST(makeRequest(validBody))).json()

    expect(body.next).toEqual({ questionIndex: 1 })
  })

  it('picks the next Classic question by the run\'s correct-answer count', async () => {
    const question = questionBank[0]
    const run = makeRun(question, { question_index: 14 })
    mockSql({
      rows: [
        {
          ...run,
          progress: {
            ...run.progress,
            questionsAnswered: 14,
            results: [...Array(12).fill('hit'), 'miss', 'timeout'],
          },
        },
      ],
    })
    const body = await (
      await POST(makeRequest({ ...validBody, questionIndex: 14, choice: question.answer }))
    ).json()

    expect(vi.mocked(selectClassicQuestion).mock.calls.at(-1)?.[2]).toBe(13)
    expect(body.progress.correct).toBe(13)
  })

  it('omits partial results when a legacy Daily run completes', async () => {
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
    expect(body.summary.reason).toBe('complete')
    expect(body.summary.questionsAnswered).toBe(10)
    expect(body.summary.results).toBeUndefined()
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
        results: Array(9).fill('hit'),
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
    expect(body.summary.results).toHaveLength(10)
  })
})
