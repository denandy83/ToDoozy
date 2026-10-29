import tseslint from '@electron-toolkit/eslint-config-ts'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['out/**', 'dist/**', 'packages/telegram-bot/dist/**', 'node_modules/**', '.claude/**', 'ToDoozy/**'] },
  ...tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] }
  },
  // JavaScript helpers cannot carry TypeScript return annotations.
  {
    files: ['**/*.mjs'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/exhaustive-deps': 'warn' }
  },
  // Deno's Supabase query builders infer their result types; keep runtime lint
  // checks without requiring redundant return annotations on every method.
  {
    files: ['supabase/**/*.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  }
]
