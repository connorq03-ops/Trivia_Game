import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSql } from '../lib/db.js'
import { GET } from './health.js'

vi.mock('../lib/db.js', () => ({
  getSql: vi.fn(),
}))

describe('health handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns healthy when the database query succeeds', async () => {
    const sql = vi.fn().mockResolvedValueOnce([])
    vi.mocked(getSql).mockReturnValue(sql as never)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, db: true, bosses: false })
  })

  it('reports boss questions when BOSS_QUESTIONS is on', async () => {
    vi.mocked(getSql).mockReturnValue(vi.fn().mockResolvedValueOnce([]) as never)
    vi.stubEnv('BOSS_QUESTIONS', 'true')
    try {
      expect(await (await GET()).json()).toMatchObject({ bosses: true })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('returns an error when the database client cannot be created', async () => {
    vi.mocked(getSql).mockImplementationOnce(() => {
      throw new Error('DATABASE_URL is not set')
    })

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, db: false })
  })
})
