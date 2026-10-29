import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      '**/.git/**',
      '.claude/**',
      'packages/telegram-bot/test/**',
      'ToDoozy/**',
      '**/node_modules/**',
      '**/dist/**'
    ]
  }
})
