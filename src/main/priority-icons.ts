import { nativeImage } from 'electron'
import { deflateSync } from 'zlib'

/**
 * Priority indicators for the My Day tray menu, rendered as small colored
 * "decimal points" rather than full dots so they read as a subtle accent next
 * to the task title instead of a heavy filled circle.
 *
 * Icons are generated at runtime (zlib + a tiny manual PNG encoder) so the dot
 * size, position, and palette live in one tunable place — no opaque embedded
 * base64. Still zero filesystem / npm dependencies: `zlib` and `Buffer` are Node
 * builtins available in the Electron main process.
 *
 * Canvas is 32×32 device px at scaleFactor 2.0 → 16×16 logical points (the
 * standard macOS menu icon slot). The dot itself is small and sits slightly
 * below center to evoke a decimal point resting on the text baseline.
 *
 * Palette mirrors the renderer (PriorityIndicator.tsx):
 *   1 = #22c55e (green, Low) · 2 = #3b82f6 (blue, Normal)
 *   3 = #f59e0b (amber, High) · 4 = #ef4444 (red, Urgent)
 *
 * Priority 0 (None) renders a fully transparent placeholder of the same size —
 * an "invisible decimal point" — so every menu row keeps its icon slot and the
 * titles stay vertically aligned regardless of priority.
 */
const PRIORITY_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#ef4444'
}

const CANVAS = 32 // device px (16 logical pt @ scaleFactor 2.0)
const DOT_RADIUS = 5 // device px → ~2.5 logical pt, a small decimal-point sized dot
const DOT_CX = CANVAS / 2 // horizontally centered in the icon slot
const DOT_CY = CANVAS * 0.6 // slightly below center, decimal-point feel

const iconCache: Record<number, Electron.NativeImage> = {}

// --- Minimal RGBA → PNG encoder (no deps) ----------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // color type 6 = RGBA
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace

  // Prefix each scanline with a filter-type byte (0 = None).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * Rasterizes a small filled circle (the decimal point) in `hex` onto a
 * transparent canvas, with 1px-feather anti-aliasing. An empty `hex` yields a
 * fully transparent canvas (the invisible placeholder).
 */
function renderDotPng(hex: string): Buffer {
  const rgba = Buffer.alloc(CANVAS * CANVAS * 4) // zero-filled = transparent
  if (hex) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    for (let y = 0; y < CANVAS; y++) {
      for (let x = 0; x < CANVAS; x++) {
        const dx = x + 0.5 - DOT_CX
        const dy = y + 0.5 - DOT_CY
        const dist = Math.sqrt(dx * dx + dy * dy)
        let coverage = DOT_RADIUS + 0.5 - dist
        if (coverage <= 0) continue
        if (coverage > 1) coverage = 1
        const i = (y * CANVAS + x) * 4
        rgba[i] = r
        rgba[i + 1] = g
        rgba[i + 2] = b
        rgba[i + 3] = Math.round(coverage * 255)
      }
    }
  }
  return encodePng(CANVAS, CANVAS, rgba)
}

/**
 * Returns a colored decimal-point NativeImage for priorities 1–4, or a fully
 * transparent placeholder for priority 0 (None) so menu rows stay aligned.
 * Returns `undefined` only for genuinely out-of-range values.
 *
 * Icons are NOT template images — that would strip their color in the macOS menu.
 */
export function getPriorityDotIcon(priority: number): Electron.NativeImage | undefined {
  if (priority !== 0 && !PRIORITY_COLORS[priority]) return undefined
  if (!iconCache[priority]) {
    const png = renderDotPng(PRIORITY_COLORS[priority] ?? '')
    iconCache[priority] = nativeImage.createFromBuffer(png, { scaleFactor: 2.0 })
  }
  return iconCache[priority]
}
