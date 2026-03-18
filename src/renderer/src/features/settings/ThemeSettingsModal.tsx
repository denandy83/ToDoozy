import { useState, useEffect, useCallback, useMemo } from 'react'
import { Modal } from '../../shared/components/Modal'
import { useSettingsStore, selectCurrentTheme, useThemesByMode } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import { ColorPicker } from './ColorPicker'
import { ThemePreview } from './ThemePreview'
import type { ThemeConfig, Theme } from '../../../../shared/types'

interface ThemeSettingsModalProps {
  open: boolean
  onClose: () => void
}

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

function parseConfig(theme: Theme): ThemeConfig {
  try {
    return JSON.parse(theme.config) as ThemeConfig
  } catch {
    return DEFAULT_CONFIG
  }
}

export function ThemeSettingsModal({ open, onClose }: ThemeSettingsModalProps): React.JSX.Element | null {
  const currentTheme = useSettingsStore(selectCurrentTheme)
  const { setSetting, setCurrentTheme, createTheme, updateTheme } = useSettingsStore()
  const { addToast } = useToast()

  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [editConfig, setEditConfig] = useState<ThemeConfig>(DEFAULT_CONFIG)
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [hasChanges, setHasChanges] = useState(false)

  const themesForMode = useThemesByMode(mode)
  const sortedThemes = useMemo(
    () => [...themesForMode].sort((a, b) => a.name.localeCompare(b.name)),
    [themesForMode]
  )

  // Initialize from current theme when modal opens
  useEffect(() => {
    if (open && currentTheme) {
      const m = currentTheme.mode === 'light' ? 'light' : 'dark'
      setMode(m)
      setSelectedThemeId(currentTheme.id)
      setEditConfig(parseConfig(currentTheme))
      setHasChanges(false)
      setCustomName('')
    }
  }, [open, currentTheme])

  // When mode changes, select the first theme in that mode
  const handleModeChange = useCallback(
    (newMode: 'dark' | 'light') => {
      setMode(newMode)
      // Find the current theme's equivalent in the new mode, or pick first
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
        setHasChanges(true)
      }
    },
    [currentTheme]
  )

  // When a preset is selected
  const handlePresetChange = useCallback(
    (themeId: string) => {
      const themes = useSettingsStore.getState().themes
      const theme = themes[themeId]
      if (theme) {
        setSelectedThemeId(themeId)
        setEditConfig(parseConfig(theme))
        // Live preview: apply to UI immediately
        applyThemeConfig(parseConfig(theme))
        setHasChanges(true)
      }
    },
    []
  )

  // When a color is changed
  const handleColorChange = useCallback(
    (key: keyof ThemeConfig, value: string) => {
      setEditConfig((prev) => {
        const next = { ...prev, [key]: value }
        // Live preview
        applyThemeConfig(next)
        return next
      })
      setHasChanges(true)
    },
    []
  )

  // Apply: persist the current config
  const handleApply = useCallback(async () => {
    if (!selectedThemeId) return

    try {
      // Update the selected theme's config
      await updateTheme(selectedThemeId, { config: JSON.stringify(editConfig) })
      // Save as current theme
      await setSetting('theme_id', selectedThemeId)
      await setSetting('theme_mode', mode)
      setCurrentTheme(selectedThemeId)
      setHasChanges(false)
      addToast({ message: 'Theme applied' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [selectedThemeId, editConfig, mode, updateTheme, setSetting, setCurrentTheme, addToast])

  // Save as new custom theme
  const handleSaveAs = useCallback(async () => {
    const name = customName.trim()
    if (!name) {
      addToast({ message: 'Enter a name for the custom theme', variant: 'danger' })
      return
    }

    try {
      const theme = await createTheme({
        id: crypto.randomUUID(),
        name: `${name} ${mode === 'dark' ? 'Dark' : 'Light'}`,
        mode,
        config: JSON.stringify(editConfig)
      })
      setSelectedThemeId(theme.id)
      await setSetting('theme_id', theme.id)
      await setSetting('theme_mode', mode)
      setCurrentTheme(theme.id)
      setCustomName('')
      setHasChanges(false)
      addToast({ message: `Theme "${theme.name}" created` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [customName, mode, editConfig, createTheme, setSetting, setCurrentTheme, addToast])

  // Revert to saved theme on cancel
  const handleClose = useCallback(() => {
    if (currentTheme) {
      applyThemeConfig(parseConfig(currentTheme))
    }
    onClose()
  }, [currentTheme, onClose])

  if (!open) return null

  return (
    <Modal open={open} onClose={handleClose} title="Theme Settings">
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

        {/* Preset dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Preset</span>
          <select
            value={selectedThemeId ?? ''}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {sortedThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
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

        {/* Save as custom */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Custom theme name..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveAs()}
          />
          <button
            onClick={handleSaveAs}
            disabled={!customName.trim()}
            className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save As
          </button>
        </div>

        {/* Apply button */}
        <button
          onClick={handleApply}
          disabled={!hasChanges}
          className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Apply Theme
        </button>
      </div>
    </Modal>
  )
}
