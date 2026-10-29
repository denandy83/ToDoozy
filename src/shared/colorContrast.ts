/** WCAG relative luminance and contrast, using the actual composited sRGB colors. */
import type { ThemeConfig } from './types'
export function isHexColor(color: string): boolean { return /^#[\da-f]{6}$/i.test(color) }

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

export function mixColor(foreground: string, background: string, opacity: number): string {
  const bg = channels(background)
  return '#' + channels(foreground).map((v, i) => Math.round(v * opacity + bg[i] * (1 - opacity)).toString(16).padStart(2, '0')).join('')
}

export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (high + 0.05) / (low + 0.05)
}

/** Preserve hue as far as possible; adjust the foreground, never stored user colors. */
export function readableColor(color: string, backgrounds: string[], target = 4.5): string {
  if (!isHexColor(color) || !backgrounds.length || backgrounds.some((bg) => !isHexColor(bg))) return color
  if (backgrounds.every((bg) => contrastRatio(color, bg) >= target)) return color
  const endpoints = ['#000000', '#ffffff'].sort((a, b) =>
    Math.min(...backgrounds.map((bg) => contrastRatio(b, bg))) - Math.min(...backgrounds.map((bg) => contrastRatio(a, bg))))
  for (let step = 1; step <= 100; step++) {
    for (const endpoint of endpoints) {
      const candidate = mixColor(endpoint, color, step / 100)
      if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= target)) return candidate
    }
  }
  return endpoints[0]
}

export function surfaceColor(bg: string): string {
  const values = channels(bg)
  const amount = values.reduce((a, b) => a + b, 0) < 384 ? 12 : -8
  return '#' + values.map((v) => Math.max(0, Math.min(255, v + amount)).toString(16).padStart(2, '0')).join('')
}

/** Explicit editor action: keep chosen fills and repair the text roles used on them. */
export function repairThemeText(config: ThemeConfig): ThemeConfig {
  if (!Object.values(config).every(isHexColor)) return config
  const next = { ...config }
  const backgrounds = [config.bg, surfaceColor(config.bg)]
  for (const key of ['fg', 'fgSecondary', 'fgMuted', 'muted'] as const) next[key] = readableColor(config[key], backgrounds)
  next.accentFg = readableColor(config.accentFg, [config.accent])
  return next
}
