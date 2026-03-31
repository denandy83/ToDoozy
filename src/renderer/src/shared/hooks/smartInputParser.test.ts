import { describe, it, expect } from 'vitest'
import {
  detectOperator,
  filterLabels,
  filterPriorities,
  filterDates,
  getNextAutoColor,
  removeOperatorText,
  LABEL_AUTO_COLORS
} from './smartInputParser'
import type { Label } from '../../../../shared/types'

function makeLabel(id: string, name: string, color: string, _projectId = 'proj1'): Label {
  return {
    id,
    name,
    color,
    order_index: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
}

describe('detectOperator', () => {
  it('detects @ at start of input', () => {
    const result = detectOperator('@wo', 3, new Set())
    expect(result).toEqual({
      type: '@',
      query: 'wo',
      startIndex: 0,
      endIndex: 3
    })
  })

  it('detects @ after space', () => {
    const result = detectOperator('hello @work', 11, new Set())
    expect(result).toEqual({
      type: '@',
      query: 'work',
      startIndex: 6,
      endIndex: 11
    })
  })

  it('does not detect @ mid-word', () => {
    const result = detectOperator('email@test', 10, new Set())
    expect(result).toBeNull()
  })

  it('detects p: at start', () => {
    const result = detectOperator('p:high', 6, new Set())
    expect(result).toEqual({
      type: 'p:',
      query: 'high',
      startIndex: 0,
      endIndex: 6
    })
  })

  it('detects p: after space', () => {
    const result = detectOperator('task p:u', 8, new Set())
    expect(result).toEqual({
      type: 'p:',
      query: 'u',
      startIndex: 5,
      endIndex: 8
    })
  })

  it('does not detect p: mid-word', () => {
    const result = detectOperator('stop:new', 8, new Set())
    expect(result).toBeNull()
  })

  it('detects d: at start', () => {
    const result = detectOperator('d:today', 7, new Set())
    expect(result).toEqual({
      type: 'd:',
      query: 'today',
      startIndex: 0,
      endIndex: 7
    })
  })

  it('detects d: after space', () => {
    const result = detectOperator('task d:tom', 10, new Set())
    expect(result).toEqual({
      type: 'd:',
      query: 'tom',
      startIndex: 5,
      endIndex: 10
    })
  })

  it('detects r: at start', () => {
    const result = detectOperator('r:https://example.com', 21, new Set())
    expect(result).toEqual({
      type: 'r:',
      query: 'https://example.com',
      startIndex: 0,
      endIndex: 21
    })
  })

  it('detects r: after space', () => {
    const result = detectOperator('task r:https://link.co', 22, new Set())
    expect(result).toEqual({
      type: 'r:',
      query: 'https://link.co',
      startIndex: 5,
      endIndex: 22
    })
  })

  it('does not detect r: mid-word', () => {
    const result = detectOperator('for:bar', 7, new Set())
    expect(result).toBeNull()
  })

  it('returns null when cursor is past operator text (space separates)', () => {
    const result = detectOperator('@work more', 10, new Set())
    expect(result).toBeNull()
  })

  it('respects suppressed positions', () => {
    const result = detectOperator('@test', 5, new Set([0]))
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(detectOperator('', 0, new Set())).toBeNull()
  })
})

describe('filterLabels', () => {
  const labels = [
    makeLabel('1', 'Work', '#ef4444'),
    makeLabel('2', 'Workout', '#22c55e'),
    makeLabel('3', 'Personal', '#3b82f6'),
    makeLabel('4', 'Health', '#f59e0b'),
    makeLabel('5', 'Finance', '#8b5cf6'),
    makeLabel('6', 'Travel', '#ec4899')
  ]

  it('returns first 5 labels when query is empty', () => {
    expect(filterLabels(labels, '')).toHaveLength(5)
  })

  it('filters by substring match', () => {
    const result = filterLabels(labels, 'wo')
    expect(result.map((l) => l.name)).toEqual(['Work', 'Workout'])
  })

  it('is case-insensitive', () => {
    const result = filterLabels(labels, 'WO')
    expect(result.map((l) => l.name)).toEqual(['Work', 'Workout'])
  })

  it('returns empty for no match', () => {
    expect(filterLabels(labels, 'xyz')).toEqual([])
  })
})

describe('filterPriorities', () => {
  it('returns all priorities when query is empty', () => {
    expect(filterPriorities('')).toHaveLength(5)
  })

  it('filters by prefix: u -> urgent', () => {
    const result = filterPriorities('u')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Urgent')
  })

  it('filters by prefix: h -> high', () => {
    const result = filterPriorities('h')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('High')
  })

  it('filters by prefix: n -> none, normal', () => {
    const result = filterPriorities('n')
    expect(result.map((p) => p.label)).toContain('None')
    expect(result.map((p) => p.label)).toContain('Normal')
  })

  it('accepts medium alias', () => {
    const result = filterPriorities('m')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Normal') // medium maps to Normal (2)
  })
})

describe('filterDates', () => {
  it('returns presets when query is empty', () => {
    const result = filterDates('')
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('filters by prefix: to -> today, tomorrow', () => {
    const result = filterDates('to')
    const labels = result.map((d) => d.label.toLowerCase())
    expect(labels).toContain('today')
    expect(labels).toContain('tomorrow')
  })

  it('returns ISO date strings', () => {
    const result = filterDates('today')
    expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('parses explicit dd/mm/yyyy date', () => {
    const result = filterDates('22/03/2026')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].date).toBe('2026-03-22')
  })

  it('rejects invalid explicit dates', () => {
    const result = filterDates('32/13/2026')
    // Should not contain the invalid date but may still have preset matches
    const hasInvalid = result.some((d) => d.date === 'NaN-NaN-NaN')
    expect(hasInvalid).toBe(false)
  })
})

describe('getNextAutoColor', () => {
  it('returns first color when no labels exist', () => {
    expect(getNextAutoColor([])).toBe(LABEL_AUTO_COLORS[0])
  })

  it('skips already used colors', () => {
    const labels = [makeLabel('1', 'Test', '#ef4444')]
    expect(getNextAutoColor(labels)).toBe(LABEL_AUTO_COLORS[1])
  })

  it('cycles when all colors are used', () => {
    const labels = LABEL_AUTO_COLORS.map((c, i) => makeLabel(String(i), `L${i}`, c))
    // When all 12 are used, cycles from start
    expect(getNextAutoColor(labels)).toBe(LABEL_AUTO_COLORS[0])
  })
})

describe('removeOperatorText', () => {
  it('removes operator and cleans up spaces', () => {
    expect(removeOperatorText('hello @work world', 6, 11)).toBe('hello world')
  })

  it('removes operator at start', () => {
    expect(removeOperatorText('@work rest', 0, 5)).toBe(' rest')
  })

  it('removes operator at end', () => {
    expect(removeOperatorText('task p:high', 5, 11)).toBe('task ')
  })

  it('handles full removal', () => {
    expect(removeOperatorText('@test', 0, 5)).toBe('')
  })
})
