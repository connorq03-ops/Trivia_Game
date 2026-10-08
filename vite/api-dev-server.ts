import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'

// Vercel's function request-body limit.
const MAX_BODY_BYTES = 4.5 * 1024 * 1024

function sendJson(response: ServerResponse, status: number, body: object) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

function readBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Buffer | null> {
  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    request.resume()
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let tooLarge = false

    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
    }
    const onData = (chunk: Buffer | string) => {
      if (tooLarge) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBodyBytes) {
        tooLarge = true
        chunks.length = 0
        resolve(null)
        request.resume()
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      cleanup()
      if (!tooLarge) resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error) => {
      cleanup()
      if (!tooLarge) reject(error)
    }
    const onAborted = () => {
      cleanup()
      if (!tooLarge) reject(new Error('Request body was aborted'))
    }

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
  })
}

function getRequestHeaders(request: IncomingMessage) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

async function handleApiRequest(
  server: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
  apiDir: string,
  maxBodyBytes: number,
) {
  const requestUrl = request.url ?? ''
  const pathname = requestUrl.split('?', 1)[0]
  const name = pathname.slice('/api/'.length)

  if (!/^[a-z0-9-]+$/.test(name)) {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  const file = join(apiDir, `${name}.ts`)
  try {
    await access(file)
  } catch {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  const method = request.method ?? 'GET'
  const module = await server.ssrLoadModule(file)
  const handler = module[method]
  if (typeof handler !== 'function') {
    request.resume()
    sendJson(response, 405, { error: 'method_not_allowed' })
    return
  }

  const url = new URL(requestUrl, `http://${request.headers.host ?? 'localhost'}`)
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: getRequestHeaders(request),
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const body = await readBody(request, maxBodyBytes)
    if (body === null) {
      sendJson(response, 413, { error: 'payload_too_large' })
      return
    }
    init.body = new Uint8Array(body)
    init.duplex = 'half'
  }

  const webResponse: Response = await handler(new Request(url, init))
  response.statusCode = webResponse.status
  if (webResponse.statusText) response.statusMessage = webResponse.statusText
  webResponse.headers.forEach((value, name) => {
    response.setHeader(name, value)
  })
  response.end(Buffer.from(await webResponse.arrayBuffer()))
}

export function apiDevServer(
  options: { apiDir?: string; maxBodyBytes?: number } = {},
): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      const apiDir = options.apiDir ?? join(server.config.root, 'api')
      const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES
      const env = loadEnv(
        server.config.mode,
        server.config.envDir ?? server.config.root,
        '',
      )
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value
      }

      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/')) return next()

        void handleApiRequest(server, request, response, apiDir, maxBodyBytes).catch(
          (error: unknown) => {
            server.config.logger.error(
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            )
            if (response.headersSent) {
              response.destroy()
              return
            }
            sendJson(response, 500, { error: 'internal' })
          },
        )
      })
    },
  }
}
