import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['.noctis/**', '.pictor/**', 'coverage/**', 'dist/**', 'node_modules/**', 'out/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: false, prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Application Host must stay independent from Electron.',
            },
            {
              name: 'react',
              message: 'Application Host must stay independent from React.',
            },
            {
              name: 'react-dom',
              message: 'Application Host must stay independent from React.',
            },
            {
              name: 'react/jsx-runtime',
              message: 'Application Host must stay independent from React.',
            },
            {
              name: 'react/jsx-dev-runtime',
              message: 'Application Host must stay independent from React.',
            },
          ],
          patterns: [
            {
              group: [
                '**/renderer',
                '**/renderer/**',
                '**/renderer.*',
                '**/preload',
                '**/preload/**',
                '**/preload.*',
                '**/tui',
                '**/tui/**',
                '**/tui.*',
              ],
              message:
                'Application Host must depend on headless ports instead of Frontend implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/commands/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Command Engine must stay independent from Electron.',
            },
            {
              name: 'react',
              message: 'Command Engine must stay independent from React.',
            },
            {
              name: 'react-dom',
              message: 'Command Engine must stay independent from React.',
            },
          ],
          patterns: [
            {
              group: [
                '**/main/**',
                '**/preload/**',
                '**/renderer/**',
                '**/runtime/**',
                '**/tui/**',
              ],
              message: 'Command Engine must depend on headless ports, not process implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/agent-workspace/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Agent Workspace core must stay independent from Electron.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/**', '**/preload/**', '**/renderer/**', '**/runtime/**'],
              message: 'Shared modules cannot depend on process-specific implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/runtime/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/**', '**/preload/**', '**/renderer/**'],
              message: 'Runtime modules communicate through shared/runtime-protocol.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/**', '**/renderer/**', '**/runtime/**'],
              message: 'Preload is an adapter for the shared desktop bridge interface.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Renderer capabilities must be exposed through the preload bridge.',
            },
          ],
          patterns: [
            {
              group: [
                'node:*',
                '**/main/**',
                '**/preload/**',
                '**/runtime/**',
                '**/shared/runtime-protocol*',
                '**/commands/engine',
                '**/commands/core',
                '**/commands/registry',
                '**/commands/contract',
              ],
              message:
                'Renderer modules must use the desktop bridge instead of Node or another process boundary.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/gui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'GUI Host capabilities must come from the desktop bridge.',
            },
          ],
          patterns: [
            {
              group: [
                'node:*',
                '**/main/**',
                '**/preload/**',
                '**/renderer/settings/**',
                '**/plugin/registry*',
                '**/plugin-manager*',
                '**/plugin-store*',
              ],
              message:
                'GUI Host must use CommandClient and public GUI contracts instead of process or Plugin Manager implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['plugins/workbench-delegate/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Delegate Workbench must use the public GUI bridge.',
            },
          ],
          patterns: [
            {
              group: [
                'node:*',
                '**/src/main/**',
                '**/src/preload/**',
                '**/src/renderer',
                '**/src/renderer/**',
                '**/src/runtime/**',
              ],
              message:
                'Delegate Workbench must use public GUI and Headless contracts instead of process implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['plugins/*/host.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Plugin Host entries must stay independent from Electron.',
            },
            {
              name: 'react',
              message: 'Plugin Host entries must stay independent from React.',
            },
            {
              name: 'react-dom',
              message: 'Plugin Host entries must stay independent from React.',
            },
          ],
          patterns: [
            {
              group: ['**/src/renderer/**', '**/src/preload/**'],
              message: 'Plugin Host entries cannot depend on GUI process implementations.',
            },
          ],
        },
      ],
    },
  },
)
