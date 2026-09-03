import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/plugin-sdk/**/*.test.ts'],
  },
})
