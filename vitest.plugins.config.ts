import { defineConfig, mergeConfig } from 'vitest/config'

import sharedConfig from './vitest.shared.js'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: [
        'plugins/**/*.test.{ts,tsx}',
        'tests/plugins/**/*.test.{ts,tsx}',
        'scripts/gui-import-boundaries.test.mjs',
        'scripts/plugin-sdk-imports.test.mjs',
        'scripts/style-boundaries.test.mjs',
        'scripts/tui-import-boundaries.test.mjs',
      ],
    },
  }),
)
