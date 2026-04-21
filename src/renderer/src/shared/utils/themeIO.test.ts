import { describe, it, expect } from 'vitest'
import {
  slugifyThemeName,
  stripModeSuffix,
  serializeThemePair,
  validateThemeJson,
  resolveImportName,
  isThemeConfigEqual,
  errorToMessage,
  type ValidationError
} from './themeIO'
import type { ThemeConfig } from '../../../../shared/types'

const DARK: ThemeConfig = {
  bg: '#1a1a2e',
  fg: '#e0e0e0',
  fgSecondary: '#b0b0b0',
  fgMuted: '#666666',
  muted: '#888888',
  accent: '#6366f1',
  accentFg: '#ffffff',
  border: '#2a2a4a'
}

const LIGHT: ThemeConfig = {
  bg: '#f8f9fa',
  fg: '#1a1a2e',
  fgSecondary: '#4a4a6a',
  fgMuted: '#999999',
  muted: '#888888',
  accent: '#6366f1',
  accentFg: '#ffffff',
  border: '#e0e0e8'
}

describe('slugifyThemeName', () => {
  it('lowercases simple names', () => {
    expect(slugifyThemeName('Twilight')).toBe('twilight')
  })

  it('joins multi-word names with hyphens', () => {
    expect(slugifyThemeName('Warm Earth Dark')).toBe('warm-earth-dark')
  })

  it('falls back to "theme" for punctuation-only input', () => {
    expect(slugifyThemeName('!!! ???')).toBe('theme')
    expect(slugifyThemeName('   ')).toBe('theme')
  })

  it('collapses runs of spaces to a single hyphen', () => {
    expect(slugifyThemeName('Foo   Bar')).toBe('foo-bar')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugifyThemeName(' -Foo- ')).toBe('foo')
  })
})

describe('stripModeSuffix', () => {
  it('removes trailing Dark', () => {
    expect(stripModeSuffix('Twilight Dark')).toBe('Twilight')
  })

  it('removes trailing Light', () => {
    expect(stripModeSuffix('Twilight Light')).toBe('Twilight')
  })

  it('leaves unsuffixed names unchanged', () => {
    expect(stripModeSuffix('Pure')).toBe('Pure')
  })

  it('matches suffix case-insensitively', () => {
    expect(stripModeSuffix('Twilight dark')).toBe('Twilight')
    expect(stripModeSuffix('Twilight LIGHT')).toBe('Twilight')
  })
})

describe('serializeThemePair + validateThemeJson round-trip', () => {
  it('round-trips a pair without losing any colors', () => {
    const raw = serializeThemePair('Twilight', DARK, LIGHT)
    const result = validateThemeJson(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.theme.name).toBe('Twilight')
      expect(result.theme.configs.dark).toEqual(DARK)
      expect(result.theme.configs.light).toEqual(LIGHT)
    }
  })
})

describe('validateThemeJson failure modes', () => {
  it('rejects non-JSON input with parse error', () => {
    const result = validateThemeJson('not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('parse')
  })

  it('rejects valid JSON without $todoozy marker', () => {
    const result = validateThemeJson(JSON.stringify({ name: 'X', configs: { dark: DARK, light: LIGHT } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('marker')
  })

  it('rejects wrong marker value', () => {
    const result = validateThemeJson(JSON.stringify({
      $todoozy: 'not-theme',
      version: 1,
      name: 'X',
      configs: { dark: DARK, light: LIGHT }
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('marker')
  })

  it('rejects future version numbers', () => {
    const result = validateThemeJson(JSON.stringify({
      $todoozy: 'theme',
      version: 2,
      name: 'X',
      configs: { dark: DARK, light: LIGHT }
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('version')
  })

  it('rejects empty or whitespace-only names', () => {
    const result = validateThemeJson(JSON.stringify({
      $todoozy: 'theme',
      version: 1,
      name: '   ',
      configs: { dark: DARK, light: LIGHT }
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('name')
  })

  it('rejects missing dark or light configs', () => {
    const missingDark = validateThemeJson(JSON.stringify({
      $todoozy: 'theme',
      version: 1,
      name: 'X',
      configs: { light: LIGHT }
    }))
    expect(missingDark.ok).toBe(false)
    if (!missingDark.ok) expect(missingDark.error.kind).toBe('modes')

    const missingLight = validateThemeJson(JSON.stringify({
      $todoozy: 'theme',
      version: 1,
      name: 'X',
      configs: { dark: DARK }
    }))
    expect(missingLight.ok).toBe(false)
    if (!missingLight.ok) expect(missingLight.error.kind).toBe('modes')
  })

  it('rejects invalid hex color values', () => {
    const bad: Record<string, string> = { ...DARK, bg: '#xyz' }
    const result = validateThemeJson(JSON.stringify({
      $todoozy: 'theme',
      version: 1,
      name: 'X',
      configs: { dark: bad, light: LIGHT }
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('colors')
  })

  it('rejects configs with missing color keys', () => {
    const incomplete = { bg: '#111111', fg: '#eeeeee' }
    const result = validateThemeJson(JSON.stringify({
      $todoozy: 'theme',
      version: 1,
      name: 'X',
      configs: { dark: incomplete, light: LIGHT }
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('colors')
  })
})

describe('resolveImportName', () => {
  it('returns the proposed name when there is no collision', () => {
    expect(resolveImportName('Twilight', ['Warm Earth', 'Ocean'])).toBe('Twilight')
  })

  it('appends " (Imported)" on a single collision', () => {
    expect(resolveImportName('Twilight', ['Twilight'])).toBe('Twilight (Imported)')
  })

  it('increments to " (Imported 2)" on a second collision', () => {
    expect(resolveImportName('Twilight', ['Twilight', 'Twilight (Imported)'])).toBe('Twilight (Imported 2)')
  })

  it('walks past (Imported 2) and (Imported 3) to find an unused slot', () => {
    const existing = [
      'Twilight',
      'Twilight (Imported)',
      'Twilight (Imported 2)',
      'Twilight (Imported 3)'
    ]
    expect(resolveImportName('Twilight', existing)).toBe('Twilight (Imported 4)')
  })
})

describe('isThemeConfigEqual', () => {
  it('returns true for identical configs', () => {
    expect(isThemeConfigEqual(DARK, DARK)).toBe(true)
    expect(isThemeConfigEqual(DARK, { ...DARK })).toBe(true)
  })

  it('returns false when a single color differs', () => {
    const changed: ThemeConfig = { ...DARK, accent: '#ff0000' }
    expect(isThemeConfigEqual(DARK, changed)).toBe(false)
  })

  it('returns false when all colors differ', () => {
    expect(isThemeConfigEqual(DARK, LIGHT)).toBe(false)
  })

  it('ignores hex case differences', () => {
    const upper: ThemeConfig = {
      bg: DARK.bg.toUpperCase(),
      fg: DARK.fg.toUpperCase(),
      fgSecondary: DARK.fgSecondary.toUpperCase(),
      fgMuted: DARK.fgMuted.toUpperCase(),
      muted: DARK.muted.toUpperCase(),
      accent: DARK.accent.toUpperCase(),
      accentFg: DARK.accentFg.toUpperCase(),
      border: DARK.border.toUpperCase()
    }
    expect(isThemeConfigEqual(DARK, upper)).toBe(true)
  })
})

describe('errorToMessage', () => {
  it('returns a non-empty message for each error kind', () => {
    const kinds: ValidationError['kind'][] = [
      'parse', 'marker', 'version', 'name', 'modes', 'colors', 'read', 'write'
    ]
    for (const kind of kinds) {
      const msg = errorToMessage({ kind })
      expect(typeof msg).toBe('string')
      expect(msg.length).toBeGreaterThan(0)
    }
  })
})
