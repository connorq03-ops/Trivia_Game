import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'

function sendJson(response: ServerResponse, status: number, body: object) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
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
) {
  const requestUrl = request.url ?? ''
  const pathname = requestUrl.split('?', 1)[0]
  const name = pathname.slice('/api/'.length)

  if (!/^[a-z0-9-]+$/.test(name)) {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  const file = join(server.config.root, 'api', `${name}.ts`)
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
    init.body = await readBody(request)
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

export function apiDevServer(): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server) {
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

        void handleApiRequest(server, request, response).catch((error: unknown) => {
          server.config.logger.error(
            error instanceof Error ? (error.stack ?? error.message) : String(error),
          )
          if (response.headersSent) {
            response.destroy()
            return
          }
          sendJson(response, 500, { error: 'internal' })
        })
      })
    },
  }
}
