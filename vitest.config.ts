import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    pool: 'forks',
  },
})
