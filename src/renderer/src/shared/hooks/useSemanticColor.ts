import { useMemo } from 'react'
import { useSettingsStore, selectCurrentTheme } from '../stores/settingsStore'
import { DEFAULT_THEME_CONFIG, resolveBuiltinConfig } from '../../../../shared/themeCatalog'
import { isHexColor, mixColor, readableColor, surfaceColor } from '../../../../shared/colorContrast'
import type { ThemeConfig } from '../../../../shared/types'

export function useSemanticColor(color: string): { text: string; indicator: string; onFill: string } {
  const theme = useSettingsStore(selectCurrentTheme)
  return useMemo(() => {
    let config: ThemeConfig = DEFAULT_THEME_CONFIG
    try { if (theme) config = resolveBuiltinConfig(theme.name, theme.is_builtin, JSON.parse(theme.config)) } catch { /* Use the default for malformed imports. */ }
    const bg = isHexColor(config.bg) ? config.bg : DEFAULT_THEME_CONFIG.bg
    const backgrounds = [bg, surfaceColor(bg)]
    if (isHexColor(config.accent ?? '')) backgrounds.push(mixColor(config.accent, bg, 0.12), mixColor(config.accent, bg, 0.2))
    return {
      text: readableColor(color, backgrounds.map((background) => mixColor(color, background, 0.125))),
      indicator: readableColor(color, backgrounds, 3),
      onFill: readableColor('#ffffff', [color])
    }
  }, [color, theme])
}
