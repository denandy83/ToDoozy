import { describe, it, expect } from 'vitest'
import {
  parseMessage,
  isStandaloneCommand,
  isDoneCommand,
  isMyDayCommand,
  formatDueDate,
  formatUrl
} from './parser'

describe('parseMessage', () => {
  it('parses a simple task title', () => {
    const result = parseMessage('buy groceries')
    expect(result.title).toBe('buy groceries')
    expect(result.labels).toEqual([])
    expect(result.project).toBeNull()
    expect(result.dueDate).toBeNull()
    expect(result.priority).toBe(0)
    expect(result.referenceUrl).toBeNull()
    expect(result.status).toBeNull()
  })

  it('parses labels with @ prefix', () => {
    const result = parseMessage('buy milk @groceries @urgent')
    expect(result.title).toBe('buy milk')
    expect(result.labels).toEqual(['groceries', 'urgent'])
  })

  it('parses project with / prefix (mixed with text)', () => {
    const result = parseMessage('buy milk /shopping')
    expect(result.title).toBe('buy milk')
    expect(result.project).toBe('shopping')
  })

  it('parses due date d:today', () => {
    const result = parseMessage('buy milk d:today')
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(result.title).toBe('buy milk')
    expect(result.dueDate).toBe(expected)
  })

  it('parses due date d:tomorrow', () => {
    const result = parseMessage('buy milk d:tomorrow')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(result.dueDate).toBe(expected)
  })

  it('parses explicit ISO date d:2026-04-10', () => {
    const result = parseMessage('buy milk d:2026-04-10')
    expect(result.dueDate).toBe('2026-04-10')
  })

  it('parses priority p:high', () => {
    const result = parseMessage('important task p:high')
    expect(result.title).toBe('important task')
    expect(result.priority).toBe(3)
  })

  it('parses priority p:3', () => {
    const result = parseMessage('task p:3')
    expect(result.priority).toBe(3)
  })

  it('parses reference URL', () => {
    const result = parseMessage('check site r:www.example.com')
    expect(result.title).toBe('check site')
    expect(result.referenceUrl).toBe('https://www.example.com')
  })

  it('preserves https:// in reference URL', () => {
    const result = parseMessage('check r:https://example.com')
    expect(result.referenceUrl).toBe('https://example.com')
  })

  it('parses status', () => {
    const result = parseMessage('task s:inprogress')
    expect(result.title).toBe('task')
    expect(result.status).toBe('inprogress')
  })

  it('parses full complex message', () => {
    const result = parseMessage('eggs and milk /groceries d:today @fast r:www.delhaize.com p:high')
    expect(result.title).toBe('eggs and milk')
    expect(result.project).toBe('groceries')
    expect(result.labels).toEqual(['fast'])
    expect(result.referenceUrl).toBe('https://www.delhaize.com')
    expect(result.priority).toBe(3)
    expect(result.dueDate).not.toBeNull()
  })

  it('returns empty title when only operators', () => {
    const result = parseMessage('@label /project d:today')
    expect(result.title).toBe('')
    expect(result.labels).toEqual(['label'])
    expect(result.project).toBe('project')
  })

  it('parses day name d:monday', () => {
    const result = parseMessage('task d:mon')
    expect(result.dueDate).not.toBeNull()
  })

  it('NLP: detects "tomorrow" without d: prefix', () => {
    const result = parseMessage('buy milk tomorrow')
    expect(result.dueDate).not.toBeNull()
    expect(result.title).toBe('buy milk')
  })

  it('NLP: explicit d: takes priority over NLP', () => {
    const result = parseMessage('buy milk d:today tomorrow')
    // d:today should be set, "tomorrow" stays in title
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(result.dueDate).toBe(expected)
  })

  it('NLP: detects "every monday" as recurrence', () => {
    const result = parseMessage('standup every monday')
    expect(result.recurrenceRule).toBe('every:1:weeks:mon')
    expect(result.title).toBe('standup')
    expect(result.dueDate).not.toBeNull()
  })

  it('NLP: detects "every day" as recurrence', () => {
    const result = parseMessage('exercise every day')
    expect(result.recurrenceRule).toBe('every:1:days')
    expect(result.title).toBe('exercise')
  })

  it('NLP: detects "every weekday" as recurrence', () => {
    const result = parseMessage('standup every weekday')
    expect(result.recurrenceRule).toBe('every:1:weeks:mon,tue,wed,thu,fri')
    expect(result.title).toBe('standup')
  })

  it('includes recurrenceRule field as null when not recurring', () => {
    const result = parseMessage('buy groceries')
    expect(result.recurrenceRule).toBeNull()
  })
})

describe('isStandaloneCommand', () => {
  it('detects standalone /project', () => {
    expect(isStandaloneCommand('/groceries')).toBe('groceries')
  })

  it('returns null for known commands', () => {
    expect(isStandaloneCommand('/done')).toBeNull()
    expect(isStandaloneCommand('/myday')).toBeNull()
    expect(isStandaloneCommand('/help')).toBeNull()
    expect(isStandaloneCommand('/start')).toBeNull()
  })

  it('returns null for messages with spaces', () => {
    expect(isStandaloneCommand('/project some text')).toBeNull()
  })

  it('returns null for non-command text', () => {
    expect(isStandaloneCommand('hello')).toBeNull()
  })
})

describe('isDoneCommand', () => {
  it('detects /done without query', () => {
    const result = isDoneCommand('/done')
    expect(result).toEqual({ isDone: true, query: null })
  })

  it('detects /done with query', () => {
    const result = isDoneCommand('/done buy milk')
    expect(result).toEqual({ isDone: true, query: 'buy milk' })
  })

  it('returns null for other commands', () => {
    expect(isDoneCommand('/help')).toBeNull()
    expect(isDoneCommand('some text')).toBeNull()
  })
})

describe('isMyDayCommand', () => {
  it('detects /myday', () => {
    expect(isMyDayCommand('/myday')).toBe(true)
  })

  it('returns false for other text', () => {
    expect(isMyDayCommand('/done')).toBe(false)
    expect(isMyDayCommand('myday')).toBe(false)
  })
})

describe('formatDueDate', () => {
  it('formats today', () => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(formatDueDate(iso)).toBe('Today')
  })

  it('formats tomorrow', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(formatDueDate(iso)).toBe('Tomorrow')
  })
})

describe('formatUrl', () => {
  it('extracts domain from URL', () => {
    expect(formatUrl('https://www.example.com/path')).toBe('example.com')
  })

  it('strips www prefix', () => {
    expect(formatUrl('https://www.delhaize.com')).toBe('delhaize.com')
  })

  it('returns input for invalid URLs', () => {
    expect(formatUrl('not-a-url')).toBe('not-a-url')
  })
})
