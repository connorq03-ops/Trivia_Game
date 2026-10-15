import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiDevServer } from './vite/api-dev-server.js'

// Fingerprint whatever changes the dealt Daily 10: the engine (quotas,
// seeding, side split) and every content file. A redeal gets a new deal id,
// which is what lets stored "already played" summaries expire on deploy.
const dealSeed = createHash('sha256')
for (const file of readdirSync('content').sort()) {
  if (file.endsWith('.json')) dealSeed.update(readFileSync(join('content', file)))
}
dealSeed.update(readFileSync('src/game/engine.ts'))

export default defineConfig({
  plugins: [react(), apiDevServer()],
  define: {
    __DAILY_DEAL__: JSON.stringify(dealSeed.digest('hex')),
  },
  test: {
    include: ['{api,lib,src,tests}/**/*.test.{ts,tsx}'],
  },
})
