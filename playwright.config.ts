import { defineConfig } from '@playwright/test'

process.env.PICTOR_E2E_HEADLESS ??= process.platform === 'win32' ? '1' : '0'
process.env.PICTOR_E2E_NO_FOCUS ??= process.platform !== 'win32' && !process.env.CI ? '1' : '0'

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
