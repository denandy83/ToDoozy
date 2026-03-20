import type { Label, Project } from '../../../../shared/types'

export const LABEL_AUTO_COLORS = [
  '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#6366f1', '#e11d48'
] as const

export interface PriorityOption {
  value: number
  label: string
  color: string
}

export const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: 0, label: 'None', color: '#888888' },
  { value: 1, label: 'Low', color: '#22c55e' },
  { value: 2, label: 'Normal', color: '#3b82f6' },
  { value: 3, label: 'High', color: '#f59e0b' },
  { value: 4, label: 'Urgent', color: '#ef4444' }
]

const PRIORITY_ALIASES: Record<string, number> = {
  none: 0, low: 1, normal: 2, medium: 2, high: 3, urgent: 4
}

export interface DateOption {
  label: string
  date: string // ISO YYYY-MM-DD
  formatted: string // dd/mm/yyyy
}

export type OperatorType = '@' | 'p:' | 'd:' | '/'

export interface ActiveOperator {
  type: OperatorType
  query: string
  startIndex: number
  endIndex: number
}

/**
 * Detect the active operator at the cursor position in the input text.
 */
export function detectOperator(
  text: string,
  cursorPos: number,
  suppressedPositions: Set<number>
): ActiveOperator | null {
  // Scan backwards from cursor to find the most recent operator
  const textUpToCursor = text.slice(0, cursorPos)

  // Find @ operator
  for (let i = textUpToCursor.length - 1; i >= 0; i--) {
    if (textUpToCursor[i] === ' ' || textUpToCursor[i] === '\t') {
      // Hit a space before finding an operator — check for p: and d: after this space
      break
    }
    if (textUpToCursor[i] === '@') {
      if (i === 0 || textUpToCursor[i - 1] === ' ') {
        if (suppressedPositions.has(i)) return null
        return {
          type: '@',
          query: textUpToCursor.slice(i + 1),
          startIndex: i,
          endIndex: cursorPos
        }
      }
    }
    if (textUpToCursor[i] === '/') {
      if (i === 0 || textUpToCursor[i - 1] === ' ') {
        if (suppressedPositions.has(i)) return null
        return {
          type: '/',
          query: textUpToCursor.slice(i + 1),
          startIndex: i,
          endIndex: cursorPos
        }
      }
    }
  }

  // Find p: and d: operators — search for the pattern
  const patterns: Array<{ prefix: string; type: OperatorType }> = [
    { prefix: 'p:', type: 'p:' },
    { prefix: 'd:', type: 'd:' }
  ]

  for (const { prefix, type } of patterns) {
    // Find last occurrence of this prefix
    let searchFrom = textUpToCursor.length
    while (searchFrom > 0) {
      const idx = textUpToCursor.lastIndexOf(prefix, searchFrom - 1)
      if (idx === -1) break
      searchFrom = idx

      // Must be at start of input or preceded by space
      if (idx > 0 && textUpToCursor[idx - 1] !== ' ') continue

      // Check if cursor is within this operator's span (no space after the operator value)
      const afterOp = textUpToCursor.slice(idx + prefix.length)
      if (afterOp.includes(' ')) continue // space found — operator ended

      if (suppressedPositions.has(idx)) continue

      return {
        type,
        query: afterOp,
        startIndex: idx,
        endIndex: cursorPos
      }
    }
  }

  // Re-check @ without the early-break optimization (handles mid-word @)
  for (let i = textUpToCursor.length - 1; i >= 0; i--) {
    if (textUpToCursor[i] === '@') {
      if (i === 0 || textUpToCursor[i - 1] === ' ') {
        // Check if there's a space between @ and cursor
        const afterAt = textUpToCursor.slice(i + 1)
        if (afterAt.includes(' ')) continue
        if (suppressedPositions.has(i)) continue
        return {
          type: '@',
          query: afterAt,
          startIndex: i,
          endIndex: cursorPos
        }
      }
    }
  }

  return null
}

/**
 * Filter labels by substring match.
 */
export function filterLabels(labels: Label[], query: string): Label[] {
  if (!query) return labels.slice(0, 5)
  const q = query.toLowerCase()
  return labels.filter((l) => l.name.toLowerCase().includes(q)).slice(0, 5)
}

/**
 * Filter priorities by prefix match.
 */
export function filterPriorities(query: string): PriorityOption[] {
  if (!query) return PRIORITY_OPTIONS
  const q = query.toLowerCase()
  const results: PriorityOption[] = []
  const seen = new Set<number>()

  // Check names and aliases
  for (const [name, value] of Object.entries(PRIORITY_ALIASES)) {
    if (name.startsWith(q) && !seen.has(value)) {
      const opt = PRIORITY_OPTIONS.find((p) => p.value === value)
      if (opt) {
        results.push(opt)
        seen.add(value)
      }
    }
  }
  return results.slice(0, 5)
}

/**
 * Generate date options filtered by prefix match.
 */
export function filterDates(query: string, dateFormat?: string): DateOption[] {
  const fmt = dateFormat ?? 'dd/mm/yyyy'
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const presets: Array<{ name: string; getDate: () => Date }> = [
    { name: 'today', getDate: () => today },
    {
      name: 'tomorrow',
      getDate: () => {
        const d = new Date(today)
        d.setDate(d.getDate() + 1)
        return d
      }
    },
    ...(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map(
      (day, i) => ({
        name: day,
        getDate: (): Date => {
          const targetDay = (i + 1) % 7 // Mon=1 ... Sun=0
          const d = new Date(today)
          const diff = (targetDay - d.getDay() + 7) % 7
          d.setDate(d.getDate() + (diff === 0 ? 0 : diff))
          return d
        }
      })
    )
  ]

  const q = query.toLowerCase()

  // Check for explicit date pattern based on format setting
  const results: DateOption[] = []
  const parts = query.replace(/-/g, '/').split('/')

  let parsedDate: Date | null = null
  if (fmt === 'dd/mm/yyyy' && parts.length === 3 && parts[2].length === 4) {
    const day = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)
    const d = new Date(year, month - 1, day)
    if (d.getDate() === day && d.getMonth() === month - 1 && d.getFullYear() === year) parsedDate = d
  } else if (fmt === 'mm/dd/yyyy' && parts.length === 3 && parts[2].length === 4) {
    const month = parseInt(parts[0], 10)
    const day = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)
    const d = new Date(year, month - 1, day)
    if (d.getDate() === day && d.getMonth() === month - 1 && d.getFullYear() === year) parsedDate = d
  } else if (fmt === 'yyyy/mm/dd' && parts.length === 3 && parts[0].length === 4) {
    const year = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    const day = parseInt(parts[2], 10)
    const d = new Date(year, month - 1, day)
    if (d.getDate() === day && d.getMonth() === month - 1 && d.getFullYear() === year) parsedDate = d
  }

  if (parsedDate) {
    results.push({
      label: formatDateDisplay(parsedDate),
      date: formatIso(parsedDate),
      formatted: formatUserDate(parsedDate, fmt)
    })
  }

  // Filter presets by prefix
  if (!q) {
    for (const preset of presets.slice(0, 5)) {
      const d = preset.getDate()
      results.push({
        label: preset.name.charAt(0).toUpperCase() + preset.name.slice(1),
        date: formatIso(d),
        formatted: formatUserDate(d, fmt)
      })
    }
  } else {
    for (const preset of presets) {
      if (preset.name.startsWith(q)) {
        const d = preset.getDate()
        results.push({
          label: preset.name.charAt(0).toUpperCase() + preset.name.slice(1),
          date: formatIso(d),
          formatted: formatUserDate(d, fmt)
        })
      }
    }
  }

  return results.slice(0, 5)
}

/**
 * Get the next auto-assign color for a new label.
 */
export function getNextAutoColor(existingLabels: Label[]): string {
  const usedColors = new Set(existingLabels.map((l) => l.color.toLowerCase()))
  for (const color of LABEL_AUTO_COLORS) {
    if (!usedColors.has(color.toLowerCase())) return color
  }
  // All used — cycle from start
  const idx = existingLabels.length % LABEL_AUTO_COLORS.length
  return LABEL_AUTO_COLORS[idx]
}

/**
 * Remove the operator text from the input string.
 */
export function removeOperatorText(text: string, startIndex: number, endIndex: number): string {
  const before = text.slice(0, startIndex)
  const after = text.slice(endIndex)
  // Clean up double spaces but preserve leading/trailing single spaces
  return (before + after).replace(/  +/g, ' ')
}

function formatIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatUserDate(d: Date, fmt: string): string {
  const day = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const y = d.getFullYear()
  switch (fmt) {
    case 'mm/dd/yyyy': return `${m}/${day}/${y}`
    case 'yyyy/mm/dd': return `${y}/${m}/${day}`
    default: return `${day}/${m}/${y}`
  }
}

function formatDateDisplay(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
}

/**
 * Filter projects by substring match on name.
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.toLowerCase()
  if (!q) return projects.slice(0, 5)
  return projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5)
}
