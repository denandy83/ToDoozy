import { create } from 'zustand'
import type { User, CreateUserInput, UpdateUserInput } from '../../../../shared/types'

interface AuthState {
  currentUser: User | null
  isAuthenticated: boolean
  loading: boolean
  error: string | null
}

interface AuthActions {
  setUser(user: User | null): void
  login(user: User): void
  logout(): void
  createUser(input: CreateUserInput): Promise<User>
  updateUser(id: string, input: UpdateUserInput): Promise<User | null>
  checkAuth(userId: string): Promise<boolean>
  clearError(): void
}

export type AuthStore = AuthState & AuthActions

export const useAuthStore = create<AuthStore>((set) => ({
  currentUser: null,
  isAuthenticated: false,
  loading: false,
  error: null,

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

  logout(): void {
    set({
      currentUser: null,
      isAuthenticated: false,
      error: null
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

  async checkAuth(userId: string): Promise<boolean> {
    set({ loading: true, error: null })
    try {
      const user = await window.api.users.findById(userId)
      if (user) {
        set({ currentUser: user, isAuthenticated: true, loading: false })
        return true
      }
      set({ currentUser: null, isAuthenticated: false, loading: false })
      return false
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check auth'
      set({ error: message, loading: false })
      return false
    }
  },

  clearError(): void {
    set({ error: null })
  }
}))

// Selectors
export const selectCurrentUser = (state: AuthState): User | null => state.currentUser

export const selectIsAuthenticated = (state: AuthState): boolean => state.isAuthenticated

export const selectUserId = (state: AuthState): string | null => state.currentUser?.id ?? null
