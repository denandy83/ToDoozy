import { contrastRatio, isHexColor, surfaceColor, repairThemeText } from '../../../../shared/colorContrast'
import { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from 'react'
import { useSettingsStore, selectCurrentTheme, useThemesByMode } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import { Trash2, RotateCcw, Save, Download, Upload, Pencil } from 'lucide-react'
import { ColorSquare, ColorHex } from './ColorPicker'
import { ThemePreview } from './ThemePreview'
import { ThemeOptions } from './ThemeOptions'
import { findThemeCounterpart, findThemeForMode, hasThemeFamily } from '../../shared/utils/themeChoices'
import { Modal } from '../../shared/components/Modal'
import {
  serializeThemePair,
  validateThemeJson,
  resolveImportName,
  slugifyThemeName,
  stripModeSuffix,
  isThemeConfigEqual,
  errorToMessage,
  type ValidationError
} from '../../shared/utils/themeIO'
import type { ThemeConfig, Theme } from '../../../../shared/types'

import { DEFAULT_THEME_CONFIG as DEFAULT_CONFIG, BUILTIN_CONFIGS, resolveBuiltinConfig } from '../../../../shared/themeCatalog'

const COLOR_LABELS: Record<keyof ThemeConfig, string> = {
  bg: 'Background',
  fg: 'Foreground',
  fgSecondary: 'Secondary',
  fgMuted: 'Muted FG',
  muted: 'Muted',
  accent: 'Accent',
  accentFg: 'Accent FG',
  border: 'Border',
  sidebar: 'Sidebar'
}

function deriveSidebar(bg: string): string {
  const num = parseInt(bg.replace('#', ''), 16)
  const brightness = ((num >> 16) & 0xff) + ((num >> 8) & 0xff) + (num & 0xff)
  const amount = brightness < 384 ? 12 : -8
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function parseConfig(theme: Theme): ThemeConfig {
  try {
    const raw = JSON.parse(theme.config) as ThemeConfig
    const c = resolveBuiltinConfig(theme.name, theme.is_builtin, raw)
    return {
      bg: c.bg ?? DEFAULT_CONFIG.bg,
      fg: c.fg ?? DEFAULT_CONFIG.fg,
      fgSecondary: c.fgSecondary ?? DEFAULT_CONFIG.fgSecondary,
      fgMuted: c.fgMuted ?? DEFAULT_CONFIG.fgMuted,
      muted: c.muted ?? DEFAULT_CONFIG.muted,
      accent: c.accent ?? DEFAULT_CONFIG.accent,
      accentFg: c.accentFg ?? DEFAULT_CONFIG.accentFg,
      border: c.border ?? DEFAULT_CONFIG.border,
      sidebar: c.sidebar ?? deriveSidebar(c.bg ?? DEFAULT_CONFIG.bg)
    }
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
    border: invertLightness(config.border),
    sidebar: invertLightness(config.sidebar)
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
  const [colorsEdited, setColorsEdited] = useState(false)
  const [changedKeys, setChangedKeys] = useState<Set<keyof ThemeConfig>>(new Set())
  const [isNaming, setIsNaming] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [importError, setImportError] = useState<ValidationError | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const themesMap = useSettingsStore((s) => s.themes)

  const themesForMode = useThemesByMode(mode)

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
    async (newMode: 'dark' | 'light') => {
      setMode(newMode)
      const target = findThemeForMode(currentTheme, Object.values(useSettingsStore.getState().themes), newMode)
      if (target) {
        setSelectedThemeId(target.id)
        setEditConfig(parseConfig(target))
        applyThemeConfig(parseConfig(target))
        await setSetting('theme_id', target.id)
        await setSetting('theme_mode', newMode)
        setCurrentTheme(target.id)
        setConfigEdited(false)
        setColorsEdited(false)
        setChangedKeys(new Set())
      }
    },
    [currentTheme, setSetting, setCurrentTheme]
  )

  const handlePresetChange = useCallback((themeId: string) => {
    const themes = useSettingsStore.getState().themes
    const theme = themes[themeId]
    if (!theme) return
    setSelectedThemeId(themeId)
    setEditConfig(parseConfig(theme))
    applyThemeConfig(parseConfig(theme))
    const currentId = useSettingsStore.getState().currentThemeId
    setConfigEdited(themeId !== currentId)
    setColorsEdited(false)
    setChangedKeys(new Set())
  }, [])

  const selectedTheme = selectedThemeId ? useSettingsStore.getState().themes[selectedThemeId] : null

  const handleColorChange = useCallback((key: keyof ThemeConfig, value: string) => {
    const next = { ...editConfig, [key]: value }
    setEditConfig(next)
    applyThemeConfig(next)
    const saved = selectedThemeId ? useSettingsStore.getState().themes[selectedThemeId] : null
    const dirty = saved ? !isThemeConfigEqual(next, parseConfig(saved)) : true
    setConfigEdited(dirty)
    setColorsEdited(dirty)
    setChangedKeys((prev) => new Set([...prev, key]))
  }, [editConfig, selectedThemeId])

  const handleApply = useCallback(async () => {
    if (!selectedThemeId) return
    try {
      if (colorsEdited) {
        await updateTheme(selectedThemeId, { config: JSON.stringify(editConfig) })
      }
      await setSetting('theme_id', selectedThemeId)
      await setSetting('theme_mode', mode)
      setCurrentTheme(selectedThemeId)
      setConfigEdited(false)
      setColorsEdited(false)
      setChangedKeys(new Set())

      // Only offer counterpart update if colors were actually edited
      const counterpartMode = mode === 'dark' ? 'light' : 'dark'
      const allThemes = useSettingsStore.getState().themes
      const counterpart = findThemeCounterpart(selectedTheme, Object.values(allThemes))

      if (counterpart && colorsEdited) {
        setBlocked(true)
        addToast({
          message: `Theme saved. Update ${counterpartMode} counterpart too?`,
          persistent: true,
          actions: [
            {
              label: 'Update',
              variant: 'accent',
              onClick: async () => {
                // Only update the changed keys in the counterpart, preserving its other values
                const existingCounterpartConfig = parseConfig(counterpart)
                const invertedChanges = generateCounterpartConfig(editConfig)
                const mergedConfig = { ...existingCounterpartConfig }
                for (const key of changedKeys) {
                  mergedConfig[key] = invertedChanges[key]
                }
                await updateTheme(counterpart.id, { config: JSON.stringify(mergedConfig) })
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
  }, [selectedThemeId, selectedTheme, editConfig, mode, colorsEdited, changedKeys, updateTheme, setSetting, setCurrentTheme, addToast])

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

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenaming])

  const handleStartRename = useCallback(() => {
    if (!selectedTheme) return
    setRenameValue(stripModeSuffix(selectedTheme.name))
    setIsRenaming(true)
  }, [selectedTheme])

  const handleCancelRename = useCallback(() => {
    setIsRenaming(false)
    setRenameValue('')
  }, [])

  const handleSaveRename = useCallback(async () => {
    if (!selectedThemeId || !selectedTheme) return
    const newBase = renameValue.trim()
    if (!newBase) {
      addToast({ message: 'Enter a name', variant: 'danger' })
      return
    }
    const oldBase = stripModeSuffix(selectedTheme.name)
    if (newBase === oldBase) {
      handleCancelRename()
      return
    }
    if (hasThemeFamily(newBase, Object.values(useSettingsStore.getState().themes))) {
      addToast({ message: 'A theme with that name already exists. Choose another name.', variant: 'danger' })
      return
    }
    try {
      const currentSuffix = selectedTheme.mode === 'dark' ? 'Dark' : 'Light'
      await updateTheme(selectedThemeId, { name: `${newBase} ${currentSuffix}` })

      const counterpartSuffix = selectedTheme.mode === 'dark' ? 'Light' : 'Dark'
      const allThemes = useSettingsStore.getState().themes
      const counterpart = findThemeCounterpart(selectedTheme, Object.values(allThemes))
      if (counterpart) {
        await updateTheme(counterpart.id, { name: `${newBase} ${counterpartSuffix}` })
      }
      setIsRenaming(false)
      setRenameValue('')
      addToast({ message: 'Theme renamed' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to rename theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [selectedThemeId, selectedTheme, renameValue, updateTheme, addToast, handleCancelRename])

  const canDeleteSelected = selectedTheme && !selectedTheme.is_builtin

  const executeDeleteTheme = useCallback(async () => {
    if (!selectedThemeId || !canDeleteSelected) return
    const themeName = selectedTheme?.name ?? ''
    const allThemes = useSettingsStore.getState().themes
    const counterpart = findThemeCounterpart(selectedTheme, Object.values(allThemes))

    try {
      await deleteTheme(selectedThemeId)
      if (counterpart) await deleteTheme(counterpart.id)

      const standard = Object.values(useSettingsStore.getState().themes).find(
        (t) => t.name === 'Standard Dark' && t.is_builtin === 1
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
      addToast({ message: `Deleted "${themeName}"${counterpart ? ' and its counterpart' : ''}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete theme'
      addToast({ message: msg, variant: 'danger' })
    }
  }, [selectedThemeId, canDeleteSelected, selectedTheme, deleteTheme, setSetting, setCurrentTheme, addToast])

  const handleDeleteTheme = useCallback(() => {
    if (!selectedTheme) return
    const counterpart = findThemeCounterpart(selectedTheme, Object.values(useSettingsStore.getState().themes))
    setBlocked(true)
    addToast({
      message: `Delete "${selectedTheme.name}"${counterpart ? ' and its counterpart' : ''}?`,
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
        const counterpart = findThemeCounterpart(selectedTheme, Object.values(allThemes))
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
    if (hasThemeFamily(name, Object.values(useSettingsStore.getState().themes))) {
      addToast({ message: 'A theme with that name already exists. Choose another name.', variant: 'danger' })
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

  const handleExport = useCallback(async () => {
    const selected = selectedThemeId ? themesMap[selectedThemeId] : null
    if (!selected) {
      addToast({ message: 'Select a theme first', variant: 'danger' })
      return
    }
    const base = stripModeSuffix(selected.name)
    const all = Object.values(themesMap)
    const selectedConfig = parseConfig(selected)
    const counterpart = findThemeCounterpart(selected, all)
    const counterpartConfig: ThemeConfig = counterpart
      ? parseConfig(counterpart)
      : generateCounterpartConfig(selectedConfig)

    const dark = selected.mode === 'dark' ? selectedConfig : counterpartConfig
    const light = selected.mode === 'light' ? selectedConfig : counterpartConfig

    const contents = serializeThemePair(base, dark, light)
    const filename = `${slugifyThemeName(base)}.todoozy-theme.json`
    const res = await window.api.fs.showSaveDialog({ defaultPath: filename, contents })
    if (res.canceled) return
    if (res.error) {
      addToast({ message: 'Could not save file', variant: 'danger' })
      return
    }
    addToast({ message: 'Theme exported' })
  }, [selectedThemeId, themesMap, addToast])

  const handleImport = useCallback(async () => {
    const open = await window.api.fs.showOpenDialog({
      filters: [{ name: 'ToDoozy Theme', extensions: ['json'] }],
      title: 'Import theme',
      multiSelections: false
    })
    if (open.canceled || open.filePaths.length === 0) return
    const read = await window.api.fs.readFile(open.filePaths[0])
    if (!read.ok || typeof read.contents !== 'string') {
      setImportError({ kind: 'read' })
      return
    }
    const result = validateThemeJson(read.contents)
    if (!result.ok) {
      setImportError(result.error)
      return
    }
    const { name, configs } = result.theme

    const existingBases = Array.from(new Set(
      Object.values(themesMap).map((t) => stripModeSuffix(t.name))
    ))
    const baseName = resolveImportName(name, existingBases)

    const darkId = crypto.randomUUID()
    const lightId = crypto.randomUUID()

    try {
      await createTheme({
        id: darkId,
        name: `${baseName} Dark`,
        mode: 'dark',
        config: JSON.stringify(configs.dark)
      })
      await createTheme({
        id: lightId,
        name: `${baseName} Light`,
        mode: 'light',
        config: JSON.stringify(configs.light)
      })
    } catch (err) {
      console.error('[theme import] createTheme failed', err)
      setImportError({ kind: 'write' })
      return
    }

    const newId = mode === 'dark' ? darkId : lightId
    setSelectedThemeId(newId)
    await setSetting('theme_id', newId)
    await setSetting('theme_mode', mode)
    setCurrentTheme(newId)
    addToast({ message: 'Theme loaded successfully' })
  }, [themesMap, mode, createTheme, setSetting, setCurrentTheme, addToast])

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
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        ) : isRenaming ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename()
                if (e.key === 'Escape') handleCancelRename()
              }}
              placeholder="Theme name..."
              className="flex-1 rounded-lg border border-accent bg-background px-3 py-1.5 text-sm text-foreground outline-none"
            />
            <button
              onClick={handleSaveRename}
              disabled={!renameValue.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Rename
            </button>
            <button
              onClick={handleCancelRename}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <select
              aria-label="Theme"
              value={selectedThemeId ?? ''}
              onChange={(e) => handlePresetChangeOrNew(e.target.value)}
              className="w-64 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            >
              <ThemeOptions themes={themesForMode} />
              <option value="__new__">+ New Theme...</option>
            </select>
            <button
              onClick={handleExport}
              disabled={!selectedThemeId}
              aria-label="Export theme"
              title="Export theme to JSON"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground disabled:opacity-40"
            >
              <Download size={14} />
            </button>
            <button
              onClick={handleImport}
              aria-label="Import theme"
              title="Import theme from JSON"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            >
              <Upload size={14} />
            </button>
            {canDeleteSelected && (
              <button
                onClick={handleStartRename}
                aria-label="Rename theme"
                title="Rename theme"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                <Pencil size={14} />
              </button>
            )}
            {colorsEdited ? (
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
      <div className="flex flex-col gap-1">
        {(() => {
          const keys = Object.keys(COLOR_LABELS) as Array<keyof ThemeConfig>
          const rows: React.JSX.Element[] = []
          for (let i = 0; i < keys.length; i += 2) {
            const left = keys[i]
            const right = keys[i + 1]
            rows.push(
              <div key={`row-${i}`} className="flex items-center gap-1.5 h-7">
                <span className="w-[70px] flex-shrink-0 whitespace-nowrap overflow-hidden text-[11px] font-medium text-fg-secondary text-right">{COLOR_LABELS[left]}</span>
                <ColorSquare label={COLOR_LABELS[left]} value={editConfig[left]} onChange={(v) => handleColorChange(left, v)} />
                <span className="w-[52px] flex-shrink-0 text-xs font-mono text-fg-secondary"><ColorHex value={editConfig[left]} onChange={(v) => handleColorChange(left, v)} /></span>
                {right && (
                  <>
                    <span className="ml-2 w-[70px] flex-shrink-0 whitespace-nowrap overflow-hidden text-[11px] font-medium text-fg-secondary text-right">{COLOR_LABELS[right]}</span>
                    <ColorSquare label={COLOR_LABELS[right]} value={editConfig[right]} onChange={(v) => handleColorChange(right, v)} />
                    <span className="w-[52px] flex-shrink-0 text-xs font-mono text-fg-secondary"><ColorHex value={editConfig[right]} onChange={(v) => handleColorChange(right, v)} /></span>
                  </>
                )}
              </div>
            )
          }
          return rows
        })()}
      </div>

      {Object.values(editConfig).every(isHexColor) && <div className="flex flex-wrap gap-2" aria-label="Theme contrast checks">
        {([['Text', editConfig.fg, editConfig.bg], ['Secondary', editConfig.fgSecondary, editConfig.bg], ['Muted', editConfig.muted, surfaceColor(editConfig.bg)], ['Accent text', editConfig.accentFg, editConfig.accent]] as const).map(([name, foreground, background]) => {
          const ratio = contrastRatio(foreground, background)
          return <span key={name} className={`rounded border px-2 py-1 text-[11px] ${ratio >= 4.5 ? 'border-border text-fg-secondary' : 'border-danger/40 text-danger'}`} title="Normal text should have at least 4.5:1 contrast">{name} {ratio.toFixed(2)}:1 {ratio >= 4.5 ? '✓' : '— low'}</span>
        })}
      </div>}

      <button type="button" className="self-start rounded border border-border px-3 py-1.5 text-xs text-fg-secondary hover:text-foreground" onClick={() => {
        const next = repairThemeText(editConfig)
        const keys = (Object.keys(next) as Array<keyof ThemeConfig>).filter((key) => next[key] !== editConfig[key])
        if (!keys.length) return
        setEditConfig(next)
        applyThemeConfig(next)
        setConfigEdited(true)
        setColorsEdited(true)
        setChangedKeys((previous) => new Set([...previous, ...keys]))
      }}>Improve text contrast</button>

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
        className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Apply Theme
      </button>

      <Modal
        open={importError !== null}
        onClose={() => setImportError(null)}
        title="Import failed"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm font-light text-foreground">
            {importError ? errorToMessage(importError) : ''}
          </p>
          <button
            onClick={() => setImportError(null)}
            className="self-end rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg hover:bg-accent/80"
          >
            Close
          </button>
        </div>
      </Modal>
    </div>
  )
})
