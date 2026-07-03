import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Local full-game tests replay a whole match to a definite outcome; keep headroom.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
