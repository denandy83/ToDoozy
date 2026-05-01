import type { ThemeConfig } from '../../../../shared/types'

export const THEME_FILE_MARKER = 'theme'
export const THEME_FILE_VERSION = 1

export interface ExportedTheme {
  $todoozy: 'theme'
  version: 1
  name: string
  configs: {
    dark: ThemeConfig
    light: ThemeConfig
  }
}

export type ValidationError =
  | { kind: 'parse' }
  | { kind: 'marker' }
  | { kind: 'version' }
  | { kind: 'name' }
  | { kind: 'modes' }
  | { kind: 'colors' }
  | { kind: 'read' }
  | { kind: 'write' }

export type ValidationResult =
  | { ok: true; theme: ExportedTheme }
  | { ok: false; error: ValidationError }

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const CONFIG_KEYS: (keyof ThemeConfig)[] = [
  'bg',
  'fg',
  'fgSecondary',
  'fgMuted',
  'muted',
  'accent',
  'accentFg',
  'border',
  'sidebar'
]

function deriveSidebarFromBg(bg: string): string {
  const num = parseInt(bg.replace('#', ''), 16)
  const brightness = ((num >> 16) & 0xff) + ((num >> 8) & 0xff) + (num & 0xff)
  const amount = brightness < 384 ? 12 : -8
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function slugifyThemeName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'theme'
}

export function stripModeSuffix(name: string): string {
  return name.replace(/\s+(Dark|Light)$/i, '').trim() || name
}

export function isThemeConfigEqual(a: ThemeConfig, b: ThemeConfig): boolean {
  for (const key of CONFIG_KEYS) {
    if (a[key].toLowerCase() !== b[key].toLowerCase()) return false
  }
  return true
}

export function serializeThemePair(
  baseName: string,
  darkConfig: ThemeConfig,
  lightConfig: ThemeConfig
): string {
  const payload: ExportedTheme = {
    $todoozy: 'theme',
    version: 1,
    name: baseName,
    configs: { dark: darkConfig, light: lightConfig }
  }
  return JSON.stringify(payload, null, 2)
}

const REQUIRED_CONFIG_KEYS: (keyof ThemeConfig)[] = [
  'bg', 'fg', 'fgSecondary', 'fgMuted', 'muted', 'accent', 'accentFg', 'border'
]

function isValidConfig(value: unknown): value is ThemeConfig {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  for (const key of REQUIRED_CONFIG_KEYS) {
    const v = obj[key]
    if (typeof v !== 'string' || !HEX_RE.test(v)) return false
  }
  // sidebar is optional for backwards compat with pre-1.5.6 exports
  if ('sidebar' in obj) {
    if (typeof obj.sidebar !== 'string' || !HEX_RE.test(obj.sidebar)) return false
  }
  return true
}

function pickConfig(value: unknown): ThemeConfig {
  const obj = value as Record<string, string>
  return {
    bg: obj.bg,
    fg: obj.fg,
    fgSecondary: obj.fgSecondary,
    fgMuted: obj.fgMuted,
    muted: obj.muted,
    accent: obj.accent,
    accentFg: obj.accentFg,
    border: obj.border,
    sidebar: (typeof obj.sidebar === 'string' && HEX_RE.test(obj.sidebar))
      ? obj.sidebar
      : deriveSidebarFromBg(obj.bg)
  }
}

export function validateThemeJson(raw: string): ValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: { kind: 'parse' } }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: { kind: 'marker' } }
  const obj = parsed as Record<string, unknown>
  if (obj.$todoozy !== THEME_FILE_MARKER) return { ok: false, error: { kind: 'marker' } }
  if (typeof obj.version !== 'number' || obj.version > THEME_FILE_VERSION) {
    return { ok: false, error: { kind: 'version' } }
  }
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (!name) return { ok: false, error: { kind: 'name' } }
  const configs = obj.configs as Record<string, unknown> | undefined
  if (!configs || typeof configs !== 'object') return { ok: false, error: { kind: 'modes' } }
  if (!configs.dark || !configs.light) return { ok: false, error: { kind: 'modes' } }
  if (!isValidConfig(configs.dark) || !isValidConfig(configs.light)) {
    return { ok: false, error: { kind: 'colors' } }
  }
  return {
    ok: true,
    theme: {
      $todoozy: 'theme',
      version: 1,
      name,
      configs: { dark: pickConfig(configs.dark), light: pickConfig(configs.light) }
    }
  }
}

export function resolveImportName(
  proposed: string,
  existingNames: readonly string[]
): string {
  if (!existingNames.includes(proposed)) return proposed
  const imported = `${proposed} (Imported)`
  if (!existingNames.includes(imported)) return imported
  let n = 2
  while (existingNames.includes(`${proposed} (Imported ${n})`)) n++
  return `${proposed} (Imported ${n})`
}

export function errorToMessage(error: ValidationError): string {
  switch (error.kind) {
    case 'parse':
      return 'File is not valid JSON'
    case 'marker':
      return 'Not a ToDoozy theme file'
    case 'version':
      return 'This theme file was made by a newer version of ToDoozy'
    case 'name':
      return 'Theme file is missing a name'
    case 'modes':
      return 'Theme file is missing dark or light configuration'
    case 'colors':
      return 'Theme file has invalid or missing colors'
    case 'read':
      return 'Could not read file'
    case 'write':
      return 'Failed to save imported theme'
  }
}
