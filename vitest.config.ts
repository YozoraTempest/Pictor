import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    // `.tsx` before `.ts`: the UI kit is JSX and sits beside `.ts` modules.
    extensions: ['.tsx', '.ts', '.js'],
    alias: [
      { find: '@vulonlok/shared', replacement: fromRoot('./packages/shared/src/index.ts') },
      {
        find: '@vulonlok/harness/main',
        replacement: fromRoot('./packages/harness/src/main/index.ts'),
      },
      { find: '@vulonlok/racp', replacement: fromRoot('./packages/racp/src/index.ts') },
      {
        find: '@vulonlok/host-client',
        replacement: fromRoot('./packages/host-client/src/index.ts'),
      },
      {
        find: '@vulonlok/application',
        replacement: fromRoot('./packages/application/src/index.ts'),
      },
      { find: '@vulonlok/plugin-sdk', replacement: fromRoot('./packages/plugin-sdk/src/index.ts') },
      {
        find: '@vulonlok/plugin-host',
        replacement: fromRoot('./packages/plugin-host/src/index.ts'),
      },
      {
        find: '@vulonlok/model-config',
        replacement: fromRoot('./packages/model-config/src/index.ts'),
      },
      { find: '@vulonlok/kernel-sdk', replacement: fromRoot('./packages/kernel-sdk/src/index.ts') },
      {
        find: '@vulonlok/kernel-sdk/types',
        replacement: fromRoot('./packages/kernel-sdk/src/types.ts'),
      },
      { find: '@vulonlok/kernel-dsh', replacement: fromRoot('./packages/kernel-dsh/src/index.ts') },
      // Subpaths resolve to source with a prefix rule, not one entry per file: a string
      // key in the object form would append the subpath to a file's own path.
      { find: '@vulonlok/ui/Banner', replacement: fromRoot('./packages/ui/src/Banner.tsx') },
      { find: '@vulonlok/ui/Button', replacement: fromRoot('./packages/ui/src/Button.tsx') },
      { find: '@vulonlok/ui/Dialog', replacement: fromRoot('./packages/ui/src/Dialog.tsx') },
      { find: '@vulonlok/ui/Feedback', replacement: fromRoot('./packages/ui/src/Feedback.tsx') },
      { find: '@vulonlok/ui/Field', replacement: fromRoot('./packages/ui/src/Field.tsx') },
      { find: '@vulonlok/ui/Input', replacement: fromRoot('./packages/ui/src/Input.tsx') },
      { find: '@vulonlok/ui/Menu', replacement: fromRoot('./packages/ui/src/Menu.tsx') },
      { find: '@vulonlok/ui/Panel', replacement: fromRoot('./packages/ui/src/Panel.tsx') },
      { find: '@vulonlok/ui/Select', replacement: fromRoot('./packages/ui/src/Select.tsx') },
      { find: '@vulonlok/ui/Switch', replacement: fromRoot('./packages/ui/src/Switch.tsx') },
      { find: '@vulonlok/ui/Tooltip', replacement: fromRoot('./packages/ui/src/Tooltip.tsx') },
      { find: '@vulonlok/ui/cn', replacement: fromRoot('./packages/ui/src/cn.ts') },
      { find: '@vulonlok/ui/index', replacement: fromRoot('./packages/ui/src/index.ts') },
      { find: '@vulonlok/ui', replacement: fromRoot('./packages/ui/src/index.ts') },
      {
        find: /^@vulonlok\/harness\/renderer\//,
        replacement: fromRoot('./packages/harness/src/renderer/'),
      },
    ],
  },
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/desktop/src/**/*.test.{ts,tsx}',
      'plugins/*/src/**/*.test.ts',
    ],
    environment: 'node',
    restoreMocks: true,
  },
})
