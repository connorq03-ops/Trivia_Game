import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { bossQuestions, questionBank } from '../lib/questions.js'
import { hashRunToken } from '../lib/runToken.js'
import { BOSS_CLOCK_MS, BOSS_REEL_MS, REEL_MS } from '../src/game/engine.js'
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
        elapsed_ms: 0,
      },
    ])
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.questionIndex).toBe(3)
    expect(body.elapsedMs).toBe(0)
    expect(body.question.id).toBe(question.id)
    expect(body.question.choices).toHaveLength(4)
    expect(body.question).not.toHaveProperty('answer')
    expect(body.question).not.toHaveProperty('teach')

    const [strings, ...values] = sql.mock.calls[0]
    const query = strings.join('?')
    expect(query).toContain('issued_at = coalesce(')
    expect(query).toContain("when current_question_id like 'boss-%'")
    expect(values).toContain(REEL_MS / 1000)
    expect(values).toContain(BOSS_REEL_MS / 1000)
    expect(body.question).not.toHaveProperty('boss')
    expect(query).toContain('::bigint as elapsed_ms')
    expect(query).toContain('token_hash = ?')
    expect(query).toContain("status = 'active'")
    expect(values).toContain(hashRunToken(runToken))
    expect(values).toContain(3)
  })

  it("reports how long an earlier reveal's clock has run", async () => {
    mockSql([
      {
        current_question_id: question.id,
        current_choices: [question.answer, ...question.wrong],
        elapsed_ms: '15000',
      },
    ])
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.elapsedMs).toBe(15000)
  })

  it('returns 409 when the run, token or index does not match', async () => {
    mockSql([])
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale' })
  })

  it('sends the boss category and longer clock for a boss question', async () => {
    const boss = bossQuestions[0]
    mockSql([
      {
        current_question_id: boss.id,
        current_choices: [boss.answer, ...boss.wrong],
        elapsed_ms: 0,
      },
    ])
    const body = await (await POST(makeRequest(validBody))).json()

    expect(body.question.side).toBe('boss')
    expect(body.question.boss).toEqual({
      category: boss.category,
      clockMs: BOSS_CLOCK_MS,
      reelMs: BOSS_REEL_MS,
    })
    expect(body.question).not.toHaveProperty('answer')
  })
})
