export const VIVID_SWATCHES = [
  ['Slate', '#888888'], ['Indigo', '#6366f1'], ['Violet', '#8b5cf6'], ['Pink', '#ec4899'],
  ['Red', '#ef4444'], ['Amber', '#f59e0b'], ['Green', '#22c55e'], ['Cyan', '#06b6d4'],
  ['Blue', '#3b82f6'], ['Teal', '#14b8a6'], ['Orange', '#f97316'], ['Lime', '#84cc16'], ['Rose', '#e11d48']
] as const
export const PASTEL_SWATCHES = [
  ['Lavender', '#c8bce7'], ['Sage', '#b6d9c7'], ['Peach', '#efc2a6'], ['Powder blue', '#b7cfec'],
  ['Blush', '#e7b7c8'], ['Butter', '#e8d9a6'], ['Aqua', '#abd7d3'], ['Stone', '#cbc8c1']
] as const
export const PASTEL_COLORS = PASTEL_SWATCHES.map(([, color]) => color)
