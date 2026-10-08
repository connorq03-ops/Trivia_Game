import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
let server: ViteDevServer | undefined
let baseUrl: string
let envDirectory: string | undefined
let originalDatabaseUrl: string | undefined

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  envDirectory = await mkdtemp(join(tmpdir(), 'streaking-sports-env-'))
  server = await createServer({
    configFile: resolve(repositoryRoot, 'vite.config.ts'),
    envDir: envDirectory,
    server: { port: 0 },
    logLevel: 'silent',
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') {
    throw new Error('Vite dev server did not bind to a TCP port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  try {
    await server?.close()
    if (envDirectory) {
      await rm(envDirectory, { recursive: true, force: true })
    }
  } finally {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  }
})

describe('Vite API dev server', () => {
  it('runs the health handler and returns its JSON response', async () => {
    const response = await fetch(`${baseUrl}/api/health`)

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ ok: false, db: false })
  })

  it('returns JSON 404 for unknown routes', async () => {
    const response = await fetch(`${baseUrl}/api/nope`)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'not_found' })
  })

  it('rejects encoded route traversal', async () => {
    const response = await fetch(`${baseUrl}/api/..%2Fpackage`)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'not_found' })
  })

  it('returns JSON 405 when the route does not export the method', async () => {
    const response = await fetch(`${baseUrl}/api/health`, { method: 'POST' })

    expect(response.status).toBe(405)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'method_not_allowed' })
  })
})
