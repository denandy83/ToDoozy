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
  const resolved = resolveConfig(config)
  const root = document.documentElement
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    root.style.setProperty(cssVar, resolved[key as keyof ThemeConfig])
  }
  // Derive surface color (slightly lighter for dark themes, slightly darker for light)
  const bgBrightness =
    parseInt(resolved.bg.replace('#', '').slice(0, 2), 16) +
    parseInt(resolved.bg.replace('#', '').slice(2, 4), 16) +
    parseInt(resolved.bg.replace('#', '').slice(4, 6), 16)
  const isDark = bgBrightness < 384
  root.style.setProperty('--color-surface', adjustColor(resolved.bg, isDark ? 12 : -8))
}

export function applyThemeConfigToElement(el: HTMLElement, config: ThemeConfig): void {
  const resolved = resolveConfig(config)
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    el.style.setProperty(cssVar, resolved[key as keyof ThemeConfig])
  }
  const bgBrightness =
    parseInt(resolved.bg.replace('#', '').slice(0, 2), 16) +
    parseInt(resolved.bg.replace('#', '').slice(2, 4), 16) +
    parseInt(resolved.bg.replace('#', '').slice(4, 6), 16)
  const isDark = bgBrightness < 384
  el.style.setProperty('--color-surface', adjustColor(resolved.bg, isDark ? 12 : -8))
}

export function useThemeApplicator(): void {
  const currentTheme = useSettingsStore(selectCurrentTheme)

  useEffect(() => {
    if (!currentTheme) return

    try {
      const config: ThemeConfig = JSON.parse(currentTheme.config)
      applyThemeConfig(config)
    } catch (err) {
      console.error('Failed to parse theme config:', err)
    }
  }, [currentTheme])
}
