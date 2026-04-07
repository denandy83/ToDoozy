/**
 * Smart input parser for Telegram messages.
 * Adapted from the in-app smartInputParser.ts.
 *
 * Syntax:
 *   @label      — assign label (auto-create if doesn't exist)
 *   /project    — assign to project (when mixed with other text)
 *   d:today     — due date (today, tomorrow, monday, 2026-04-10)
 *   p:high      — priority (none/0, low/1, normal/medium/2, high/3, urgent/4)
 *   r:https://  — reference URL
 *   s:status    — status name
 *   Everything else = task title
 */

export interface ParsedMessage {
  title: string
  labels: string[]
  project: string | null
  dueDate: string | null   // ISO YYYY-MM-DD
  priority: number
  referenceUrl: string | null
  status: string | null
}

const PRIORITY_ALIASES: Record<string, number> = {
  none: 0, '0': 0,
  low: 1, '1': 1,
  normal: 2, medium: 2, '2': 2,
  high: 3, '3': 3,
  urgent: 4, '4': 4
}

export function parseMessage(text: string): ParsedMessage {
  const labels: string[] = []
  let project: string | null = null
  let dueDate: string | null = null
  let priority = 0
  let referenceUrl: string | null = null
  let status: string | null = null

  // Split into tokens, preserving order
  const tokens = text.split(/\s+/)
  const titleParts: string[] = []

  for (const token of tokens) {
    if (!token) continue

    // @label
    if (token.startsWith('@') && token.length > 1) {
      labels.push(token.slice(1))
      continue
    }

    // d:date
    if (token.startsWith('d:') && token.length > 2) {
      dueDate = parseDateToken(token.slice(2))
      continue
    }

    // p:priority
    if (token.startsWith('p:') && token.length > 2) {
      const val = PRIORITY_ALIASES[token.slice(2).toLowerCase()]
      if (val !== undefined) {
        priority = val
        continue
      }
    }

    // r:url
    if (token.startsWith('r:') && token.length > 2) {
      referenceUrl = token.slice(2)
      // Ensure protocol
      if (!referenceUrl.startsWith('http://') && !referenceUrl.startsWith('https://')) {
        referenceUrl = 'https://' + referenceUrl
      }
      continue
    }

    // s:status
    if (token.startsWith('s:') && token.length > 2) {
      status = token.slice(2)
      continue
    }

    // /project — only when there are other tokens (not a standalone command)
    if (token.startsWith('/') && token.length > 1 && tokens.length > 1) {
      project = token.slice(1)
      continue
    }

    titleParts.push(token)
  }

  return {
    title: titleParts.join(' ').trim(),
    labels,
    project,
    dueDate,
    priority,
    referenceUrl,
    status
  }
}

function parseDateToken(value: string): string | null {
  const v = value.toLowerCase()

  // Presets
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (v === 'today') return formatIso(today)

  if (v === 'tomorrow') {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    return formatIso(d)
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayIdx = days.findIndex((d) => d.startsWith(v))
  if (dayIdx !== -1 && v.length >= 3) {
    const d = new Date(today)
    const diff = (dayIdx - d.getDay() + 7) % 7
    d.setDate(d.getDate() + (diff === 0 ? 7 : diff))
    return formatIso(d)
  }

  // Explicit date: YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const [, y, m, day] = isoMatch
    const d = new Date(parseInt(y), parseInt(m) - 1, parseInt(day))
    if (!isNaN(d.getTime())) return formatIso(d)
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmyMatch) {
    const [, day, m, y] = dmyMatch
    const d = new Date(parseInt(y), parseInt(m) - 1, parseInt(day))
    if (!isNaN(d.getTime())) return formatIso(d)
  }

  return null
}

function formatIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Check if a message is a standalone command (e.g., /groceries with no other text).
 * These should list project tasks rather than create a task.
 */
export function isStandaloneCommand(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('/') && !trimmed.includes(' ') && trimmed.length > 1) {
    const cmd = trimmed.slice(1).toLowerCase()
    // Exclude known bot commands
    if (['done', 'myday', 'start', 'help'].includes(cmd)) return null
    return cmd
  }
  return null
}

/**
 * Check if message is the /done command.
 */
export function isDoneCommand(text: string): { isDone: true; query: string | null } | null {
  const trimmed = text.trim()
  if (trimmed === '/done') return { isDone: true, query: null }
  if (trimmed.startsWith('/done ')) return { isDone: true, query: trimmed.slice(6).trim() }
  return null
}

/**
 * Check if message is the /myday command.
 */
export function isMyDayCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/myday'
}

/**
 * Format a due date for display.
 */
export function formatDueDate(dueDate: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')

  const diffMs = due.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return days[due.getDay()]
  }

  const m = String(due.getMonth() + 1).padStart(2, '0')
  const d = String(due.getDate()).padStart(2, '0')
  return `${due.getFullYear()}-${m}-${d}`
}

/**
 * Extract a short domain from a URL for display.
 */
export function formatUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
