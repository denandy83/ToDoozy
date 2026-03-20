import { describe, it, expect } from 'vitest'

// adjustColor is not exported, so we test it indirectly via a re-implementation
// or we can test the exported functions that use it.
// Since applyThemeConfig/applyThemeConfigToElement need a DOM, let's extract adjustColor for testing.
// For now, test the color adjustment logic directly by importing the module.

// adjustColor is private, so we test the brightness detection and surface color derivation
// through applyThemeConfigToElement by checking the CSS variable it sets.

// We'll create a minimal HTMLElement mock.

function createMockElement(): HTMLElement {
  const styles: Record<string, string> = {}
  return {
    style: {
      setProperty(name: string, value: string) {
        styles[name] = value
      },
      getPropertyValue(name: string) {
        return styles[name] || ''
      }
    },
    _styles: styles
  } as unknown as HTMLElement & { _styles: Record<string, string> }
}

// We need to import applyThemeConfigToElement
import { applyThemeConfigToElement } from './useThemeApplicator'
import type { ThemeConfig } from '../../../../shared/types'

describe('applyThemeConfigToElement', () => {
  it('sets all CSS variables from theme config', () => {
    const el = createMockElement() as HTMLElement & { _styles: Record<string, string> }
    const config: ThemeConfig = {
      bg: '#1a1a2e',
      fg: '#eaeaea',
      fgSecondary: '#b0b0b0',
      fgMuted: '#666666',
      muted: '#333333',
      accent: '#e94560',
      accentFg: '#ffffff',
      border: '#2a2a4a'
    }

    applyThemeConfigToElement(el, config)

    expect(el._styles['--color-background']).toBe('#1a1a2e')
    expect(el._styles['--color-foreground']).toBe('#eaeaea')
    expect(el._styles['--color-fg-secondary']).toBe('#b0b0b0')
    expect(el._styles['--color-fg-muted']).toBe('#666666')
    expect(el._styles['--color-muted']).toBe('#333333')
    expect(el._styles['--color-accent']).toBe('#e94560')
    expect(el._styles['--color-accent-fg']).toBe('#ffffff')
    expect(el._styles['--color-border']).toBe('#2a2a4a')
  })

  it('derives lighter surface color for dark themes', () => {
    const el = createMockElement() as HTMLElement & { _styles: Record<string, string> }
    const darkConfig: ThemeConfig = {
      bg: '#000000',
      fg: '#ffffff',
      fgSecondary: '#cccccc',
      fgMuted: '#888888',
      muted: '#444444',
      accent: '#ff0000',
      accentFg: '#ffffff',
      border: '#333333'
    }

    applyThemeConfigToElement(el, darkConfig)

    // For #000000 (brightness = 0), adjustColor adds 12: each channel becomes 12
    expect(el._styles['--color-surface']).toBe('#0c0c0c')
  })

  it('derives darker surface color for light themes', () => {
    const el = createMockElement() as HTMLElement & { _styles: Record<string, string> }
    const lightConfig: ThemeConfig = {
      bg: '#ffffff',
      fg: '#000000',
      fgSecondary: '#333333',
      fgMuted: '#666666',
      muted: '#cccccc',
      accent: '#0000ff',
      accentFg: '#ffffff',
      border: '#dddddd'
    }

    applyThemeConfigToElement(el, lightConfig)

    // For #ffffff (brightness = 765), adjustColor subtracts 8: each channel becomes 247 = 0xf7
    expect(el._styles['--color-surface']).toBe('#f7f7f7')
  })

  it('correctly classifies mid-range backgrounds', () => {
    const el = createMockElement() as HTMLElement & { _styles: Record<string, string> }
    // #808080 = 128+128+128 = 384 which is NOT < 384, so it's light
    const midConfig: ThemeConfig = {
      bg: '#808080',
      fg: '#000000',
      fgSecondary: '#333333',
      fgMuted: '#666666',
      muted: '#aaaaaa',
      accent: '#ff0000',
      accentFg: '#ffffff',
      border: '#999999'
    }

    applyThemeConfigToElement(el, midConfig)

    // 128+128+128 = 384, NOT < 384, so isDark = false, amount = -8
    // 128 - 8 = 120 = 0x78
    expect(el._styles['--color-surface']).toBe('#787878')
  })

  it('handles dark theme just below threshold', () => {
    const el = createMockElement() as HTMLElement & { _styles: Record<string, string> }
    // #7f7f7f = 127+127+127 = 381 < 384, so isDark = true, amount = +12
    const config: ThemeConfig = {
      bg: '#7f7f7f',
      fg: '#ffffff',
      fgSecondary: '#cccccc',
      fgMuted: '#999999',
      muted: '#555555',
      accent: '#00ff00',
      accentFg: '#000000',
      border: '#666666'
    }

    applyThemeConfigToElement(el, config)

    // 127 + 12 = 139 = 0x8b
    expect(el._styles['--color-surface']).toBe('#8b8b8b')
  })
})
