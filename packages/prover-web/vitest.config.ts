import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Real UltraHonk proving in WASM is slow; give the parity suite room.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
