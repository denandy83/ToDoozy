import { resolveBuiltinConfig } from '../../../../shared/themeCatalog'
import { readableColor, surfaceColor, mixColor } from '../../../../shared/colorContrast'
import { useEffect } from 'react'
import { useSettingsStore, selectCurrentTheme } from '../stores'
import type { ThemeConfig } from '../../../../shared/types'

const CSS_VAR_MAP: Record<keyof ThemeConfig, string> = {
  bg: '--color-background',
  fg: '--color-foreground',
  fgSecondary: '--color-fg-secondary',
  fgMuted: '--color-fg-muted',
  muted: '--color-muted',
  accent: '--color-accent',
  accentFg: '--color-accent-fg',
  border: '--color-border',
  sidebar: '--color-sidebar'
}

/** Lighten or darken a hex color by a given amount (-255 to 255) */
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function resolveConfig(config: ThemeConfig): ThemeConfig {
  const bgBrightness =
    parseInt(config.bg.replace('#', '').slice(0, 2), 16) +
    parseInt(config.bg.replace('#', '').slice(2, 4), 16) +
    parseInt(config.bg.replace('#', '').slice(4, 6), 16)
  const isDark = bgBrightness < 384
  return {
    ...config,
    // Derive sidebar from bg if absent (themes saved before the sidebar field was added)
    sidebar: config.sidebar ?? adjustColor(config.bg, isDark ? 12 : -8)
  }
}

export function applyThemeConfig(config: ThemeConfig): void {
  applyThemeConfigToElement(document.documentElement, config)
}

export function applyThemeConfigToElement(el: HTMLElement, config: ThemeConfig): void {
  const resolved = resolveConfig(config)
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) el.style.setProperty(cssVar, resolved[key as keyof ThemeConfig])
  const surfaces = [resolved.bg, surfaceColor(resolved.bg)]
  const backgrounds = [...surfaces, ...surfaces.flatMap((bg) => [mixColor(resolved.accent, bg, .12), mixColor(resolved.accent, bg, .2)])]
  const sidebarBackgrounds = [resolved.sidebar, mixColor(resolved.accent, resolved.sidebar, .12), mixColor(resolved.accent, resolved.sidebar, .2)]
  el.style.setProperty('--color-surface', surfaceColor(resolved.bg))
  el.style.setProperty('--color-selected-muted', readableColor(resolved.muted, backgrounds))
  el.style.setProperty('--color-selected-secondary', readableColor(resolved.fgSecondary, backgrounds))
  el.style.setProperty('--color-accent-text', readableColor(resolved.accent, backgrounds))
  el.style.setProperty('--color-focus', readableColor(resolved.accent, backgrounds, 3))
  el.style.setProperty('--color-canvas-focus', readableColor(resolved.accent, backgrounds, 3))
  el.style.setProperty('--color-sidebar-focus', readableColor(resolved.accent, sidebarBackgrounds, 3))
  for (const [role, color] of [['danger', '#ef4444'], ['success', '#22c55e']] as const) {
    const text = readableColor(color, backgrounds)
    el.style.setProperty('--color-' + role, text)
    el.style.setProperty('--color-canvas-' + role, text)
    el.style.setProperty('--color-' + role + '-fg', readableColor('#ffffff', [text]))
    el.style.setProperty('--color-sidebar-' + role, readableColor(color, sidebarBackgrounds))
  }
  for (const [role, color] of [['foreground', resolved.fg], ['fg-secondary', resolved.fgSecondary], ['fg-muted', resolved.fgMuted], ['muted', resolved.muted], ['accent-text', readableColor(resolved.accent, backgrounds)]] as const) {
    el.style.setProperty('--color-canvas-' + role, color)
  }
  // A dark sidebar can accompany a pastel canvas without forcing one text color onto both.
  for (const [role, color] of [['foreground', resolved.fg], ['fg-secondary', resolved.fgSecondary], ['fg-muted', resolved.fgMuted], ['muted', resolved.muted], ['accent-text', resolved.accent]] as const) {
    el.style.setProperty('--color-sidebar-' + role, readableColor(color, sidebarBackgrounds))
  }
}

export function useThemeApplicator(): void {
  const currentTheme = useSettingsStore(selectCurrentTheme)

  useEffect(() => {
    if (!currentTheme) return

    try {
      const config: ThemeConfig = JSON.parse(currentTheme.config)
      applyThemeConfig(resolveBuiltinConfig(currentTheme.name, currentTheme.is_builtin, config))
    } catch (err) {
      console.error('Failed to parse theme config:', err)
    }
  }, [currentTheme])
}
