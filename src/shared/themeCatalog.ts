import type { Theme, ThemeConfig } from './types'

export interface BuiltInThemeDefinition { name: string; mode: 'dark' | 'light'; config: ThemeConfig }

/** One catalog for seeding, live rendering of unedited legacy defaults, and Reset. */
export const BUILTIN_THEMES: BuiltInThemeDefinition[] = [
  {
    "name": "Standard Dark",
    "mode": "dark",
    "config": {
      "bg": "#1a1a2e",
      "fg": "#e0e0e0",
      "fgSecondary": "#b0b0b0",
      "fgMuted": "#8e8e8e",
      "muted": "#8e8e8e",
      "accent": "#7f82f4",
      "accentFg": "#262626",
      "border": "#2a2a4a",
      "sidebar": "#26263a"
    }
  },
  {
    "name": "Standard Light",
    "mode": "light",
    "config": {
      "bg": "#f8f9fa",
      "fg": "#1a1a2e",
      "fgSecondary": "#4a4a6a",
      "fgMuted": "#6e6e6e",
      "muted": "#6e6e6e",
      "accent": "#5b5ede",
      "accentFg": "#ffffff",
      "border": "#e0e0e8",
      "sidebar": "#f0f1f2"
    }
  },
  {
    "name": "Warm Earth Dark",
    "mode": "dark",
    "config": {
      "bg": "#1c1410",
      "fg": "#e8ddd0",
      "fgSecondary": "#b8a898",
      "fgMuted": "#938679",
      "muted": "#958677",
      "accent": "#d4915e",
      "accentFg": "#1c1410",
      "border": "#3a2a1e",
      "sidebar": "#28201c"
    }
  },
  {
    "name": "Warm Earth Light",
    "mode": "light",
    "config": {
      "bg": "#faf5ef",
      "fg": "#3a2a1e",
      "fgSecondary": "#6a5a4a",
      "fgMuted": "#75695d",
      "muted": "#77695b",
      "accent": "#985f26",
      "accentFg": "#ffffff",
      "border": "#e0d5c8",
      "sidebar": "#f2ede7"
    }
  },
  {
    "name": "Ocean Blue Dark",
    "mode": "dark",
    "config": {
      "bg": "#0d1b2a",
      "fg": "#d0e0f0",
      "fgSecondary": "#8ab0d0",
      "fgMuted": "#778fa7",
      "muted": "#748faa",
      "accent": "#2196f3",
      "accentFg": "#2b2b2b",
      "border": "#1b3a5a",
      "sidebar": "#192736"
    }
  },
  {
    "name": "Ocean Blue Light",
    "mode": "light",
    "config": {
      "bg": "#f0f6fc",
      "fg": "#0d1b2a",
      "fgSecondary": "#2a4a6a",
      "fgMuted": "#576d85",
      "muted": "#516e8b",
      "accent": "#176bbf",
      "accentFg": "#ffffff",
      "border": "#c8daf0",
      "sidebar": "#e8eef4"
    }
  },
  {
    "name": "Amethyst Dark",
    "mode": "dark",
    "config": {
      "bg": "#1a1024",
      "fg": "#e0d0f0",
      "fgSecondary": "#b090d0",
      "fgMuted": "#957eac",
      "muted": "#967daf",
      "accent": "#ba68c8",
      "accentFg": "#212121",
      "border": "#2a1a3e",
      "sidebar": "#261c30"
    }
  },
  {
    "name": "Amethyst Light",
    "mode": "light",
    "config": {
      "bg": "#f8f0fc",
      "fg": "#2a1a3e",
      "fgSecondary": "#5a3a7a",
      "fgMuted": "#785f91",
      "muted": "#7a5a9a",
      "accent": "#8e24aa",
      "accentFg": "#ffffff",
      "border": "#e0c8f0",
      "sidebar": "#f0e8f4"
    }
  },
  {
    "name": "Forest Dark",
    "mode": "dark",
    "config": {
      "bg": "#0e1a10",
      "fg": "#d0e8d0",
      "fgSecondary": "#90b890",
      "fgMuted": "#6c936c",
      "muted": "#699569",
      "accent": "#4caf50",
      "accentFg": "#333333",
      "border": "#1a3a1a",
      "sidebar": "#1a261c"
    }
  },
  {
    "name": "Forest Light",
    "mode": "light",
    "config": {
      "bg": "#f0faf0",
      "fg": "#1a3a1a",
      "fgSecondary": "#3a6a3a",
      "fgMuted": "#547554",
      "muted": "#4d774d",
      "accent": "#317c34",
      "accentFg": "#ffffff",
      "border": "#c0e0c0",
      "sidebar": "#e8f2e8"
    }
  },
  {
    "name": "Rosewood Dark",
    "mode": "dark",
    "config": {
      "bg": "#1a0e10",
      "fg": "#f0d0d8",
      "fgSecondary": "#d090a0",
      "fgMuted": "#a87985",
      "muted": "#ab7683",
      "accent": "#ed427c",
      "accentFg": "#1c1c1c",
      "border": "#3a1a22",
      "sidebar": "#261a1c"
    }
  },
  {
    "name": "Rosewood Light",
    "mode": "light",
    "config": {
      "bg": "#fcf0f2",
      "fg": "#3a1a22",
      "fgSecondary": "#7a3a4a",
      "fgMuted": "#8d5d69",
      "muted": "#955767",
      "accent": "#c2185b",
      "accentFg": "#ffffff",
      "border": "#f0c8d0",
      "sidebar": "#f4e8ea"
    }
  },
  {
    "name": "Soft Lavender Dark",
    "mode": "dark",
    "config": {
      "bg": "#202127",
      "sidebar": "#27282f",
      "fg": "#eeedf2",
      "fgSecondary": "#bab9c4",
      "fgMuted": "#a5a4b0",
      "muted": "#a5a4b0",
      "border": "#3b3c46",
      "accent": "#c8bce7",
      "accentFg": "#24242d"
    }
  },
  {
    "name": "Soft Lavender Light",
    "mode": "light",
    "config": {
      "bg": "#f8f7fa",
      "sidebar": "#efedf3",
      "fg": "#2c2b34",
      "fgSecondary": "#585762",
      "fgMuted": "#6d6a75",
      "muted": "#6d6a75",
      "border": "#dcd9e2",
      "accent": "#6e677f",
      "accentFg": "#ffffff"
    }
  },
  {
    "name": "Soft Sage Dark",
    "mode": "dark",
    "config": {
      "bg": "#202127",
      "sidebar": "#27282f",
      "fg": "#eeedf2",
      "fgSecondary": "#bab9c4",
      "fgMuted": "#a5a4b0",
      "muted": "#a5a4b0",
      "border": "#3b3c46",
      "accent": "#b6d9c7",
      "accentFg": "#24242d"
    }
  },
  {
    "name": "Soft Sage Light",
    "mode": "light",
    "config": {
      "bg": "#f8f7fa",
      "sidebar": "#efedf3",
      "fg": "#2c2b34",
      "fgSecondary": "#585762",
      "fgMuted": "#6d6a75",
      "muted": "#6d6a75",
      "border": "#dcd9e2",
      "accent": "#5d6f65",
      "accentFg": "#ffffff"
    }
  },
  {
    "name": "Soft Blush Dark",
    "mode": "dark",
    "config": {
      "bg": "#202127",
      "sidebar": "#27282f",
      "fg": "#eeedf2",
      "fgSecondary": "#bab9c4",
      "fgMuted": "#a5a4b0",
      "muted": "#a5a4b0",
      "border": "#3b3c46",
      "accent": "#e7b7c8",
      "accentFg": "#24242d"
    }
  },
  {
    "name": "Soft Blush Light",
    "mode": "light",
    "config": {
      "bg": "#f8f7fa",
      "sidebar": "#efedf3",
      "fg": "#2c2b34",
      "fgSecondary": "#585762",
      "fgMuted": "#6d6a75",
      "muted": "#6d6a75",
      "border": "#dcd9e2",
      "accent": "#7f656e",
      "accentFg": "#ffffff"
    }
  }
]

const LEGACY_BUILTIN_CONFIGS: Record<string, ThemeConfig> = {
  "Standard Dark": {
    "bg": "#1a1a2e",
    "fg": "#e0e0e0",
    "fgSecondary": "#b0b0b0",
    "fgMuted": "#666666",
    "muted": "#888888",
    "accent": "#6366f1",
    "accentFg": "#ffffff",
    "border": "#2a2a4a",
    "sidebar": "#26263a"
  },
  "Standard Light": {
    "bg": "#f8f9fa",
    "fg": "#1a1a2e",
    "fgSecondary": "#4a4a6a",
    "fgMuted": "#999999",
    "muted": "#888888",
    "accent": "#6366f1",
    "accentFg": "#ffffff",
    "border": "#e0e0e8",
    "sidebar": "#f0f1f2"
  },
  "Warm Earth Dark": {
    "bg": "#1c1410",
    "fg": "#e8ddd0",
    "fgSecondary": "#b8a898",
    "fgMuted": "#7a6a5a",
    "muted": "#8a7a6a",
    "accent": "#d4915e",
    "accentFg": "#1c1410",
    "border": "#3a2a1e",
    "sidebar": "#28201c"
  },
  "Warm Earth Light": {
    "bg": "#faf5ef",
    "fg": "#3a2a1e",
    "fgSecondary": "#6a5a4a",
    "fgMuted": "#a09080",
    "muted": "#8a7a6a",
    "accent": "#c07830",
    "accentFg": "#ffffff",
    "border": "#e0d5c8",
    "sidebar": "#f2ede7"
  },
  "Ocean Blue Dark": {
    "bg": "#0d1b2a",
    "fg": "#d0e0f0",
    "fgSecondary": "#8ab0d0",
    "fgMuted": "#4a6a8a",
    "muted": "#5a7a9a",
    "accent": "#2196f3",
    "accentFg": "#ffffff",
    "border": "#1b3a5a",
    "sidebar": "#192736"
  },
  "Ocean Blue Light": {
    "bg": "#f0f6fc",
    "fg": "#0d1b2a",
    "fgSecondary": "#2a4a6a",
    "fgMuted": "#7a9abc",
    "muted": "#5a7a9a",
    "accent": "#1976d2",
    "accentFg": "#ffffff",
    "border": "#c8daf0",
    "sidebar": "#e8eef4"
  },
  "Amethyst Dark": {
    "bg": "#1a1024",
    "fg": "#e0d0f0",
    "fgSecondary": "#b090d0",
    "fgMuted": "#6a4a8a",
    "muted": "#7a5a9a",
    "accent": "#9c27b0",
    "accentFg": "#ffffff",
    "border": "#2a1a3e",
    "sidebar": "#261c30"
  },
  "Amethyst Light": {
    "bg": "#f8f0fc",
    "fg": "#2a1a3e",
    "fgSecondary": "#5a3a7a",
    "fgMuted": "#9a7aba",
    "muted": "#7a5a9a",
    "accent": "#8e24aa",
    "accentFg": "#ffffff",
    "border": "#e0c8f0",
    "sidebar": "#f0e8f4"
  },
  "Forest Dark": {
    "bg": "#0e1a10",
    "fg": "#d0e8d0",
    "fgSecondary": "#90b890",
    "fgMuted": "#4a7a4a",
    "muted": "#5a8a5a",
    "accent": "#4caf50",
    "accentFg": "#ffffff",
    "border": "#1a3a1a",
    "sidebar": "#1a261c"
  },
  "Forest Light": {
    "bg": "#f0faf0",
    "fg": "#1a3a1a",
    "fgSecondary": "#3a6a3a",
    "fgMuted": "#7aaa7a",
    "muted": "#5a8a5a",
    "accent": "#388e3c",
    "accentFg": "#ffffff",
    "border": "#c0e0c0",
    "sidebar": "#e8f2e8"
  },
  "Rosewood Dark": {
    "bg": "#1a0e10",
    "fg": "#f0d0d8",
    "fgSecondary": "#d090a0",
    "fgMuted": "#8a4a5a",
    "muted": "#9a5a6a",
    "accent": "#e91e63",
    "accentFg": "#ffffff",
    "border": "#3a1a22",
    "sidebar": "#261a1c"
  },
  "Rosewood Light": {
    "bg": "#fcf0f2",
    "fg": "#3a1a22",
    "fgSecondary": "#7a3a4a",
    "fgMuted": "#ba7a8a",
    "muted": "#9a5a6a",
    "accent": "#c2185b",
    "accentFg": "#ffffff",
    "border": "#f0c8d0",
    "sidebar": "#f4e8ea"
  }
}

export const DEFAULT_THEME_CONFIG = BUILTIN_THEMES[0].config
export const BUILTIN_CONFIGS = Object.fromEntries(BUILTIN_THEMES.map((theme) => [theme.name, theme.config]))

export function builtinTheme(name: string, mode: string): BuiltInThemeDefinition | undefined {
  return BUILTIN_THEMES.find((theme) => theme.name === name && theme.mode === mode)
}

/** Local preset identities must be identical on every device. They never become cloud theme rows. */
export function builtinThemeId(name: string): string {
  return `builtin-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

export function presetForTheme(theme: Pick<Theme, 'name' | 'mode'> & { is_builtin?: number }): BuiltInThemeDefinition | undefined {
  return theme.is_builtin || Object.hasOwn(LEGACY_BUILTIN_CONFIGS, theme.name)
    ? builtinTheme(theme.name, theme.mode) : undefined
}

export function canSyncTheme(theme: Pick<Theme, 'name' | 'mode'> & { is_builtin?: number; deleted_at?: string | null }): boolean {
  return !theme.is_builtin && (!presetForTheme(theme) || Boolean(theme.deleted_at))
}

export function resolveBuiltinConfig(name: string, builtin: number, config: ThemeConfig): ThemeConfig {
  const legacy = LEGACY_BUILTIN_CONFIGS[name]
  if (builtin !== 1 || !legacy) return config
  const untouched = (Object.keys(legacy) as Array<keyof ThemeConfig>).every((key) =>
    key === 'sidebar' && !config.sidebar ? true : config[key]?.toLowerCase() === legacy[key].toLowerCase())
  return untouched ? { ...BUILTIN_CONFIGS[name] } : config
}
