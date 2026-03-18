import { randomUUID } from 'crypto'

export interface ThemeConfig {
  bg: string
  fg: string
  fgSecondary: string
  fgMuted: string
  muted: string
  accent: string
  accentFg: string
  border: string
}

export interface BuiltInTheme {
  id: string
  name: string
  mode: 'dark' | 'light'
  config: ThemeConfig
}

export const DEFAULT_THEMES: BuiltInTheme[] = [
  {
    id: randomUUID(),
    name: 'Standard Dark',
    mode: 'dark',
    config: {
      bg: '#1a1a2e',
      fg: '#e0e0e0',
      fgSecondary: '#b0b0b0',
      fgMuted: '#666666',
      muted: '#888888',
      accent: '#6366f1',
      accentFg: '#ffffff',
      border: '#2a2a4a'
    }
  },
  {
    id: randomUUID(),
    name: 'Standard Light',
    mode: 'light',
    config: {
      bg: '#f8f9fa',
      fg: '#1a1a2e',
      fgSecondary: '#4a4a6a',
      fgMuted: '#999999',
      muted: '#888888',
      accent: '#6366f1',
      accentFg: '#ffffff',
      border: '#e0e0e8'
    }
  },
  {
    id: randomUUID(),
    name: 'Warm Earth Dark',
    mode: 'dark',
    config: {
      bg: '#1c1410',
      fg: '#e8ddd0',
      fgSecondary: '#b8a898',
      fgMuted: '#7a6a5a',
      muted: '#8a7a6a',
      accent: '#d4915e',
      accentFg: '#1c1410',
      border: '#3a2a1e'
    }
  },
  {
    id: randomUUID(),
    name: 'Warm Earth Light',
    mode: 'light',
    config: {
      bg: '#faf5ef',
      fg: '#3a2a1e',
      fgSecondary: '#6a5a4a',
      fgMuted: '#a09080',
      muted: '#8a7a6a',
      accent: '#c07830',
      accentFg: '#ffffff',
      border: '#e0d5c8'
    }
  },
  {
    id: randomUUID(),
    name: 'Ocean Blue Dark',
    mode: 'dark',
    config: {
      bg: '#0d1b2a',
      fg: '#d0e0f0',
      fgSecondary: '#8ab0d0',
      fgMuted: '#4a6a8a',
      muted: '#5a7a9a',
      accent: '#2196f3',
      accentFg: '#ffffff',
      border: '#1b3a5a'
    }
  },
  {
    id: randomUUID(),
    name: 'Ocean Blue Light',
    mode: 'light',
    config: {
      bg: '#f0f6fc',
      fg: '#0d1b2a',
      fgSecondary: '#2a4a6a',
      fgMuted: '#7a9abc',
      muted: '#5a7a9a',
      accent: '#1976d2',
      accentFg: '#ffffff',
      border: '#c8daf0'
    }
  },
  {
    id: randomUUID(),
    name: 'Amethyst Dark',
    mode: 'dark',
    config: {
      bg: '#1a1024',
      fg: '#e0d0f0',
      fgSecondary: '#b090d0',
      fgMuted: '#6a4a8a',
      muted: '#7a5a9a',
      accent: '#9c27b0',
      accentFg: '#ffffff',
      border: '#2a1a3e'
    }
  },
  {
    id: randomUUID(),
    name: 'Amethyst Light',
    mode: 'light',
    config: {
      bg: '#f8f0fc',
      fg: '#2a1a3e',
      fgSecondary: '#5a3a7a',
      fgMuted: '#9a7aba',
      muted: '#7a5a9a',
      accent: '#8e24aa',
      accentFg: '#ffffff',
      border: '#e0c8f0'
    }
  },
  {
    id: randomUUID(),
    name: 'Forest Dark',
    mode: 'dark',
    config: {
      bg: '#0e1a10',
      fg: '#d0e8d0',
      fgSecondary: '#90b890',
      fgMuted: '#4a7a4a',
      muted: '#5a8a5a',
      accent: '#4caf50',
      accentFg: '#ffffff',
      border: '#1a3a1a'
    }
  },
  {
    id: randomUUID(),
    name: 'Forest Light',
    mode: 'light',
    config: {
      bg: '#f0faf0',
      fg: '#1a3a1a',
      fgSecondary: '#3a6a3a',
      fgMuted: '#7aaa7a',
      muted: '#5a8a5a',
      accent: '#388e3c',
      accentFg: '#ffffff',
      border: '#c0e0c0'
    }
  },
  {
    id: randomUUID(),
    name: 'Rosewood Dark',
    mode: 'dark',
    config: {
      bg: '#1a0e10',
      fg: '#f0d0d8',
      fgSecondary: '#d090a0',
      fgMuted: '#8a4a5a',
      muted: '#9a5a6a',
      accent: '#e91e63',
      accentFg: '#ffffff',
      border: '#3a1a22'
    }
  },
  {
    id: randomUUID(),
    name: 'Rosewood Light',
    mode: 'light',
    config: {
      bg: '#fcf0f2',
      fg: '#3a1a22',
      fgSecondary: '#7a3a4a',
      fgMuted: '#ba7a8a',
      muted: '#9a5a6a',
      accent: '#c2185b',
      accentFg: '#ffffff',
      border: '#f0c8d0'
    }
  }
]

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
