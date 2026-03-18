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
  settings: Record<string, string | null>
  themes: Record<string, Theme>
  currentThemeId: string | null
  loading: boolean
  error: string | null
}

interface SettingsActions {
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
  settings: {},
  themes: {},
  currentThemeId: null,
  loading: false,
  error: null,

  async hydrateSettings(): Promise<void> {
    set({ loading: true, error: null })
    try {
      const settings = await window.api.settings.getAll()
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
      await window.api.settings.set(key, value)
      set((state) => ({
        settings: { ...state.settings, [key]: value }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save setting'
      set({ error: message })
      throw err
    }
  },

  async setMultipleSettings(settings: Setting[]): Promise<void> {
    try {
      await window.api.settings.setMultiple(settings)
      set((state) => {
        const updated = { ...state.settings }
        for (const setting of settings) {
          updated[setting.key] = setting.value
        }
        return { settings: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings'
      set({ error: message })
      throw err
    }
  },

  async deleteSetting(key: string): Promise<boolean> {
    try {
      const result = await window.api.settings.delete(key)
      if (result) {
        set((state) => {
          const { [key]: _, ...remaining } = state.settings
          return { settings: remaining }
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
      const themes = await window.api.themes.list()
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
      const theme = await window.api.themes.create(input)
      set((state) => ({
        themes: { ...state.themes, [theme.id]: theme }
      }))
      return theme
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create theme'
      set({ error: message })
      throw err
    }
  },

  async updateTheme(id: string, input: UpdateThemeInput): Promise<Theme | null> {
    try {
      const theme = await window.api.themes.update(id, input)
      if (theme) {
        set((state) => ({
          themes: { ...state.themes, [theme.id]: theme }
        }))
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
