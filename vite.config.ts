import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { apiDevServer } from './vite/api-dev-server.js'

export default defineConfig({
  plugins: [react(), apiDevServer()],
  test: {
    include: ['{api,lib,src,tests}/**/*.test.{ts,tsx}'],
  },
})
