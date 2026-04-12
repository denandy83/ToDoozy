import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { User, CreateUserInput, UpdateUserInput } from '../../../../shared/types'
import { getSupabase, parseAuthTokensFromUrl } from '../../lib/supabase'
import type { Session } from '@supabase/supabase-js'
import { useSyncStore } from './syncStore'

interface AuthState {
  currentUser: User | null
  isAuthenticated: boolean
  loading: boolean
  error: string | null
  isOffline: boolean
}

interface AuthActions {
  setUser(user: User | null): void
  login(user: User): void
  logout(): Promise<void>
  createUser(input: CreateUserInput): Promise<User>
  updateUser(id: string, input: UpdateUserInput): Promise<User | null>
  clearError(): void
  signInWithEmail(email: string, password: string): Promise<void>
  signUpWithEmail(email: string, password: string): Promise<void>
  signInWithGoogle(): Promise<void>
  initAuth(): Promise<void>
  ensureDefaultProject(userId: string): Promise<void>
}

export type AuthStore = AuthState & AuthActions

/** Persist session to safeStorage via IPC */
async function persistSession(session: Session): Promise<void> {
  const sessionJson = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  })
  await window.api.auth.storeSession(sessionJson)
}

/** Ensure user exists in local SQLite, create if needed */
async function ensureLocalUser(
  id: string,
  email: string,
  displayName: string | null,
  avatarUrl: string | null
): Promise<User> {
  const existing = await window.api.users.findById(id)
  if (existing) {
    // Update display name/avatar if changed
    if (existing.display_name !== displayName || existing.avatar_url !== avatarUrl) {
      const updated = await window.api.users.update(id, {
        display_name: displayName,
        avatar_url: avatarUrl
      })
      return updated ?? existing
    }
    return existing
  }
  return await window.api.users.create({
    id,
    email,
    display_name: displayName,
    avatar_url: avatarUrl
  })
}

/**
 * Try to restore a user session from local DB when offline.
 * Decodes the JWT to get the user ID, switches to the per-user DB,
 * then loads the user from local storage.
 */
async function offlineFallback(
  parsed: { access_token: string; refresh_token: string } | null
): Promise<User | null> {
  if (!parsed) return null
  try {
    // Decode the JWT payload to get the user ID (no verification needed — just reading claims)
    const payload = JSON.parse(atob(parsed.access_token.split('.')[1])) as { sub?: string; email?: string }
    const userId = payload.sub
    if (!userId) return null

    // Switch to the per-user DB so we read the right data
    await window.api.auth.switchDatabase(userId, payload.email)

    const user = await window.api.users.findById(userId)
    if (user) {
      console.log('[Auth] Offline fallback: loaded user from local DB')
      useSyncStore.getState().setStatus('offline')
      return user
    }
  } catch (err) {
    console.error('[Auth] Offline fallback failed:', err)
  }
  return null
}

export const useAuthStore = createWithEqualityFn<AuthStore>((set, get) => ({
  currentUser: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  isOffline: false,

  setUser(user: User | null): void {
    set({
      currentUser: user,
      isAuthenticated: user !== null
    })
  },

  login(user: User): void {
    set({
      currentUser: user,
      isAuthenticated: true,
      error: null
    })
  },

  async logout(): Promise<void> {
    try {
      const supabase = await getSupabase()
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Supabase sign out error:', err)
    }
    await window.api.auth.clearSession()
    set({
      currentUser: null,
      isAuthenticated: false,
      error: null,
      isOffline: false
    })
  },

  async createUser(input: CreateUserInput): Promise<User> {
    try {
      const user = await window.api.users.create(input)
      set({ currentUser: user, isAuthenticated: true })
      return user
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create user'
      set({ error: message })
      throw err
    }
  },

  async updateUser(id: string, input: UpdateUserInput): Promise<User | null> {
    try {
      const user = await window.api.users.update(id, input)
      if (user) {
        set({ currentUser: user })
      }
      return user
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user'
      set({ error: message })
      throw err
    }
  },

  clearError(): void {
    set({ error: null })
  },

  async signInWithEmail(email: string, password: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const supabase = await getSupabase()
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        set({ error: error.message, loading: false })
        return
      }
      if (!data.session || !data.user) {
        set({ error: 'Sign in failed: no session returned', loading: false })
        return
      }

      await persistSession(data.session)
      await window.api.auth.switchDatabase(data.user.id, data.user.email ?? undefined)
      const localUser = await ensureLocalUser(
        data.user.id,
        data.user.email ?? email,
        data.user.user_metadata?.full_name ?? null,
        data.user.user_metadata?.avatar_url ?? null
      )
      await get().ensureDefaultProject(localUser.id)
      set({ currentUser: localUser, isAuthenticated: true, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      set({ error: message, loading: false })
    }
  },

  async signUpWithEmail(email: string, password: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const supabase = await getSupabase()
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        set({ error: error.message, loading: false })
        return
      }
      if (!data.user) {
        set({ error: 'Sign up failed', loading: false })
        return
      }

      // If email confirmation is required, session may be null
      if (!data.session) {
        set({
          error: 'Check your email for a confirmation link.',
          loading: false
        })
        return
      }

      await persistSession(data.session)
      await window.api.auth.switchDatabase(data.user.id, data.user.email ?? undefined)
      const localUser = await ensureLocalUser(
        data.user.id,
        data.user.email ?? email,
        data.user.user_metadata?.full_name ?? null,
        data.user.user_metadata?.avatar_url ?? null
      )
      await get().ensureDefaultProject(localUser.id)
      set({ currentUser: localUser, isAuthenticated: true, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      set({ error: message, loading: false })
    }
  },

  async signInWithGoogle(): Promise<void> {
    set({ loading: true, error: null })
    try {
      const supabase = await getSupabase()
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: (await window.api.auth.getSupabaseConfig()).url
        }
      })

      if (error || !data.url) {
        set({ error: error?.message ?? 'Failed to start Google sign in', loading: false })
        return
      }

      // Open OAuth window via main process
      const callbackUrl = await window.api.auth.openOAuthWindow(data.url)
      if (!callbackUrl) {
        set({ error: null, loading: false }) // User closed the window
        return
      }

      // Try to extract tokens from the callback URL (implicit flow)
      const tokens = parseAuthTokensFromUrl(callbackUrl)
      if (tokens) {
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken
        })
        if (sessionError || !sessionData.session || !sessionData.user) {
          set({ error: sessionError?.message ?? 'Failed to establish session', loading: false })
          return
        }
        await persistSession(sessionData.session)
        await window.api.auth.switchDatabase(sessionData.user.id, sessionData.user.email ?? undefined)
        const localUser = await ensureLocalUser(
          sessionData.user.id,
          sessionData.user.email ?? '',
          sessionData.user.user_metadata?.full_name ?? null,
          sessionData.user.user_metadata?.avatar_url ?? null
        )
        await get().ensureDefaultProject(localUser.id)
        set({ currentUser: localUser, isAuthenticated: true, loading: false })
        return
      }

      // Try PKCE flow: extract code from URL
      const urlObj = new URL(callbackUrl)
      const code = urlObj.searchParams.get('code')
      if (code) {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.exchangeCodeForSession(code)
        if (sessionError || !sessionData.session || !sessionData.user) {
          set({ error: sessionError?.message ?? 'Failed to exchange code', loading: false })
          return
        }
        await persistSession(sessionData.session)
        await window.api.auth.switchDatabase(sessionData.user.id, sessionData.user.email ?? undefined)
        const localUser = await ensureLocalUser(
          sessionData.user.id,
          sessionData.user.email ?? '',
          sessionData.user.user_metadata?.full_name ?? null,
          sessionData.user.user_metadata?.avatar_url ?? null
        )
        await get().ensureDefaultProject(localUser.id)
        set({ currentUser: localUser, isAuthenticated: true, loading: false })
        return
      }

      set({ error: 'OAuth callback did not contain valid credentials', loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign in failed'
      set({ error: message, loading: false })
    }
  },

  async initAuth(): Promise<void> {
    set({ loading: true, error: null })
    try {
      // Check for stored session in safeStorage
      const storedSession = await window.api.auth.getSession()
      if (!storedSession) {
        set({ loading: false })
        return
      }

      const parsed = JSON.parse(storedSession) as {
        access_token: string
        refresh_token: string
      }

      const supabase = await getSupabase()
      const { data, error } = await supabase.auth.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token
      })

      if (error || !data.session || !data.user) {
        // Could be network failure or truly expired token — try offline fallback
        console.warn('Session restore failed:', error?.message)
        const offlineUser = await offlineFallback(parsed)
        if (offlineUser) {
          set({ currentUser: offlineUser, isAuthenticated: true, isOffline: true, loading: false })
        } else {
          await window.api.auth.clearSession()
          set({ loading: false, error: 'Session expired — please log in again' })
        }
        return
      }

      // Session restored — update stored tokens (may have been refreshed)
      await persistSession(data.session)
      await window.api.auth.switchDatabase(data.user.id, data.user.email ?? undefined)

      const localUser = await ensureLocalUser(
        data.user.id,
        data.user.email ?? '',
        data.user.user_metadata?.full_name ?? null,
        data.user.user_metadata?.avatar_url ?? null
      )
      await get().ensureDefaultProject(localUser.id)
      set({ currentUser: localUser, isAuthenticated: true, loading: false })
    } catch (err) {
      // Network error during session restore — try offline fallback
      console.warn('Auth init failed (possibly offline):', err)
      const storedSession = await window.api.auth.getSession()
      let parsed: { access_token: string; refresh_token: string } | null = null
      try { parsed = storedSession ? JSON.parse(storedSession) : null } catch { /* ignore */ }
      const offlineUser = await offlineFallback(parsed)
      if (offlineUser) {
        set({ currentUser: offlineUser, isAuthenticated: true, isOffline: true, loading: false })
        return
      }
      set({ loading: false })
    }
  },

  async ensureDefaultProject(userId: string): Promise<void> {
    // Check if user has ANY local projects (not just is_default=1)
    const allProjects = await window.api.projects.getProjectsForUser(userId)
    if (allProjects.length > 0) {
      // User has projects — ensure at least one is marked default
      const defaultProject = allProjects.find((p) => p.is_default === 1)
      if (!defaultProject) {
        await window.api.projects.update(allProjects[0].id, { is_default: 1 })
      }
      // Ensure membership exists on default
      const target = defaultProject ?? allProjects[0]
      const members = await window.api.projects.getMembers(target.id)
      if (!members.some((m) => m.user_id === userId)) {
        await window.api.projects.addMember(target.id, userId, 'owner', userId)
      }
      return
    }

    // No local projects — check Supabase before creating
    try {
      const supabase = await getSupabase()
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', userId)

      if (memberships && memberships.length > 0) {
        // Projects exist in Supabase — pull the first one and mark as default locally
        const { data: project } = await supabase
          .from('projects')
          .select('*')
          .eq('id', memberships[0].project_id)
          .single()

        if (project) {
          await window.api.projects.create({
            id: project.id,
            name: project.name,
            description: project.description,
            color: project.color ?? '#6366f1',
            icon: project.icon ?? 'folder',
            owner_id: project.owner_id,
            is_default: 1
          })
          await window.api.projects.addMember(project.id, userId, 'owner', userId)

          // Pull statuses for this project
          const { data: statuses } = await supabase
            .from('statuses')
            .select('*')
            .eq('project_id', project.id)

          if (statuses) {
            for (const s of statuses) {
              const existingStatus = await window.api.statuses.findById(s.id)
              if (!existingStatus) {
                await window.api.statuses.create({
                  id: s.id, project_id: s.project_id, name: s.name, color: s.color,
                  icon: s.icon, order_index: s.order_index, is_done: s.is_done, is_default: s.is_default
                })
              }
            }
          }
          return
        }
      }
    } catch (err) {
      console.warn('[Auth] Supabase check failed during ensureDefaultProject, creating locally:', err)
    }

    // Double-check: re-read local projects in case sync populated them while we waited
    const recheck = await window.api.projects.getProjectsForUser(userId)
    if (recheck.length > 0) return

    // No project found locally or remotely — create fresh
    const crypto = globalThis.crypto
    const id = crypto.randomUUID()
    await window.api.projects.create({
      id,
      name: 'Personal',
      owner_id: userId,
      color: '#6366f1',
      icon: 'folder',
      is_default: 1
    })
    await window.api.projects.addMember(id, userId, 'owner', userId)

    // Seed default statuses for the new project
    const statusDefaults = [
      { name: 'Not Started', color: '#888888', icon: 'circle', order_index: 0, is_default: 1, is_done: 0 },
      { name: 'In Progress', color: '#f59e0b', icon: 'clock', order_index: 1, is_default: 0, is_done: 0 },
      { name: 'Done', color: '#22c55e', icon: 'check-circle', order_index: 2, is_default: 0, is_done: 1 }
    ]
    for (const status of statusDefaults) {
      await window.api.statuses.create({
        id: crypto.randomUUID(),
        project_id: id,
        ...status
      })
    }
  }
}), shallow)

// Selectors
export const selectCurrentUser = (state: AuthState): User | null => state.currentUser
export const selectIsAuthenticated = (state: AuthState): boolean => state.isAuthenticated
export const selectUserId = (state: AuthState): string | null => state.currentUser?.id ?? null
export const selectIsOffline = (state: AuthState): boolean => state.isOffline
