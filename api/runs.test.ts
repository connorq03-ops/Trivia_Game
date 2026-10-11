import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { POST } from './runs.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
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
    const sql = vi.fn().mockResolvedValueOnce([{ count: 1 }])
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'all', side: 'both' }),
    )

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'rate_limited' })
    expect(sql).toHaveBeenCalledOnce()
  })

  it('returns a safe public question on successful run creation', async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ id: '123e4567-e89b-12d3-a456-426614174000' }])
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'all', side: 'both' }),
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.runId).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(body.question.choices).toHaveLength(4)
    expect(body.progress).toEqual({ score: 0, strikes: 0, streak: 0 })
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
    const sql = vi.fn().mockResolvedValueOnce([{ count: 0 }])
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await POST(
      makeRequest({ mode: 'classic', sport: 'baseball', side: 'players' }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no_questions' })
    expect(sql).toHaveBeenCalledOnce()
  })
})
