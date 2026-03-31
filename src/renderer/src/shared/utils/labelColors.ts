import type { Label } from '../../../../shared/types'

export const LABEL_COLORS = [
  '#888888', '#ef4444', '#f59e0b', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'
]

/** Pick the color from LABEL_COLORS with the fewest existing labels using it. */
export function leastUsedLabelColor(existingLabels: Label[]): string {
  const counts = new Map<string, number>()
  for (const c of LABEL_COLORS) counts.set(c, 0)
  for (const label of existingLabels) {
    const lower = label.color.toLowerCase()
    if (counts.has(lower)) {
      counts.set(lower, counts.get(lower)! + 1)
    }
  }
  let best = LABEL_COLORS[0]
  let bestCount = Infinity
  for (const [color, count] of counts) {
    if (count < bestCount) {
      best = color
      bestCount = count
      if (count === 0) break
    }
  }
  return best
}
