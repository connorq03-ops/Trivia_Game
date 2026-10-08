import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db'
import { questionBank } from '../src/game/content'
import { POST } from './answers'

vi.mock('../lib/db', () => ({
  getSql: vi.fn(),
}))

const validBody = {
  runId: '123e4567-e89b-12d3-a456-426614174000',
  mode: 'classic',
  questionId: questionBank[0].id,
  questionIndex: 0,
  answerMs: 1234,
  correct: true,
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/answers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('answers handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('inserts valid answers and returns 204', async () => {
    const sql = vi.fn().mockResolvedValueOnce([])
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(204)
    expect(sql).toHaveBeenCalledTimes(1)
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      validBody.runId,
      validBody.mode,
      validBody.questionId,
      validBody.questionIndex,
      validBody.answerMs,
      validBody.correct,
    ])
  })

  it.each([
    ['unparseable JSON', '{'],
    ['invalid run id', { ...validBody, runId: 'not-a-uuid' }],
    ['unsupported mode', { ...validBody, mode: 'practice' }],
    ['unknown question', { ...validBody, questionId: 'unknown-question' }],
    ['negative index', { ...validBody, questionIndex: -1 }],
    ['index above limit', { ...validBody, questionIndex: 501 }],
    ['fractional index', { ...validBody, questionIndex: 1.5 }],
    ['negative answer time', { ...validBody, answerMs: -1 }],
    ['answer time above limit', { ...validBody, answerMs: 10001 }],
    ['fractional answer time', { ...validBody, answerMs: 2.5 }],
    ['invalid correctness value', { ...validBody, correct: 'yes' }],
  ])('rejects %s with a 400 response', async (_name, body) => {
    const response = await POST(makeRequest(body))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_body' })
    expect(getSql).not.toHaveBeenCalled()
  })

  it('accepts a null answer time for a timeout', async () => {
    const sql = vi.fn().mockResolvedValueOnce([])
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await POST(makeRequest({ ...validBody, answerMs: null }))

    expect(response.status).toBe(204)
    expect(sql).toHaveBeenCalledOnce()
  })

  it('does not leak database failures', async () => {
    const sql = vi.fn().mockRejectedValueOnce(new Error('secret database detail'))
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(500)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ error: 'server_error' })
    expect(body).not.toContain('secret database detail')
  })
})
