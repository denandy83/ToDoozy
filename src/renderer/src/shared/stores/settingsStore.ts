import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type {
  Setting,
  Theme,
  ThemeConfig,
  CreateThemeInput,
  UpdateThemeInput
} from '../../../../shared/types'

interface SettingsState {
  userId: string
  settings: Record<string, string | null>
  themes: Record<string, Theme>
  currentThemeId: string | null
  loading: boolean
  error: string | null
}

interface SettingsActions {
  setUserId(userId: string): void
  hydrateSettings(): Promise<void>
  getSetting(key: string): string | null
  setSetting(key: string, value: string | null): Promise<void>
  setMultipleSettings(settings: Setting[]): Promise<void>
  deleteSetting(key: string): Promise<boolean>
  hydrateThemes(): Promise<void>
  createTheme(input: CreateThemeInput): Promise<Theme>
  updateTheme(id: string, input: UpdateThemeInput): Promise<Theme | null>
  deleteTheme(id: string): Promise<boolean>
  setCurrentTheme(id: string): void
  getThemeConfig(id: string): Promise<ThemeConfig | null>
  clearError(): void
}

export type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = createWithEqualityFn<SettingsStore>((set, get) => ({
  userId: '',
  settings: {},
  themes: {},
  currentThemeId: null,
  loading: false,
  error: null,

  setUserId(userId: string): void {
    set({ userId })
  },

  async hydrateSettings(): Promise<void> {
    set({ loading: true, error: null })
    try {
      const { userId } = get()
      const settings = await window.api.settings.getAll(userId)
      const settingsMap: Record<string, string | null> = {}
      for (const setting of settings) {
        settingsMap[setting.key] = setting.value
      }
      // Restore current theme from settings
      const themeId = settingsMap['theme_id'] ?? null
      set({ settings: settingsMap, currentThemeId: themeId, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      set({ error: message, loading: false })
    }
  },

  getSetting(key: string): string | null {
    return get().settings[key] ?? null
  },

  async setSetting(key: string, value: string | null): Promise<void> {
    try {
      const { userId } = get()
      await window.api.settings.set(userId, key, value)
      set((state) => ({
        settings: { ...state.settings, [key]: value }
      }))
      // Push to Supabase
      if (value !== null) {
        const uid = userId
        import('../../services/PersonalSyncService').then(({ pushSetting }) => {
          pushSetting(key, value, uid)
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save setting'
      set({ error: message })
      throw err
    }
  },

  async setMultipleSettings(settings: Setting[]): Promise<void> {
    try {
      const { userId } = get()
      await window.api.settings.setMultiple(userId, settings)
      set((state) => {
        const updated = { ...state.settings }
        for (const setting of settings) {
          updated[setting.key] = setting.value
        }
        return { settings: updated }
      })
      // Push to Supabase
      const uid = userId
      import('../../services/PersonalSyncService').then(({ pushSetting }) => {
        for (const setting of settings) {
          if (setting.value !== null) {
            pushSetting(setting.key, setting.value, uid)
          }
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings'
      set({ error: message })
      throw err
    }
  },

  async deleteSetting(key: string): Promise<boolean> {
    try {
      const { userId } = get()
      const result = await window.api.settings.delete(userId, key)
      if (result) {
        set((state) => {
          const { [key]: _, ...remaining } = state.settings
          return { settings: remaining }
        })
        // Delete from Supabase
        const uid = userId
        import('../../services/PersonalSyncService').then(({ deleteSettingFromSupabase }) => {
          deleteSettingFromSupabase(key, uid).catch(() => {})
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete setting'
      set({ error: message })
      throw err
    }
  },

  async hydrateThemes(): Promise<void> {
    try {
      const { userId } = get()
      const themes = await window.api.themes.list(userId)
      const themeMap: Record<string, Theme> = {}
      for (const theme of themes) {
        themeMap[theme.id] = theme
      }
      set({ themes: themeMap })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load themes'
      set({ error: message })
    }
  },

  async createTheme(input: CreateThemeInput): Promise<Theme> {
    try {
      const { userId } = get()
      const theme = await window.api.themes.create({ ...input, owner_id: userId })
      set((state) => ({
        themes: { ...state.themes, [theme.id]: theme }
      }))
      // Push to Supabase
      try {
        const config = JSON.parse(theme.config) as Record<string, string>
        import('../../services/PersonalSyncService').then(({ pushTheme }) => {
          pushTheme({
            id: theme.id,
            user_id: userId,
            name: theme.name,
            mode: theme.mode,
            bg: config.bg ?? '',
            fg: config.fg ?? '',
            accent: config.accent ?? '',
            surface: config.fgSecondary ?? '',
            muted: config.muted ?? '',
            border: config.border ?? '',
            updated_at: theme.updated_at
          }).catch(() => {})
        })
      } catch { /* skip if config parse fails */ }
      return theme
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create theme'
      set({ error: message })
      throw err
    }
  },

  async updateTheme(id: string, input: UpdateThemeInput): Promise<Theme | null> {
    try {
      const { userId } = get()
      const theme = await window.api.themes.update(id, input)
      if (theme) {
        set((state) => ({
          themes: { ...state.themes, [theme.id]: theme }
        }))
        // Push to Supabase
        try {
          const config = JSON.parse(theme.config) as Record<string, string>
          import('../../services/PersonalSyncService').then(({ pushTheme }) => {
            pushTheme({
              id: theme.id,
              user_id: userId,
              name: theme.name,
              mode: theme.mode,
              bg: config.bg ?? '',
              fg: config.fg ?? '',
              accent: config.accent ?? '',
              surface: config.fgSecondary ?? '',
              muted: config.muted ?? '',
              border: config.border ?? '',
              updated_at: theme.updated_at
            }).catch(() => {})
          })
        } catch { /* skip if config parse fails */ }
      }
      return theme
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update theme'
      set({ error: message })
      throw err
    }
  },

  async deleteTheme(id: string): Promise<boolean> {
    try {
      const result = await window.api.themes.delete(id)
      if (result) {
        set((state) => {
          const { [id]: _, ...remaining } = state.themes
          return { themes: remaining }
        })
        // Delete from Supabase
        import('../../services/PersonalSyncService').then(({ deleteThemeFromSupabase }) => {
          deleteThemeFromSupabase(id).catch(() => {})
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete theme'
      set({ error: message })
      throw err
    }
  },

  setCurrentTheme(id: string): void {
    set({ currentThemeId: id })
  },

  async getThemeConfig(id: string): Promise<ThemeConfig | null> {
    try {
      return await window.api.themes.getConfig(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load theme config'
      set({ error: message })
      return null
    }
  },

  clearError(): void {
    set({ error: null })
  }
}), shallow)

// Selectors
export const selectThemesByMode = (mode: string) => (state: SettingsState): Theme[] =>
  Object.values(state.themes).filter((t) => t.mode === mode)

export const selectCurrentTheme = (state: SettingsState): Theme | null =>
  state.currentThemeId ? state.themes[state.currentThemeId] ?? null : null

export const selectSetting = (key: string) => (state: SettingsState): string | null =>
  state.settings[key] ?? null

// Hooks — stable selectors for parameterized queries
export function useThemesByMode(mode: string): Theme[] {
  const themes = useSettingsStore((s) => s.themes)
  const prevRef = useRef<Theme[]>([])
  return useMemo(() => {
    const next = Object.values(themes).filter((t) => t.mode === mode)
    if (next.length === prevRef.current.length && next.every((t, i) => t === prevRef.current[i])) {
      return prevRef.current
    }
    prevRef.current = next
    return next
  }, [themes, mode])
}

export function useSetting(key: string): string | null {
  return useSettingsStore((s) => s.settings[key] ?? null)
}
