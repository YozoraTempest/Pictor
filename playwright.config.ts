import { defineConfig } from '@playwright/test'

process.env.PICTOR_E2E_NO_FOCUS ??= process.env.CI ? '0' : '1'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure',
  },
})
