import type { VercelRequest, VercelResponse } from '@vercel/node'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from '../lib/db'
import handler from './health'

vi.mock('../lib/db', () => ({
  sql: vi.fn(),
}))

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  }
  response.status.mockReturnValue(response)
  response.json.mockReturnValue(response)
  return response as unknown as VercelResponse
}

describe('health handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns healthy when the database query succeeds', async () => {
    vi.mocked(sql).mockResolvedValueOnce([])
    const response = createResponse()

    await handler({} as VercelRequest, response)

    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith({ ok: true, db: true })
  })

  it('returns an error when the database query fails', async () => {
    vi.mocked(sql).mockRejectedValueOnce(new Error('Database unavailable'))
    const response = createResponse()

    await handler({} as VercelRequest, response)

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({ ok: false, db: false })
  })
})
