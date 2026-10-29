import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { hydrationContext } from './hydrationContext'
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

let themeRevision = 0
let pendingThemeWrites = 0

export async function refreshSyncedTheme(userId: string, origin = hydrationContext()): Promise<void> {
  if (!userId || useSettingsStore.getState().userId !== userId || pendingThemeWrites) return
  const revision = ++themeRevision
  if (!await origin.isCurrent()) return
  const [themeId, themes] = await Promise.all([
    origin.api.settings.get(userId, 'theme_id'),
    origin.api.themes.list(userId)
  ])
  if (!await origin.isCurrent()) return
  useSettingsStore.setState((state) => {
    if (state.userId !== userId || revision !== themeRevision || pendingThemeWrites) return state
    return {
      currentThemeId: themeId,
      settings: { ...state.settings, theme_id: themeId },
      themes: Object.fromEntries(themes.map((theme) => [theme.id, theme]))
    }
  })
}

async function mutateTheme<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const origin = hydrationContext()
  ++themeRevision
  ++pendingThemeWrites
  try {
    return await operation()
  } finally {
    --pendingThemeWrites
    ++themeRevision
    await refreshSyncedTheme(userId, origin)
  }
}

export const useSettingsStore = createWithEqualityFn<SettingsStore>((set, get) => ({
  userId: '',
  settings: {},
  themes: {},
  currentThemeId: null,
  loading: false,
  error: null,

  setUserId(userId: string): void {
    ++themeRevision
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
    const save = async (): Promise<void> => {
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
    }
    return key === 'theme_id' ? mutateTheme(get().userId, save) : save()
  },

  async setMultipleSettings(settings: Setting[]): Promise<void> {
    const save = async (): Promise<void> => {
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
    }
    return settings.some((setting) => setting.key === 'theme_id') ? mutateTheme(get().userId, save) : save()
  },

  async deleteSetting(key: string): Promise<boolean> {
    const remove = async (): Promise<boolean> => {
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
    }
    return key === 'theme_id' ? mutateTheme(get().userId, remove) : remove()
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
    return mutateTheme(get().userId, async () => {
      try {
        const { userId } = get()
        const theme = await window.api.themes.create({ ...input, owner_id: userId })
        set((state) => ({
          themes: { ...state.themes, [theme.id]: theme }
        }))
        import('../../services/PersonalSyncService').then(({ pushTheme }) => {
          pushTheme(theme).catch(() => {})
        })
        return theme
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create theme'
        set({ error: message })
        throw err
      }
    })
  },

  async updateTheme(id: string, input: UpdateThemeInput): Promise<Theme | null> {
    return mutateTheme(get().userId, async () => {
      try {
        const theme = await window.api.themes.update(id, input)
        if (theme) {
          set((state) => ({
            themes: { ...state.themes, [theme.id]: theme }
          }))
          // Built-in edits stay local; uploading their IDs created duplicate presets.
          if (!theme.is_builtin) import('../../services/PersonalSyncService').then(({ pushTheme }) => {
            pushTheme(theme).catch(() => {})
          })
        }
        return theme
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update theme'
        set({ error: message })
        throw err
      }
    })
  },

  async deleteTheme(id: string): Promise<boolean> {
    return mutateTheme(get().userId, async () => {
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
    })
  },

  setCurrentTheme(id: string): void {
    ++themeRevision
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
