import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure-logic unit tests only (lib/**), not the Next.js app itself —
    // route handlers are exercised via the real testnet acceptance run.
    include: ['lib/**/*.test.ts'],
  },
})
