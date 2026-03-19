import { useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef, useRef } from 'react'
import { useSettingsStore, selectCurrentTheme, useThemesByMode } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import { Trash2, RotateCcw, Save } from 'lucide-react'
import { ColorPicker } from './ColorPicker'
import { ThemePreview } from './ThemePreview'
import type { ThemeConfig, Theme } from '../../../../shared/types'

const DEFAULT_CONFIG: ThemeConfig = {
  bg: '#1a1a2e',
  fg: '#e0e0e0',
  fgSecondary: '#b0b0b0',
  fgMuted: '#666666',
  muted: '#888888',
  accent: '#6366f1',
  accentFg: '#ffffff',
  border: '#2a2a4a'
}

const COLOR_LABELS: Record<keyof ThemeConfig, string> = {
  bg: 'Background',
  fg: 'Foreground',
  fgSecondary: 'Secondary',
  fgMuted: 'Muted FG',
  muted: 'Muted',
  accent: 'Accent',
  accentFg: 'Accent FG',
  border: 'Border'
}

const BUILTIN_CONFIGS: Record<string, ThemeConfig> = {
  'Standard Dark': { bg: '#1a1a2e', fg: '#e0e0e0', fgSecondary: '#b0b0b0', fgMuted: '#666666', muted: '#888888', accent: '#6366f1', accentFg: '#ffffff', border: '#2a2a4a' },
  'Standard Light': { bg: '#f8f9fa', fg: '#1a1a2e', fgSecondary: '#4a4a6a', fgMuted: '#999999', muted: '#888888', accent: '#6366f1', accentFg: '#ffffff', border: '#e0e0e8' },
  'Warm Earth Dark': { bg: '#1c1410', fg: '#e8ddd0', fgSecondary: '#b8a898', fgMuted: '#7a6a5a', muted: '#8a7a6a', accent: '#d4915e', accentFg: '#1c1410', border: '#3a2a1e' },
  'Warm Earth Light': { bg: '#faf5ef', fg: '#3a2a1e', fgSecondary: '#6a5a4a', fgMuted: '#a09080', muted: '#8a7a6a', accent: '#c07830', accentFg: '#ffffff', border: '#e0d5c8' },
  'Ocean Blue Dark': { bg: '#0d1b2a', fg: '#d0e0f0', fgSecondary: '#8ab0d0', fgMuted: '#4a6a8a', muted: '#5a7a9a', accent: '#2196f3', accentFg: '#ffffff', border: '#1b3a5a' },
  'Ocean Blue Light': { bg: '#f0f6fc', fg: '#0d1b2a', fgSecondary: '#2a4a6a', fgMuted: '#7a9abc', muted: '#5a7a9a', accent: '#1976d2', accentFg: '#ffffff', border: '#c8daf0' },
  'Amethyst Dark': { bg: '#1a1024', fg: '#e0d0f0', fgSecondary: '#b090d0', fgMuted: '#6a4a8a', muted: '#7a5a9a', accent: '#9c27b0', accentFg: '#ffffff', border: '#2a1a3e' },
  'Amethyst Light': { bg: '#f8f0fc', fg: '#2a1a3e', fgSecondary: '#5a3a7a', fgMuted: '#9a7aba', muted: '#7a5a9a', accent: '#8e24aa', accentFg: '#ffffff', border: '#e0c8f0' },
  'Forest Dark': { bg: '#0e1a10', fg: '#d0e8d0', fgSecondary: '#90b890', fgMuted: '#4a7a4a', muted: '#5a8a5a', accent: '#4caf50', accentFg: '#ffffff', border: '#1a3a1a' },
  'Forest Light': { bg: '#f0faf0', fg: '#1a3a1a', fgSecondary: '#3a6a3a', fgMuted: '#7aaa7a', muted: '#5a8a5a', accent: '#388e3c', accentFg: '#ffffff', border: '#c0e0c0' },
  'Rosewood Dark': { bg: '#1a0e10', fg: '#f0d0d8', fgSecondary: '#d090a0', fgMuted: '#8a4a5a', muted: '#9a5a6a', accent: '#e91e63', accentFg: '#ffffff', border: '#3a1a22' },
  'Rosewood Light': { bg: '#fcf0f2', fg: '#3a1a22', fgSecondary: '#7a3a4a', fgMuted: '#ba7a8a', muted: '#9a5a6a', accent: '#c2185b', accentFg: '#ffffff', border: '#f0c8d0' }
}

function parseConfig(theme: Theme): ThemeConfig {
  try {
    return JSON.parse(theme.config) as ThemeConfig
  } catch {
    return DEFAULT_CONFIG
  }
}

// Convert hex to HSL, invert lightness, convert back
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  let r: number, g: number, b: number
  if (s === 0) { r = g = b = l } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }
  const toHex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function invertLightness(hex: string): string {
  const [h, s, l] = hexToHsl(hex)
  return hslToHex(h, s, 100 - l)
}

function generateCounterpartConfig(config: ThemeConfig): ThemeConfig {
  return {
    bg: invertLightness(config.bg),
    fg: invertLightness(config.fg),
    fgSecondary: invertLightness(config.fgSecondary),
    fgMuted: invertLightness(config.fgMuted),
    muted: config.muted, // muted stays similar in both modes
    accent: config.accent, // accent color stays the same
    accentFg: config.accentFg, // accent fg stays the same
    border: invertLightness(config.border)
  }
}

export interface ThemeSettingsHandle {
  hasChanges: boolean
  apply: () => Promise<void>
  revert: () => void
}

interface ThemeSettingsContentProps {
  onDirtyChange?: (dirty: boolean) => void
  onBlockingChange?: (blocked: boolean) => void
}

export const ThemeSettingsContent = forwardRef<ThemeSettingsHandle, ThemeSettingsContentProps>(function ThemeSettingsContent({ onDirtyChange, onBlockingChange }, ref) {
  const currentTheme = useSettingsStore(selectCurrentTheme)
  const { setSetting, setCurrentTheme, createTheme, updateTheme, deleteTheme } = useSettingsStore()
  const { addToast } = useToast()

  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [editConfig, setEditConfig] = useState<ThemeConfig>(DEFAULT_CONFIG)
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [configEdited, setConfigEdited] = useState(false)
  const [isNaming, setIsNaming] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const themesForMode = useThemesByMode(mode)
  const sortedThemes = useMemo(
    () => [...themesForMode].sort((a, b) => a.name.localeCompare(b.name)),
    [themesForMode]
  )

  useEffect(() => {
    if (currentTheme) {
      const m = currentTheme.mode === 'light' ? 'light' : 'dark'
      setMode(m)
      setSelectedThemeId(currentTheme.id)
      setEditConfig(parseConfig(currentTheme))
      setConfigEdited(false)
      setCustomName('')
    }
  }, [currentTheme])

  const handleModeChange = useCallback(
    (newMode: 'dark' | 'light') => {
      setMode(newMode)
      const themesInMode = Object.values(useSettingsStore.getState().themes).filter(
        (t) => t.mode === newMode
      )
      const match = themesInMode.find((t) => {
        const currentName = currentTheme?.name.replace(/ (Dark|Light)$/, '') ?? ''
        return t.name.replace(/ (Dark|Light)$/, '') === currentName
      })
      const target = match ?? themesInMode[0]
      if (target) {
        setSelectedThemeId(target.id)
        setEditConfig(parseConfig(target))
        applyThemeConfig(parseConfig(target))
        setConfigEdited(false)
      }
    },
    [currentTheme]
  )

  const handlePresetChange = useCallback((themeId: string) => {
    const themes = useSettingsStore.getState().themes
    const theme = themes[themeId]
    if (theme) {
      setSelectedThemeId(themeId)
      setEditConfig(parseConfig(theme))
      applyThemeConfig(parseConfig(theme))
      setConfigEdited(false)
    }
  }, [])

  const selectedTheme = selectedThemeId ? useSettingsStore.getState().themes[selectedThemeId] : null

  const handleColorChange = useCallback((key: keyof ThemeConfig, value: string) => {
    setEditConfig((prev) => {
      const next = { ...prev, [key]: value }
      applyThemeConfig(next)
      return next
    })
    setConfigEdited(true)
  }, [])

  const handleApply = useCallback(async () => {
    if (!selectedThemeId) return
    try {
      await updateTheme(selectedThemeId, { config: JSON.stringify(editConfig) })
      await setSetting('theme_id', selectedThemeId)
      await setSetting('theme_mode', mode)
      setCurrentTheme(selectedThemeId)
      setConfigEdited(false)

      // Offer to update the counterpart theme
      const currentName = selectedTheme?.name ?? ''
      const baseName = currentName.replace(/ (Dark|Light)$/, '')
      const counterpartMode = mode === 'dark' ? 'light' : 'dark'
      const allThemes = useSettingsStore.getState().themes
      const counterpart = Object.values(allThemes).find(
        (t) => t.id !== selectedThemeId && t.name.replace(/ (Dark|Light)$/, '') === baseName && t.mode === counterpartMode
      )

      if (counterpart) {
        setBlocked(true)
        addToast({
          message: `Theme saved. Update ${counterpartMode} counterpart too?`,
          persistent: true,
          actions: [
            {
              label: 'Update',
              variant: 'accent',
              onClick: async () => {
                const counterpartConfig = generateCounterpartConfig(editConfig)
                await updateTheme(counterpart.id, { config: JSON.stringify(counterpartConfig) })
                setBlocked(false)
                addToast({ message: `${counterpart.name} updated` })
              }
            },
            { label: 'Skip', variant: 'muted', onClick: () => { setBlocked(false) } }
          ]
        })
      } else {
        addToast({ message: 'Theme saved' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [selectedThemeId, selectedTheme, editConfig, mode, updateTheme, setSetting, setCurrentTheme, addToast])

  const handleRevert = useCallback(() => {
    if (currentTheme) {
      applyThemeConfig(parseConfig(currentTheme))
      setEditConfig(parseConfig(currentTheme))
      setSelectedThemeId(currentTheme.id)
      setMode(currentTheme.mode === 'light' ? 'light' : 'dark')
    }
    setConfigEdited(false)
  }, [currentTheme])

  // Notify parent of dirty state
  useEffect(() => {
    onDirtyChange?.(configEdited)
  }, [configEdited, onDirtyChange])

  useImperativeHandle(ref, () => ({
    hasChanges: configEdited,
    apply: handleApply,
    revert: handleRevert
  }), [configEdited, handleApply, handleRevert])

  useEffect(() => {
    onBlockingChange?.(blocked)
  }, [blocked, onBlockingChange])

  useEffect(() => {
    if (isNaming) nameInputRef.current?.focus()
  }, [isNaming])

  const canDeleteSelected = selectedTheme && !selectedTheme.is_builtin

  const executeDeleteTheme = useCallback(async () => {
    if (!selectedThemeId || !canDeleteSelected) return
    const themeName = selectedTheme?.name ?? ''
    const baseName = themeName.replace(/ (Dark|Light)$/, '')
    const allThemes = useSettingsStore.getState().themes
    const counterpart = Object.values(allThemes).find(
      (t) => t.id !== selectedThemeId && t.name.replace(/ (Dark|Light)$/, '') === baseName && !t.is_builtin
    )

    try {
      await deleteTheme(selectedThemeId)
      if (counterpart) await deleteTheme(counterpart.id)

      const standard = Object.values(useSettingsStore.getState().themes).find(
        (t) => t.name === 'Standard Dark'
      )
      if (standard) {
        const config = parseConfig(standard)
        applyThemeConfig(config)
        setEditConfig(config)
        setSelectedThemeId(standard.id)
        setMode('dark')
        await setSetting('theme_id', standard.id)
        await setSetting('theme_mode', 'dark')
        setCurrentTheme(standard.id)
      }
      setConfigEdited(false)
      addToast({ message: `Deleted "${baseName}" themes` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [selectedThemeId, canDeleteSelected, selectedTheme, deleteTheme, setSetting, setCurrentTheme, addToast])

  const handleDeleteTheme = useCallback(() => {
    if (!selectedTheme) return
    const baseName = selectedTheme.name.replace(/ (Dark|Light)$/, '')
    setBlocked(true)
    addToast({
      message: `Delete "${baseName}" theme?`,
      persistent: true,
      actions: [
        { label: 'Delete', variant: 'danger', onClick: () => { executeDeleteTheme(); setBlocked(false) } },
        { label: 'Cancel', variant: 'muted', onClick: () => { setBlocked(false) } }
      ]
    })
  }, [selectedTheme, addToast, executeDeleteTheme])

  const canRevertSelected = selectedTheme?.is_builtin
    && selectedTheme.name in BUILTIN_CONFIGS
    && JSON.stringify(editConfig) !== JSON.stringify(BUILTIN_CONFIGS[selectedTheme.name])

  const handleRevertToDefault = useCallback(async () => {
    if (!selectedThemeId || !selectedTheme) return
    const originalConfig = BUILTIN_CONFIGS[selectedTheme.name]
    if (!originalConfig) return

    try {
      await updateTheme(selectedThemeId, { config: JSON.stringify(originalConfig) })
      setEditConfig(originalConfig)
      applyThemeConfig(originalConfig)
      setConfigEdited(false)

      // Check if counterpart also needs reverting
      const baseName = selectedTheme.name.replace(/ (Dark|Light)$/, '')
      const counterpartMode = mode === 'dark' ? 'light' : 'dark'
      const counterpartName = `${baseName} ${counterpartMode === 'dark' ? 'Dark' : 'Light'}`
      const counterpartOriginal = BUILTIN_CONFIGS[counterpartName]
      if (counterpartOriginal) {
        const allThemes = useSettingsStore.getState().themes
        const counterpart = Object.values(allThemes).find((t) => t.name === counterpartName)
        if (counterpart && JSON.stringify(parseConfig(counterpart)) !== JSON.stringify(counterpartOriginal)) {
          setBlocked(true)
          addToast({
            message: `Reverted. Also revert ${counterpartName}?`,
            persistent: true,
            actions: [
              {
                label: 'Revert',
                variant: 'accent',
                onClick: async () => {
                  await updateTheme(counterpart.id, { config: JSON.stringify(counterpartOriginal) })
                  setBlocked(false)
                  addToast({ message: `${counterpartName} reverted` })
                }
              },
              { label: 'Skip', variant: 'muted', onClick: () => { setBlocked(false) } }
            ]
          })
        } else {
          addToast({ message: `"${selectedTheme.name}" reverted to default` })
        }
      } else {
        addToast({ message: `"${selectedTheme.name}" reverted to default` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revert theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [selectedThemeId, selectedTheme, mode, updateTheme, addToast])

  const handlePresetChangeOrNew = useCallback((value: string) => {
    if (value === '__new__') {
      setIsNaming(true)
      setCustomName('')
      return
    }
    handlePresetChange(value)
  }, [handlePresetChange])

  const handleSaveAs = useCallback(async () => {
    const name = customName.trim()
    if (!name) {
      addToast({ message: 'Enter a name for the custom theme', variant: 'danger' })
      return
    }
    try {
      const counterpartMode = mode === 'dark' ? 'light' : 'dark'

      // Create the current theme
      const theme = await createTheme({
        id: crypto.randomUUID(),
        name: `${name} ${mode === 'dark' ? 'Dark' : 'Light'}`,
        mode,
        config: JSON.stringify(editConfig)
      })

      // Auto-create the counterpart with inverted lightness
      const counterpartConfig = generateCounterpartConfig(editConfig)
      await createTheme({
        id: crypto.randomUUID(),
        name: `${name} ${counterpartMode === 'dark' ? 'Dark' : 'Light'}`,
        mode: counterpartMode,
        config: JSON.stringify(counterpartConfig)
      })

      setSelectedThemeId(theme.id)
      await setSetting('theme_id', theme.id)
      await setSetting('theme_mode', mode)
      setCurrentTheme(theme.id)
      setCustomName('')
      setConfigEdited(false)
      addToast({ message: `Theme "${name}" created with ${counterpartMode} counterpart` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [customName, mode, editConfig, createTheme, setSetting, setCurrentTheme, addToast])

  return (
    <div className="flex flex-col gap-5">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Mode</span>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['dark', 'light'] as const).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                mode === m
                  ? 'bg-accent/12 text-accent'
                  : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Preset dropdown + delete */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Theme</span>
        {isNaming ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              ref={nameInputRef}
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { handleSaveAs(); setIsNaming(false) }
                if (e.key === 'Escape') setIsNaming(false)
              }}
              onBlur={() => { if (!customName.trim()) setIsNaming(false) }}
              placeholder="Theme name..."
              className="flex-1 rounded-lg border border-accent bg-background px-3 py-1.5 text-sm text-foreground outline-none"
            />
            <button
              onClick={() => { handleSaveAs(); setIsNaming(false) }}
              disabled={!customName.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        ) : (
          <>
            <select
              value={selectedThemeId ?? ''}
              onChange={(e) => handlePresetChangeOrNew(e.target.value)}
              className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground text-center outline-none focus:border-accent"
            >
              {sortedThemes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="__new__">+ New Theme...</option>
            </select>
            {configEdited ? (
              <button
                onClick={handleApply}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                title="Save changes"
              >
                <Save size={14} />
              </button>
            ) : canRevertSelected ? (
              <button
                onClick={handleRevertToDefault}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title="Revert to default"
              >
                <RotateCcw size={14} />
              </button>
            ) : canDeleteSelected ? (
              <button
                onClick={handleDeleteTheme}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                title="Delete this custom theme"
              >
                <Trash2 size={14} />
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Color pickers */}
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(COLOR_LABELS) as Array<keyof ThemeConfig>).map((key) => (
          <ColorPicker
            key={key}
            label={COLOR_LABELS[key]}
            value={editConfig[key]}
            onChange={(v) => handleColorChange(key, v)}
          />
        ))}
      </div>

      {/* Live preview */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Preview
        </p>
        <ThemePreview config={editConfig} />
      </div>

      {/* Apply button */}
      <button
        onClick={handleApply}
        disabled={!configEdited}
        className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Apply Theme
      </button>
    </div>
  )
})
