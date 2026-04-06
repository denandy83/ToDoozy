/**
 * Express server for ToDoozy Telegram TWA
 *
 * Responsibilities:
 * 1. Serve the built Vite SPA
 * 2. Validate Telegram initData and exchange for Supabase session
 * 3. Link Telegram accounts to Supabase users
 */

import express from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = parseInt(process.env.PORT ?? '3100', 10)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''

// Service-role client for admin operations (linking accounts)
const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

app.use(express.json())

// ── Telegram initData Validation ──────────────────────────────────────

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
}

function validateInitData(initData: string): TelegramUser | null {
  if (!TELEGRAM_BOT_TOKEN || !initData) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null

  // Build data-check string (sorted key=value pairs, excluding hash)
  params.delete('hash')
  const entries = Array.from(params.entries())
  entries.sort(([a], [b]) => a.localeCompare(b))
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')

  // HMAC-SHA256 validation
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest()
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (computedHash !== hash) return null

  // Check auth_date is not too old (allow 24 hours)
  const authDate = parseInt(params.get('auth_date') ?? '0', 10)
  const now = Math.floor(Date.now() / 1000)
  if (now - authDate > 86400) return null

  try {
    const userStr = params.get('user')
    if (!userStr) return null
    return JSON.parse(userStr) as TelegramUser
  } catch {
    return null
  }
}

// ── Auth Endpoints ────────────────────────────────────────────────────

/**
 * POST /api/auth/telegram
 * Validates Telegram initData, looks up linked Supabase user,
 * returns session tokens.
 */
app.post('/api/auth/telegram', async (req, res): Promise<void> => {
  const { initData } = req.body ?? {}
  const tgUser = validateInitData(initData)

  if (!tgUser) {
    res.status(401).json({ error: 'Invalid Telegram authentication' })
    return
  }

  if (!supabaseAdmin) {
    res.status(500).json({ error: 'Server not configured for Telegram auth (missing service role key)' })
    return
  }

  try {
    // Look up linked user via user metadata
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers()
    if (error) throw error

    const linkedUser = users.users.find(
      u => u.user_metadata?.telegram_user_id === tgUser.id
    )

    if (!linkedUser) {
      res.status(404).json({
        error: 'No linked ToDoozy account found. Please sign in with email/password first to link your account.'
      })
      return
    }

    // Generate a session for this user
    // Note: This requires Supabase service role key
    // We'll use a custom JWT approach or password-less sign-in
    const { data, error: signInError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: linkedUser.email!
    })

    if (signInError || !data) {
      throw signInError ?? new Error('Failed to generate auth link')
    }

    // Exchange the token
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const token = new URL(data.properties.action_link).searchParams.get('token')
    if (!token) throw new Error('No token in magic link')

    const { data: session, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: token,
      type: 'magiclink'
    })

    if (verifyError || !session.session) {
      throw verifyError ?? new Error('Failed to verify OTP')
    }

    res.json({
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token
    })
  } catch (err) {
    console.error('Telegram auth error:', err)
    res.status(500).json({ error: 'Authentication failed' })
  }
})

/**
 * POST /api/auth/link-telegram
 * Links a Telegram user ID to an existing Supabase account.
 * Requires a valid Supabase Bearer token.
 */
app.post('/api/auth/link-telegram', async (req, res): Promise<void> => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return
  }

  const { telegram_user_id, initData } = req.body ?? {}

  // Validate Telegram initData
  const tgUser = validateInitData(initData)
  if (!tgUser || tgUser.id !== telegram_user_id) {
    res.status(401).json({ error: 'Invalid Telegram data' })
    return
  }

  if (!supabaseAdmin) {
    res.status(500).json({ error: 'Server not configured (missing service role key)' })
    return
  }

  try {
    // Verify the Supabase token
    const token = authHeader.slice(7)
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    // Store the Telegram user ID in user metadata
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        telegram_user_id: tgUser.id,
        telegram_username: tgUser.username,
        telegram_first_name: tgUser.first_name
      }
    })

    res.json({ success: true })
  } catch (err) {
    console.error('Link telegram error:', err)
    res.status(500).json({ error: 'Failed to link account' })
  }
})

// ── Health Check ──────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Serve Static Files ────────────────────────────────────────────────

const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))

// SPA fallback — serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// ── Start ─────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ToDoozy TWA server running on port ${PORT}`)
  console.log(`Telegram auth: ${TELEGRAM_BOT_TOKEN ? 'configured' : 'NOT configured'}`)
  console.log(`Supabase admin: ${supabaseAdmin ? 'configured' : 'NOT configured (email/password login only)'}`)
})
