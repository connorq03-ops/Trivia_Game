import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { hashRunToken } from '../lib/runToken.js'
import { REEL_MS } from '../src/game/engine.js'
import { POST } from './runs.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

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

function mockSql(inserted: unknown[] = [{ id: runId }]) {
  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      query: strings.join('?'),
      values,
    })),
    { transaction: vi.fn().mockResolvedValue([[], inserted]) },
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

    const [lock, insert] = insertQuery(sql)
    expect(lock.query).toContain('pg_advisory_xact_lock')
    expect(insert.query).toMatch(/insert into runs[\s\S]*select[\s\S]*where \([\s\S]*count\(\*\)[\s\S]*\) </)
    expect(insert.values).toContain(7)
    expect(lock.values[0]).toBe(insert.values.at(-2))
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
    const insert = insertQuery(sql)[1]
    expect(insert.query).toContain('now() + make_interval(secs => ?)')
    expect(insert.values).toContain(REEL_MS / 1000)
    expect(insert.values).toContain(hashRunToken(body.runToken))
    expect(insert.values).not.toContain(body.runToken)
    expect(body.question.choices).toHaveLength(4)
    expect(body.progress).toEqual({ score: 0, strikes: 0, streak: 0, correct: 0 })
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

  it('returns no_questions without inserting a run when filters have no bank', async () => {
    const sql = mockSql()

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'baseball', side: 'players' }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no_questions' })
    expect(sql.transaction).not.toHaveBeenCalled()
  })
})
