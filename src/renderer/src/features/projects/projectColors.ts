export const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'
]

/** First color not used by any existing project; falls back to cycling by count. */
export function pickNextProjectColor(existingColors: string[]): string {
  const used = new Set(existingColors.map((c) => c.toLowerCase()))
  const unused = PROJECT_COLORS.find((c) => !used.has(c.toLowerCase()))
  if (unused) return unused
  return PROJECT_COLORS[existingColors.length % PROJECT_COLORS.length]
}
