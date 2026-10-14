import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { POST } from './mystery.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

const runId = '123e4567-e89b-12d3-a456-426614174000'
const runToken = 'a'.repeat(43)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/mystery', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const baseProgress = {
  score: 3500,
  strikes: 1,
  streak: 11,
  bestStreak: 11,
  questionsAnswered: 11,
  answeredCount: 11,
  totalAnswerMs: 20_000,
  missed: [],
  results: [...Array(10).fill('hit'), 'boss-hit'],
  bossLevelsConsumed: [10],
  bossMisses: 0,
  bossMissed: [],
  lifelines: { fiftyFifty: 0, shield: false },
  pendingMystery: [
    { kind: 'points', points: 100 },
    { kind: 'shield' },
  ],
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'classic',
    status: 'active',
    progress: { ...baseProgress },
    ...overrides,
  }
}

const appliedProgress = {
  ...baseProgress,
  score: 3600,
  lifelines: { fiftyFifty: 0, shield: true },
}

function mockSql({
  rows = [makeRun()],
  updated = [{ progress: appliedProgress }],
} = {}) {
  const sql = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
    const query = strings.join(' ').toLowerCase()
    if (query.includes('returning progress')) return Promise.resolve(updated)
    if (query.includes('update runs')) return Promise.resolve([])
    if (query.includes('from runs')) return Promise.resolve(rows)
    return Promise.resolve([])
  })
  vi.mocked(getSql).mockReturnValue(sql as never)
  return sql
}

const validBody = { runId, runToken, pick: 1 }

describe('mystery pick handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('rejects a malformed body before querying', async () => {
    const sql = mockSql()
    for (const body of [
      { ...validBody, pick: 2 },
      { ...validBody, pick: 'a' },
      { ...validBody, runToken: 'short' },
    ]) {
      const response = await POST(makeRequest(body))
      expect(response.status).toBe(400)
    }
    expect(sql).not.toHaveBeenCalled()
  })

  it('409s when the run has no pending mystery to pick', async () => {
    for (const rows of [
      [],
      [makeRun({ progress: { ...baseProgress, pendingMystery: undefined } })],
    ]) {
      mockSql({ rows })
      const response = await POST(makeRequest(validBody))
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'no_mystery' })
    }
  })

  it('scopes the lookup to Classic runs and guards the update on a pending box', async () => {
    const sql = mockSql()
    await POST(makeRequest(validBody))
    const [selectQuery] = sql.mock.calls[0]
    const selectText = (selectQuery as TemplateStringsArray).join(' ')
    expect(selectText).toContain(`mode = 'classic'`)
    const [updateQuery] = sql.mock.calls[1]
    const updateText = (updateQuery as TemplateStringsArray).join(' ')
    expect(updateText).toContain(`'pendingMystery'`)
  })

  it('still allows the pick on a just-ended run holding a pending box', async () => {
    mockSql({ rows: [makeRun({ status: 'ended' })] })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(200)
  })

  it('applies the picked prize and reveals both prizes', async () => {
    const sql = mockSql()
    const response = await POST(makeRequest(validBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.picked).toBe(1)
    expect(body.applied.kind).toBe('shield')
    expect(body.prizes).toHaveLength(2)
    expect(body.progress.lifelines.shield).toBe(true)
    // The prize is applied in the UPDATE expression itself so it can't
    // clobber a racing answer/lifeline write with a stale snapshot.
    const [updateQuery] = sql.mock.calls[1]
    const updateText = (updateQuery as TemplateStringsArray).join(' ')
    expect(updateText).toContain(`progress - 'pendingMystery'`)
    expect(updateText).toContain(`coalesce(progress -> 'lifelines'`)
  })

  it('cannot be replayed — the second pick finds no pending box', async () => {
    const sql = mockSql({ updated: [] })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(409)
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('syncs the stored summary score after a points prize on an ended run', async () => {
    const sql = mockSql()
    await POST(makeRequest({ ...validBody, pick: 0 }))
    const summaryCall = sql.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray)
        .join(' ')
        .toLowerCase()
        .includes('last_response'),
    )
    expect(summaryCall).toBeTruthy()
  })

  it('adds points to the score for a points prize', async () => {
    mockSql()
    const body = await (
      await POST(makeRequest({ ...validBody, pick: 0 }))
    ).json()

    expect(body.applied).toMatchObject({ kind: 'points', points: 100 })
    expect(body.progress.score).toBe(3600)
  })
})
