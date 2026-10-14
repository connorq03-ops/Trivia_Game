import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { questionBank } from '../lib/questions.js'
import { POST } from './lifeline.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

const runId = '123e4567-e89b-12d3-a456-426614174000'
const runToken = 'a'.repeat(43)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/lifeline', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const question = questionBank[0]

function makeRun(progress: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return {
    mode: 'classic',
    progress: {
      score: 1000,
      strikes: 0,
      streak: 3,
      lifelines: { fiftyFifty: 1, shield: false },
      ...progress,
    },
    current_question_id: question.id,
    current_choices: [question.answer, ...question.wrong],
    revealed: true,
    ...overrides,
  }
}

const appliedLifelines = {
  fiftyFifty: 0,
  shield: false,
  fiftyFiftyUsedOn: 0,
}

function mockSql({
  rows = [makeRun()],
  updated = [{ progress: { lifelines: appliedLifelines } }],
} = {}) {
  const sql = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
    const query = strings.join(' ').toLowerCase()
    if (query.includes('update runs')) return Promise.resolve(updated)
    if (query.includes('from runs')) return Promise.resolve(rows)
    return Promise.resolve([])
  })
  vi.mocked(getSql).mockReturnValue(sql as never)
  return sql
}

const validBody = { runId, runToken, questionIndex: 0, kind: 'fiftyFifty' }

describe('lifeline handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('rejects a malformed body before querying', async () => {
    const sql = mockSql()
    for (const body of [
      { ...validBody, kind: 'double' },
      { ...validBody, runToken: 'short' },
      { ...validBody, questionIndex: -1 },
    ]) {
      const response = await POST(makeRequest(body))
      expect(response.status).toBe(400)
    }
    expect(sql).not.toHaveBeenCalled()
  })

  it('404s when no active classic run matches the token and index', async () => {
    mockSql({ rows: [] })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(404)
  })

  it('409s before the question is revealed — no untimed 50/50', async () => {
    const sql = mockSql({ rows: [makeRun({}, { revealed: false })] })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'not_revealed' })
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('409s when there are no stored charges', async () => {
    mockSql({ rows: [makeRun({ lifelines: { fiftyFifty: 0, shield: false } })] })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no_charges' })
  })

  it('narrows the choices to the answer plus one wrong option', async () => {
    const sql = mockSql()
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.question.choices).toHaveLength(2)
    expect(body.question.choices).toContain(question.answer)
    expect(
      body.question.choices.filter((choice: string) =>
        question.wrong.includes(choice),
      ),
    ).toHaveLength(1)
    expect(body.lifelines.fiftyFifty).toBe(0)
    expect(body.lifelines.fiftyFiftyUsedOn).toBe(0)
    expect(sql).toHaveBeenCalledTimes(2)
    // The charge is decremented in the UPDATE expression, not from a snapshot.
    const [updateQuery] = sql.mock.calls[1]
    expect((updateQuery as TemplateStringsArray).join(' ')).toContain(
      'lifelines,fiftyFifty',
    )
  })

  it('is idempotent on the same question: no second charge burned', async () => {
    const narrowed = [question.answer, question.wrong[0]]
    const sql = mockSql({
      rows: [
        makeRun(
          { lifelines: { fiftyFifty: 0, shield: false, fiftyFiftyUsedOn: 0 } },
          { current_choices: narrowed },
        ),
      ],
    })
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.question.choices).toEqual(narrowed)
    expect(body.lifelines.fiftyFifty).toBe(0)
    // Only the select ran — no update call.
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('409s if the guarded update loses the race', async () => {
    mockSql({ updated: [] })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale' })
  })
})
