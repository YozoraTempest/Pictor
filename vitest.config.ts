import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@pictor/shared': fromRoot('./packages/shared/src/index.ts'),
      '@pictor/racp': fromRoot('./packages/racp/src/index.ts'),
      '@pictor/host-client': fromRoot('./packages/host-client/src/index.ts'),
      '@pictor/application': fromRoot('./packages/application/src/index.ts'),
      '@pictor/plugin-sdk': fromRoot('./packages/plugin-sdk/src/index.ts'),
      '@pictor/plugin-host': fromRoot('./packages/plugin-host/src/index.ts'),
      '@pictor/model-config': fromRoot('./packages/model-config/src/index.ts'),
      '@pictor/kernel-sdk': fromRoot('./packages/kernel-sdk/src/index.ts'),
      '@pictor/kernel-sdk/types': fromRoot('./packages/kernel-sdk/src/types.ts'),
      '@pictor/kernel-dsh': fromRoot('./packages/kernel-dsh/src/index.ts'),
      '@pictor/kernel-pi': fromRoot('./packages/kernel-pi/src/index.ts'),
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
