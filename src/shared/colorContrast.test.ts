import { describe, expect, it } from 'vitest'
import { contrastRatio, mixColor, readableColor, surfaceColor, repairThemeText } from './colorContrast'
import { BUILTIN_THEMES, resolveBuiltinConfig } from './themeCatalog'

describe('theme and semantic color contrast', () => {
  it('uses linearized sRGB rather than averaging hex brightness', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2)
    expect(mixColor('#ffffff', '#000000', 0.5)).toBe('#808080')
  })
  it('checks text against composited pale and dark fills without changing the stored hue', () => {
    for (const hue of ['#c8bce7', '#b6d9c7', '#efc2a6', '#b7cfec', '#e7b7c8', '#e8d9a6', '#abd7d3', '#cbc8c1', '#22c55e', '#f59e0b']) {
      const backgrounds = ['#f8f9fa', '#f0f1f2'].map((bg) => mixColor(hue, bg, 0.125))
      const text = readableColor(hue, backgrounds)
      expect(Math.min(...backgrounds.map((bg) => contrastRatio(text, bg)))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(readableColor('#ffffff', [hue]), hue)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('offers every legacy family and three soft pairs with readable normal text', () => {
    expect(BUILTIN_THEMES).toHaveLength(18)
    for (const theme of BUILTIN_THEMES) {
      const config = theme.config
      const backgrounds = [config.bg, config.sidebar, surfaceColor(config.bg)]
      for (const key of ['fg', 'fgSecondary', 'fgMuted', 'muted', 'accent'] as const) {
        for (const bg of backgrounds) expect(contrastRatio(config[key], bg), `${theme.name} ${key}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(config.accentFg, config.accent)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('repairs text for a pastel theme adjustment without changing the chosen fills', () => {
    const original = { ...BUILTIN_THEMES[0].config, bg: '#b6d9c7', accent: '#e7b7c8' }
    const repaired = repairThemeText(original)
    expect(repaired.bg).toBe(original.bg)
    expect(repaired.accent).toBe(original.accent)
    expect(repaired.sidebar).toBe(original.sidebar)
    expect(contrastRatio(repaired.fg, repaired.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(repaired.accentFg, repaired.accent)).toBeGreaterThanOrEqual(4.5)
    expect(original.fg).toBe(BUILTIN_THEMES[0].config.fg)
  })
  it('renders an unedited legacy built-in with corrected tokens without mutating it', () => {
    const legacy = { ...BUILTIN_THEMES[0].config, fgMuted: '#666666', muted: '#888888', accent: '#6366f1', accentFg: '#ffffff' }
    const resolved = resolveBuiltinConfig('Standard Dark', 1, legacy)
    expect(contrastRatio(resolved.fgMuted, surfaceColor(resolved.bg))).toBeGreaterThanOrEqual(4.5)
    expect(legacy.fgMuted).toBe('#666666')
    expect(resolved).not.toBe(legacy)
  })
  it('leaves custom and edited built-in configurations intact', () => {
    const config = { ...BUILTIN_THEMES[0].config, bg: '#e7b7c8' }
    expect(resolveBuiltinConfig('Standard Dark', 0, config)).toBe(config)
    expect(resolveBuiltinConfig('Standard Dark', 1, config)).toBe(config)
  })
})
