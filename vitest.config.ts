import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      '.claude/**',
      'packages/telegram-bot/test/**',
      'ToDoozy/**',
      '**/node_modules/**',
      '**/dist/**'
    ]
  }
})
