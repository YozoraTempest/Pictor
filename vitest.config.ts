import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@vulonlok/shared': fromRoot('./packages/shared/src/index.ts'),
      '@vulonlok/racp': fromRoot('./packages/racp/src/index.ts'),
      '@vulonlok/host-client': fromRoot('./packages/host-client/src/index.ts'),
      '@vulonlok/application': fromRoot('./packages/application/src/index.ts'),
      '@vulonlok/plugin-sdk': fromRoot('./packages/plugin-sdk/src/index.ts'),
      '@vulonlok/plugin-host': fromRoot('./packages/plugin-host/src/index.ts'),
      '@vulonlok/model-config': fromRoot('./packages/model-config/src/index.ts'),
      '@vulonlok/kernel-sdk': fromRoot('./packages/kernel-sdk/src/index.ts'),
      '@vulonlok/kernel-sdk/types': fromRoot('./packages/kernel-sdk/src/types.ts'),
      '@vulonlok/kernel-dsh': fromRoot('./packages/kernel-dsh/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.{ts,tsx}',
      'plugins/*/src/**/*.test.ts',
    ],
    environment: 'node',
    restoreMocks: true,
  },
})
