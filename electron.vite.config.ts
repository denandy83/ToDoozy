import { resolve } from 'path'
import { config } from 'dotenv'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { requireSupabaseBuildConfig } from './scripts/supabase-build-config'

// Load .env for build-time injection
config()

export default defineConfig(({ command }) => {
  const client = command === 'build' ? requireSupabaseBuildConfig(process.env) : {
    url: process.env.SUPABASE_URL ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? ''
  }
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        'process.env.SUPABASE_URL': JSON.stringify(client.url),
        'process.env.SUPABASE_ANON_KEY': JSON.stringify(client.anonKey)
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/main/index.ts')
          }
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [react(), tailwindcss()],
      server: {
        port: 5200
      }
    }
  }
})
