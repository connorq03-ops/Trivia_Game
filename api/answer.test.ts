import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { bossQuestions, questionBank } from '../lib/questions.js'
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

function storedUpdate(sql: ReturnType<typeof mockSql>) {
  const call = sql.mock.calls.find(([strings]) =>
    (strings as TemplateStringsArray).join(' ').toLowerCase().includes('update runs'),
  )
  const values = (call ?? []).slice(1) as unknown[]
  const progress = values.find(
    (value) => typeof value === 'string' && value.includes('"bossLevelsConsumed"'),
  ) as string
  return { values, progress: JSON.parse(progress) }
}

function runAtCorrect(correct: number, overrides: Record<string, unknown> = {}) {
  const question = questionBank[0]
  const run = makeRun(question, { question_index: correct })
  return {
    ...run,
    progress: {
      ...run.progress,
      questionsAnswered: correct,
      results: Array(correct).fill('hit'),
      ...overrides,
    },
  }
}

describe('answer handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
    const write = sql.mock.calls[1][0].join(' ')
    const values = sql.mock.calls[1].slice(1)
    expect(write).toMatch(/insert into answer_log[\s\S]*choice[\s\S]*result/)
    expect(values).toContain(questionBank[0].answer)
    expect(values).toContain('hit')
  })

  it('logs the wrong choice and miss result', async () => {
    const choice = questionBank[0].wrong[0]
    const sql = mockSql()
    await POST(makeRequest({ ...validBody, choice }))

    const write = sql.mock.calls[1][0].join(' ')
    const values = sql.mock.calls[1].slice(1)
    expect(write).toMatch(/insert into answer_log[\s\S]*choice[\s\S]*result/)
    expect(values).toContain(choice)
    expect(values).toContain('miss')
  })

  it('logs a null choice and timeout result', async () => {
    const sql = mockSql({
      rows: [makeRun(questionBank[0], { server_ms: '3000000000' })],
    })
    await POST(makeRequest({ ...validBody, choice: null }))

    const write = sql.mock.calls[1][0].join(' ')
    const values = sql.mock.calls[1].slice(1)
    expect(write).toMatch(/insert into answer_log[\s\S]*choice[\s\S]*result/)
    expect(values).toContain(null)
    expect(values).toContain('timeout')
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

  it('counts earlier correct answers for legacy Classic runs without results', async () => {
    const question = questionBank[0]
    const run = makeRun(question, { question_index: 36 })
    mockSql({
      rows: [
        {
          ...run,
          progress: {
            ...run.progress,
            questionsAnswered: 36,
            missed: [questionBank[1].id, questionBank[2].id],
          },
        },
      ],
    })
    const body = await (
      await POST(makeRequest({ ...validBody, questionIndex: 36, choice: question.answer }))
    ).json()

    expect(vi.mocked(selectClassicQuestion).mock.calls.at(-1)?.[2]).toBe(35)
    expect(body.progress.correct).toBe(35)
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

  describe('boss questions', () => {
    const boss = bossQuestions[0]
    const bossRun = (progress: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
      const run = makeRun(boss, { question_index: 10, ...overrides })
      return {
        ...run,
        progress: {
          ...run.progress,
          questionsAnswered: 10,
          results: Array(10).fill('hit'),
          streak: 10,
          bestStreak: 10,
          score: 3000,
          bossLevelsConsumed: [1],
          ...progress,
        },
      }
    }

    it('serves a boss after the answer that reaches a new level', async () => {
      vi.stubEnv('BOSS_QUESTIONS', 'true')
      const sql = mockSql({ rows: [runAtCorrect(9)] })
      const body = await (
        await POST(makeRequest({ ...validBody, questionIndex: 9 }))
      ).json()

      expect(body.next).toEqual({ questionIndex: 10 })
      const { values, progress } = storedUpdate(sql)
      expect(progress.bossLevelsConsumed).toEqual([1])
      expect(values.some((value) => bossQuestions.some((question) => question.id === value))).toBe(
        true,
      )
    })

    it('does not serve a boss when the flag is off', async () => {
      const sql = mockSql({ rows: [runAtCorrect(9)] })
      await POST(makeRequest({ ...validBody, questionIndex: 9 }))

      const { values, progress } = storedUpdate(sql)
      expect(progress.bossLevelsConsumed).toEqual([])
      expect(values.some((value) => bossQuestions.some((question) => question.id === value))).toBe(
        false,
      )
    })

    it('does not serve a second boss for a consumed level', async () => {
      vi.stubEnv('BOSS_QUESTIONS', 'true')
      const sql = mockSql({ rows: [runAtCorrect(10, { bossLevelsConsumed: [1] })] })
      await POST(makeRequest({ ...validBody, questionIndex: 10 }))

      const { values, progress } = storedUpdate(sql)
      expect(progress.bossLevelsConsumed).toEqual([1])
      expect(values.some((value) => bossQuestions.some((question) => question.id === value))).toBe(
        false,
      )
    })

    it('scores a boss hit as a flat 500 on the 15-second clock', async () => {
      mockSql({ rows: [bossRun({}, { server_ms: 12_500 })] })
      const body = await (
        await POST(
          makeRequest({ ...validBody, questionIndex: 10, choice: boss.answer, clientMs: 12_000 }),
        )
      ).json()

      expect(body.correct).toBe(true)
      expect(body.points).toBe(500)
      expect(body.progress).toMatchObject({ score: 3500, streak: 11, strikes: 0, correct: 11 })
    })

    it('serves a bonus boss after a perfect fast Daily run', async () => {
      vi.stubEnv('BOSS_QUESTIONS', 'true')
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
          answeredCount: 9,
          totalAnswerMs: 9 * 3_000,
          results: Array(9).fill('hit'),
          streak: 9,
          bestStreak: 9,
          score: 2000,
        },
      })
      const sql = mockSql({ rows: [run] })
      const body = await (
        await POST(
          makeRequest({
            ...validBody,
            questionIndex: 9,
            choice: question.answer,
            clientMs: 2_000,
          }),
        )
      ).json()

      expect(body.next).toEqual({ questionIndex: 10 })
      const { values } = storedUpdate(sql)
      expect(
        values.some((value) =>
          bossQuestions.some((item) => item.id === value),
        ),
      ).toBe(true)
    })

    it('scores a daily bonus miss as zero and completes the run', async () => {
      const run = bossRun(
        {},
        { mode: 'daily', daily_date: '2099-12-31', question_index: 10 },
      )
      const sql = mockSql({ rows: [run] })
      const body = await (
        await POST(
          makeRequest({
            ...validBody,
            questionIndex: 10,
            choice: boss.wrong[0],
          }),
        )
      ).json()

      expect(body.correct).toBe(false)
      expect(body.points).toBe(0)
      expect(body.progress.score).toBe(3000)
      expect(body.summary.reason).toBe('complete')
      expect(sql.mock.calls[1].slice(1)).toContain('miss')
    })

    it('logs a daily bonus timeout as timeout, not the tenth hit', async () => {
      const run = bossRun(
        {},
        { mode: 'daily', daily_date: '2099-12-31', question_index: 10, server_ms: '3000000000' },
      )
      const sql = mockSql({ rows: [run] })
      const body = await (
        await POST(makeRequest({ ...validBody, questionIndex: 10, choice: null }))
      ).json()

      expect(body.correct).toBe(false)
      expect(body.points).toBe(0)
      expect(sql.mock.calls[1].slice(1)).toContain('timeout')
    })

    it('takes 250 for a boss miss without a strike or review entry', async () => {
      const sql = mockSql({ rows: [bossRun({ strikes: 2 })] })
      const body = await (
        await POST(makeRequest({ ...validBody, questionIndex: 10, choice: boss.wrong[0] }))
      ).json()

      expect(body.correct).toBe(false)
      expect(body.points).toBe(-250)
      expect(body.teach).toBe(boss.teach)
      expect(body.progress).toMatchObject({ score: 2750, streak: 10, strikes: 2 })
      expect(body.summary).toBeNull()
      expect(body.next).toEqual({ questionIndex: 11 })
      const { progress } = storedUpdate(sql)
      expect(progress.missed).toEqual([])
      expect(progress.results.at(-1)).toBe('miss')
    })
  })
})
