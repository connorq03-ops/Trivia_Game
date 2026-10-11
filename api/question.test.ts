import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { questionBank } from '../lib/questions.js'
import { hashRunToken } from '../lib/runToken.js'
import { POST } from './question.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

const runId = '123e4567-e89b-12d3-a456-426614174000'
const runToken = 'b'.repeat(43)
const question = questionBank[0]
const validBody = { runId, runToken, questionIndex: 3 }

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/question', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockSql(rows: unknown[]) {
  const sql = vi.fn().mockResolvedValue(rows)
  vi.mocked(getSql).mockReturnValue(sql as never)
  return sql
}

describe('question handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('rejects a body without a valid run token', async () => {
    const sql = mockSql([])
    const response = await POST(makeRequest({ runId, questionIndex: 3 }))

    expect(response.status).toBe(400)
    expect(sql).not.toHaveBeenCalled()
  })

  it('starts the clock only once and only for the owner of the current question', async () => {
    const sql = mockSql([
      {
        current_question_id: question.id,
        current_choices: [question.answer, ...question.wrong],
      },
    ])
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.questionIndex).toBe(3)
    expect(body.question.id).toBe(question.id)
    expect(body.question.choices).toHaveLength(4)
    expect(body.question).not.toHaveProperty('answer')
    expect(body.question).not.toHaveProperty('teach')

    const [strings, ...values] = sql.mock.calls[0]
    const query = strings.join('?')
    expect(query).toContain('issued_at = coalesce(issued_at, now())')
    expect(query).toContain('token_hash = ?')
    expect(query).toContain("status = 'active'")
    expect(values).toContain(hashRunToken(runToken))
    expect(values).toContain(3)
  })

  it('returns 409 when the run, token or index does not match', async () => {
    mockSql([])
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale' })
  })
})
