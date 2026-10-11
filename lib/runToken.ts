import { createHash, randomBytes } from 'node:crypto'

const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function createRunToken(): string {
  return randomBytes(32).toString('base64url')
}

export function isRunToken(value: unknown): value is string {
  return typeof value === 'string' && RUN_TOKEN_PATTERN.test(value)
}

export function hashRunToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
