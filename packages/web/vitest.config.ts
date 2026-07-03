import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Mirror Next.js's `@/` path alias so route handlers are importable in tests.
    alias: { '@': here },
  },
  test: {
    // lib/** logic tests plus route-handler tests (which invoke the App
    // Router handlers directly with Request objects — no server needed).
    include: ['lib/**/*.test.ts'],
  },
})
