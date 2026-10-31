import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { hydrationContext } from './hydrationContext'
import { captureSyncProducer, requireProducerCurrent, type SyncProducer } from '../../services/syncContext'
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
  getThemeConfig(id: string): Promise<ThemeConfig | null>
  clearError(): void
}

export type SettingsStore = SettingsState & SettingsActions

let themeRevision = 0
let pendingThemeWrites = 0

export async function refreshSyncedTheme(userId: string, origin = hydrationContext()): Promise<void> {
  if (useSettingsStore.getState().userId !== userId || pendingThemeWrites) return
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

async function mutateTheme<T>(userId: string, origin: SyncProducer, operation: () => Promise<T>): Promise<T> {
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
    const origin = hydrationContext()
    const { userId } = get()
    set({ loading: true, error: null })
    try {
      const settings = await origin.api.settings.getAll(userId)
      if (!await origin.isCurrent()) return
      const settingsMap: Record<string, string | null> = {}
      for (const setting of settings) {
        settingsMap[setting.key] = setting.value
      }
      // Restore current theme from settings
      const themeId = settingsMap['theme_id'] ?? null
      set({ settings: settingsMap, currentThemeId: themeId, loading: false })
    } catch (err) {
      if (!await origin.isCurrent()) return
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      set({ error: message, loading: false })
    }
  },

  getSetting(key: string): string | null {
    return get().settings[key] ?? null
  },

  async setSetting(key: string, value: string | null): Promise<void> {
    const origin = captureSyncProducer()
    const { userId } = get()
    const save = async (): Promise<void> => {
      try {
        await origin.api.settings.set(userId, key, value)
        await requireProducerCurrent(origin)
        set((state) => ({
          settings: { ...state.settings, [key]: value }
        }))
        // Push to Supabase
        if (value !== null) {
          const uid = userId
          import('../../services/PersonalSyncService').then(({ pushSetting }) => {
            pushSetting(key, value, uid, origin)
          })
        }
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message = err instanceof Error ? err.message : 'Failed to save setting'
        set({ error: message })
        throw err
      }
    }
    return key === 'theme_id' ? mutateTheme(userId, origin, save) : save()
  },

  async setMultipleSettings(settings: Setting[]): Promise<void> {
    const origin = captureSyncProducer()
    const { userId } = get()
    const save = async (): Promise<void> => {
      try {
        await origin.api.settings.setMultiple(userId, settings)
        await requireProducerCurrent(origin)
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
              pushSetting(setting.key, setting.value, uid, origin)
            }
          }
        })
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message = err instanceof Error ? err.message : 'Failed to save settings'
        set({ error: message })
        throw err
      }
    }
    return settings.some((setting) => setting.key === 'theme_id') ? mutateTheme(userId, origin, save) : save()
  },

  async deleteSetting(key: string): Promise<boolean> {
    const origin = captureSyncProducer()
    const { userId } = get()
    const remove = async (): Promise<boolean> => {
      try {
        const result = await origin.api.settings.delete(userId, key)
        await requireProducerCurrent(origin)
        if (result) {
          set((state) => {
            const { [key]: _, ...remaining } = state.settings
            return { settings: remaining }
          })
          // Delete from Supabase
          const uid = userId
          import('../../services/PersonalSyncService').then(({ deleteSettingFromSupabase }) => {
            deleteSettingFromSupabase(key, uid, origin).catch(() => {})
          })
        }
        return result
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message = err instanceof Error ? err.message : 'Failed to delete setting'
        set({ error: message })
        throw err
      }
    }
    return key === 'theme_id' ? mutateTheme(userId, origin, remove) : remove()
  },

  async hydrateThemes(): Promise<void> {
    const origin = hydrationContext()
    const { userId } = get()
    try {
      const themes = await origin.api.themes.list(userId)
      if (!await origin.isCurrent()) return
      const themeMap: Record<string, Theme> = {}
      for (const theme of themes) {
        themeMap[theme.id] = theme
      }
      set({ themes: themeMap })
    } catch (err) {
      if (!await origin.isCurrent()) return
      const message = err instanceof Error ? err.message : 'Failed to load themes'
      set({ error: message })
    }
  },

  async createTheme(input: CreateThemeInput): Promise<Theme> {
    const origin = captureSyncProducer()
    const { userId } = get()
    return mutateTheme(userId, origin, async () => {
      try {
        const theme = await origin.api.themes.create({ ...input, owner_id: userId })
        await requireProducerCurrent(origin)
        set((state) => ({
          themes: { ...state.themes, [theme.id]: theme }
        }))
        import('../../services/PersonalSyncService').then(({ pushTheme }) => {
          pushTheme(theme, origin).catch(() => {})
        })
        return theme
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message = err instanceof Error ? err.message : 'Failed to create theme'
        set({ error: message })
        throw err
      }
    })
  },

  async updateTheme(id: string, input: UpdateThemeInput): Promise<Theme | null> {
    const origin = captureSyncProducer()
    const { userId } = get()
    return mutateTheme(userId, origin, async () => {
      try {
        const theme = await origin.api.themes.update(id, input)
        await requireProducerCurrent(origin)
        if (theme) {
          set((state) => ({
            themes: { ...state.themes, [theme.id]: theme }
          }))
          // Built-in edits stay local; uploading their IDs created duplicate presets.
          if (!theme.is_builtin) import('../../services/PersonalSyncService').then(({ pushTheme }) => {
            pushTheme(theme, origin).catch(() => {})
          })
        }
        return theme
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message = err instanceof Error ? err.message : 'Failed to update theme'
        set({ error: message })
        throw err
      }
    })
  },

  async deleteTheme(id: string): Promise<boolean> {
    const origin = captureSyncProducer()
    const { userId } = get()
    return mutateTheme(userId, origin, async () => {
      try {
        const result = await origin.api.themes.delete(id)
        await requireProducerCurrent(origin)
        if (result) {
          set((state) => {
            const { [id]: _, ...remaining } = state.themes
            return { themes: remaining }
          })
          // Delete from Supabase
          import('../../services/PersonalSyncService').then(({ deleteThemeFromSupabase }) => {
            deleteThemeFromSupabase(id, origin).catch(() => {})
          })
        }
        return result
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message = err instanceof Error ? err.message : 'Failed to delete theme'
        set({ error: message })
        throw err
      }
    })
  },

  async getThemeConfig(id: string): Promise<ThemeConfig | null> {
    const origin = hydrationContext()
    try {
      const config = await origin.api.themes.getConfig(id)
      return await origin.isCurrent() ? config : null
    } catch (err) {
      if (!await origin.isCurrent()) return null
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
