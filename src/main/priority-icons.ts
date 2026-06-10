import { nativeImage } from 'electron'

/**
 * Pre-rendered 32×32 RGBA solid-circle PNGs (one per priority level), embedded as
 * base64 so the tray menu has zero filesystem / npm dependencies. Rendered at
 * scaleFactor 2.0 → 16×16 logical points, the standard macOS menu icon size.
 *
 * Colors mirror the renderer priority palette (PriorityIndicator.tsx):
 *   1 = #22c55e (green, Low) · 2 = #3b82f6 (blue, Normal)
 *   3 = #f59e0b (amber, High) · 4 = #ef4444 (red, Urgent)
 * Priority 0 (None) has no dot.
 *
 * Regenerate with the circle-PNG generator described in story #79 (zlib + manual
 * PNG encoding) if the palette ever changes.
 */
const PRIORITY_DOT_B64: Record<number, string> = {
  1: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAqklEQVR42u2XvQ0AIQhGncVJGMEJXMkRmMY5GMVrtDE5D08RCotXmfi9+AvO5+g0cVdgcQKoHBMIPkf0OZLPsXRQHQsSAvAS+gZxV4YTniaCe9KqAC6EN/CvQNoQ/rkSoz0vm4EZARIQIK5AEAhvBI4ACgogR4AEBYgjUIQZCsABATAtoL4FJg6h+jVUf4jUn2ITn5H6d2yiIDFRkpkoSk2U5WYak9sbbucBv6njB1RU7PEAAAAASUVORK5CYII=',
  2: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAqUlEQVR42u2XvQ0AIQhG3cuGEZzJBRyB0djC1mu0MTkPTxEKi1eZ+L34C87H7DRxV2BxAqgcEwg+ZvQxk4+5dFAdCxIC8BL6BnFXhhOeJoJ70qoALoQ38K9A2hD+uRKjPS+bgRkBEhAgrkAQCG8EjgAKCiBHgAQFiCNQhBkKwAEBMC2gvgUmDqH6NVR/iNSfYhOfkfp3bKIgMVGSmShKTZTlZhqT2xtu5wHvfpslbCL3XQAAAABJRU5ErkJggg==',
  3: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAqElEQVR42u2XvQ0AIQhG7V2KEdzMDWQ0prD2Gm1MzsNThMLiVSZ+L/6Cy8k7TdwVWJwAKscEQk4ec/KUky8dVMeChAC8hL5B3JXhhMeJ4J64KoAL4Q38KxA3hH+uxGjPy2ZgRoAEBIgrEATCG4EjgIICyBEgQQHiCBRhhgJwQABMC6hvgYlDqH4N1R8i9afYxGek/h2bKEhMlGQmilITZbmZxuT2htt5APItRyX40b6WAAAAAElFTkSuQmCC',
  4: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAp0lEQVR42u2XvQ0AIQhGHY2CAdzMERiNERzBa7Qx8Q5PEQqLV5n4vfgLISMGS8IVWJwAKscEYkakjMgZsXRwHYsaAjAIHcHSlZGEp4ngnrQqQAvhDforkDaEf67E256XzcCMACsIsFQgKoQ3okSAFAVIIsCKAiwRKMq8CsABAXAtYL4FLg6h+TU0f4jMn2IXn5H5d+yiIHFRkrkoSl2U5W4ak9sbbucBnmirFgAcoOAAAAAASUVORK5CYII='
}

const iconCache: Record<number, Electron.NativeImage> = {}

/**
 * Returns a colored dot NativeImage for the given priority (1–4), or `undefined`
 * for priority 0 / unknown values so the caller can render no icon at all.
 *
 * Icons are NOT template images — that would strip their color in the macOS menu.
 */
export function getPriorityDotIcon(priority: number): Electron.NativeImage | undefined {
  const b64 = PRIORITY_DOT_B64[priority]
  if (!b64) return undefined
  if (!iconCache[priority]) {
    iconCache[priority] = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'), {
      scaleFactor: 2.0
    })
  }
  return iconCache[priority]
}
