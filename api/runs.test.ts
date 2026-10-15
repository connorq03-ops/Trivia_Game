import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { questionBank } from '../lib/questions.js'
import { hashRunToken } from '../lib/runToken.js'
import { REEL_MS, dailyQuestions, selectClassicQuestion } from '../src/game/engine.js'
import { dailyDateKey } from '../src/game/dailyStore.js'
import { POST } from './runs.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

vi.mock('../src/game/engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/game/engine.js')>()
  return { ...actual, selectClassicQuestion: vi.fn(actual.selectClassicQuestion) }
})

function makeRequest(
  body: unknown,
  headers: Record<string, string> = { 'x-real-ip': '127.0.0.1' },
): Request {
  return new Request('http://localhost/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const runId = '123e4567-e89b-12d3-a456-426614174000'

function mockSql(
  inserted: unknown[] = [{ id: runId }],
  resumed: unknown[] = [],
) {
  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      query: strings.join('?'),
      values,
    })),
    { transaction: vi.fn().mockResolvedValue([[], resumed, inserted]) },
  )
  vi.mocked(getSql).mockReturnValue(sql as never)
  return sql
}

function insertQuery(sql: ReturnType<typeof mockSql>) {
  const [queries] = sql.transaction.mock.calls[0] as [
    { query: string; values: unknown[] }[],
  ]
  return queries
}

describe('runs handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('RUNS_PER_IP_PER_DAY', '100')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a bad body without querying the database', async () => {
    const response = await POST(makeRequest({ mode: 'practice' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_body' })
    expect(getSql).not.toHaveBeenCalled()
  })

  it('returns 429 when the IP has reached its daily run limit', async () => {
    vi.stubEnv('RUNS_PER_IP_PER_DAY', '1')
    const sql = mockSql([])

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'all', side: 'both' }),
    )

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'rate_limited' })
    expect(sql.transaction).toHaveBeenCalledOnce()
  })

  it('reserves quota atomically: per-IP lock, then a count-guarded insert', async () => {
    vi.stubEnv('RUNS_PER_IP_PER_DAY', '7')
    const sql = mockSql()

    await POST(makeRequest({ mode: 'classic', sport: 'all', side: 'both' }))

    const [lock, resume, insert] = insertQuery(sql)
    expect(lock.query).toContain('pg_advisory_xact_lock')
    expect(resume.query).toMatch(/from runs[\s\S]*token_hash/)
    expect(insert.query).toMatch(/insert into runs[\s\S]*select[\s\S]*where \([\s\S]*count\(\*\)[\s\S]*\) </)
    expect(insert.values).toContain(7)
    expect(insert.values).toContain(lock.values[0])
  })

  it('keys quota on x-real-ip and ignores a spoofed x-forwarded-for', async () => {
    const hashFor = async (headers: Record<string, string>) => {
      const sql = mockSql()
      await POST(makeRequest({ mode: 'classic', sport: 'all', side: 'both' }, headers))
      return insertQuery(sql)[0].values[0]
    }

    const real = await hashFor({ 'x-real-ip': '203.0.113.9' })
    const spoofed = await hashFor({
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1',
    })
    const other = await hashFor({ 'x-real-ip': '203.0.113.10' })

    expect(spoofed).toBe(real)
    expect(other).not.toBe(real)
  })

  it('returns a safe public question on successful run creation', async () => {
    const sql = mockSql()

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'all', side: 'both' }),
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.runId).toBe(runId)
    expect(body.runToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.bosses).toBe(false)
    const insert = insertQuery(sql)[2]
    expect(insert.query).toContain('now() + make_interval(secs => ?)')
    expect(insert.values).toContain(REEL_MS / 1000)
    expect(insert.values).toContain(hashRunToken(body.runToken))
    expect(insert.values).not.toContain(body.runToken)
    expect(body.question.choices).toHaveLength(4)
    expect(body.progress).toEqual({
      score: 0,
      strikes: 0,
      streak: 0,
      correct: 0,
      lifelines: { fiftyFifty: 0, shield: false },
    })
    expect(body.total).toBeNull()

    const forbiddenKeys = new Set(['answer', 'teach', 'factId', 'wrong'])
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit)
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          expect(forbiddenKeys.has(key)).toBe(false)
          visit(nested)
        }
      }
    }
    visit(body)
  })

  it('resumes an active run for the stored-token holder instead of a fresh one', async () => {
    const resumeToken = 'a'.repeat(43)
    const liveQuestion = questionBank[0]
    const sql = mockSql([], [
      {
        id: runId,
        question_index: 4,
        current_question_id: liveQuestion.id,
        current_choices: [liveQuestion.answer, 'a', 'b', 'c'],
        progress: {
          score: 1200,
          strikes: 1,
          streak: 0,
          results: ['hit', 'hit', 'hit', 'miss'],
          questionsAnswered: 4,
          missed: ['x'],
        },
        daily_date: null,
      },
    ])

    const response = await POST(
      makeRequest({
        mode: 'classic',
        sport: 'all',
        side: 'both',
        resume: { runId, runToken: resumeToken },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.runId).toBe(runId)
    expect(body.runToken).toBe(resumeToken)
    expect(body.questionIndex).toBe(4)
    expect(body.question.id).toBe(liveQuestion.id)
    expect(body.progress).toEqual({
      score: 1200,
      strikes: 1,
      streak: 0,
      correct: 3,
      lifelines: { fiftyFifty: 0, shield: false },
    })
    // Resume matched on the presented token hash, not just the ip.
    const resume = insertQuery(sql)[1]
    expect(resume.values).toContain(runId)
    expect(resume.values).toContain(hashRunToken(resumeToken))
    // No statement ends other runs by ip: a shared-IP start can't kill
    // someone else's active run.
    const queries = insertQuery(sql).map((q) => q.query)
    expect(queries.some((q) => /update runs/.test(q))).toBe(false)
  })

  it('returns the dealt-set deal and scopes daily resume to it', async () => {
    const sql = mockSql()
    const response = await POST(makeRequest({ mode: 'daily' }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.deal).toMatch(/^[0-9a-f]{64}$/)

    // Resume only matches a run stamped with today's deal, so a redeal
    // abandons an unfinished old set instead of replaying it.
    const insert = insertQuery(sql)[2]
    const dealt = dailyQuestions(dailyDateKey(), questionBank)
    const deal = createHash('sha256')
      .update(JSON.stringify(dealt))
      .digest('hex')
    expect(body.deal).toBe(deal)
    const filter = insert.values.find(
      (value) =>
        value &&
        typeof value === 'object' &&
        'query' in value &&
        /progress->>'deal'/.test((value as { query: string }).query),
    ) as { query: string; values: unknown[] } | undefined
    expect(filter?.values).toContain(deal)
  })

  it('rejects a malformed resume payload', async () => {
    const response = await POST(
      makeRequest({
        mode: 'classic',
        sport: 'all',
        side: 'both',
        resume: { runId: 'not-a-uuid', runToken: 'a'.repeat(43) },
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_body' })
  })

  it('returns no_questions without inserting a run when filters have no bank', async () => {
    const sql = mockSql()
    vi.mocked(selectClassicQuestion).mockReturnValueOnce({
      type: 'end',
      reason: 'bank',
    })

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'baseball', side: 'players' }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no_questions' })
    expect(sql.transaction).not.toHaveBeenCalled()
  })
})
