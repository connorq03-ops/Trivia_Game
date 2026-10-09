import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { apiDevServer } from '../vite/api-dev-server.js'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
let server: ViteDevServer | undefined
let baseUrl: string
let envDirectory: string | undefined
let originalDatabaseUrl: string | undefined

function postWithNodeHttp(
  url: string,
  headers: Record<string, string>,
  chunks: string[],
) {
  const parsedUrl = new URL(url)
  return new Promise<{
    statusCode: number
    contentType: string | string[] | undefined
    body: string
  }>((resolve, reject) => {
    const responseChunks: Buffer[] = []
    const request = httpRequest(
      {
        hostname: parsedUrl.hostname,
        port: Number(parsedUrl.port),
        path: parsedUrl.pathname,
        method: 'POST',
        headers,
      },
      (response) => {
        response.on('data', (chunk: Buffer | string) => {
          responseChunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
          )
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            contentType: response.headers['content-type'],
            body: Buffer.concat(responseChunks).toString('utf8'),
          })
        })
      },
    )
    request.on('error', reject)
    for (const chunk of chunks) request.write(chunk)
    request.end()
  })
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  envDirectory = await mkdtemp(join(tmpdir(), 'streaking-sports-env-'))
  server = await createServer({
    configFile: resolve(repositoryRoot, 'vite.config.ts'),
    envDir: envDirectory,
    server: { host: '127.0.0.1', port: 0 },
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

describe('Vite API dev server request body limits', () => {
  let server: ViteDevServer | undefined
  let root: string | undefined
  let baseUrl: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'streaking-sports-api-'))
    const apiDir = join(root, 'api')
    await mkdir(apiDir, { recursive: true })
    await writeFile(
      join(apiDir, 'echo.ts'),
      'export async function POST(req: Request) { return Response.json({ bytes: (await req.arrayBuffer()).byteLength }) }\n',
    )
    server = await createServer({
      configFile: false,
      root,
      plugins: [apiDevServer({ apiDir, maxBodyBytes: 1024 })],
      server: { host: '127.0.0.1', port: 0 },
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
    await server?.close()
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('passes a small request body to the handler', async () => {
    const response = await fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      body: '0123456789',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ bytes: 10 })
  })

  it('rejects a request that exceeds the limit from Content-Length', async () => {
    const response = await postWithNodeHttp(
      `${baseUrl}/api/echo`,
      { 'content-length': '2048' },
      ['x'.repeat(2048)],
    )

    expect(response.statusCode).toBe(413)
    expect(response.contentType).toContain('application/json')
    expect(JSON.parse(response.body)).toEqual({ error: 'payload_too_large' })
  })

  it('rejects an oversized chunked request body', async () => {
    const response = await postWithNodeHttp(
      `${baseUrl}/api/echo`,
      { 'transfer-encoding': 'chunked' },
      ['x'.repeat(700), 'y'.repeat(700), 'z'.repeat(648)],
    )

    expect(response.statusCode).toBe(413)
    expect(response.contentType).toContain('application/json')
    expect(JSON.parse(response.body)).toEqual({ error: 'payload_too_large' })
  })
})
