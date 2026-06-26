import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Local full-game tests replay a whole 24-round match; keep headroom.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
