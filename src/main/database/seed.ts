import { BUILTIN_THEMES, builtinThemeId } from '../../shared/themeCatalog'
export type { ThemeConfig } from '../../shared/types'

// The first twelve names belong to migration 1; later presets are added explicitly.
export const DEFAULT_THEMES = BUILTIN_THEMES.slice(0, 12).map((theme) => ({ ...theme, id: builtinThemeId(theme.name) }))

export const DEFAULT_SETTINGS: Array<{ key: string; value: string }> = [
  { key: 'theme_id', value: DEFAULT_THEMES[0].id },
  { key: 'theme_mode', value: 'dark' },
  { key: 'sidebar_pinned', value: 'true' },
  { key: 'sidebar_width', value: '240' },
  { key: 'detail_panel_position', value: 'side' },
  { key: 'detail_panel_width', value: '400' },
  { key: 'view_mode', value: 'list' },
  { key: 'priority_color_bar', value: 'true' },
  { key: 'priority_badges', value: 'false' },
  { key: 'priority_background_tint', value: 'false' },
  { key: 'priority_font_weight', value: 'false' },
  { key: 'priority_auto_sort', value: 'false' }
]
