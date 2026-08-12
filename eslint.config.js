import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['.noctis/**', 'coverage/**', 'dist/**', 'node_modules/**', 'out/**'],
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
              group: ['node:*', '**/main/**', '**/preload/**', '**/runtime/**'],
              message: 'Renderer modules cannot depend on Node or another process implementation.',
            },
          ],
        },
      ],
    },
  },
)
