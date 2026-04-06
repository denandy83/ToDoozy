import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { isTelegramContext, getTelegramInitData, getTelegramUser } from '../lib/telegram'
import type { Session } from '@supabase/supabase-js'

interface AuthState {
  session: Session | null
  loading: boolean
  error: string | null
}

/**
 * Auth hook supporting two flows:
 * 1. Telegram initData → server validates → returns Supabase session
 * 2. Direct Supabase email/password login (fallback / first-time linking)
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    loading: true,
    error: null
  })

  // Check existing session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ session, loading: false, error: null })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(prev => ({ ...prev, session, loading: false }))
    })

    return () => subscription.unsubscribe()
  }, [])

  // Try Telegram-based auth via backend
  const loginViaTelegram = useCallback(async () => {
    if (!isTelegramContext()) return

    const initData = getTelegramInitData()
    const tgUser = getTelegramUser()
    if (!initData || !tgUser) return

    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const res = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Auth failed' }))
        throw new Error(body.error || 'Telegram auth failed')
      }

      const { access_token, refresh_token } = await res.json()
      const { data, error } = await supabase.auth.setSession({
        access_token,
        refresh_token
      })

      if (error) throw error
      setState({ session: data.session, loading: false, error: null })
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Auth failed'
      }))
    }
  }, [])

  // Email/password login for linking
  const loginWithEmail = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      // If in Telegram context, link the account
      if (isTelegramContext()) {
        const tgUser = getTelegramUser()
        if (tgUser && data.session) {
          await fetch('/api/auth/link-telegram', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.session.access_token}`
            },
            body: JSON.stringify({
              telegram_user_id: tgUser.id,
              initData: getTelegramInitData()
            })
          })
        }
      }

      setState({ session: data.session, loading: false, error: null })
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Login failed'
      }))
    }
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setState({ session: null, loading: false, error: null })
  }, [])

  return {
    ...state,
    loginViaTelegram,
    loginWithEmail,
    logout,
    isAuthenticated: !!state.session
  }
}
