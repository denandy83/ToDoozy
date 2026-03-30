import { describe, it, expect } from 'vitest'
import {
  computeOffset,
  computeDateFromOffset,
  formatOffset,
  collectTasksWithOffsets,
  stripOffsets
} from './dueDateOffsets'
import type { ProjectTemplateTask } from '../../../../shared/types'

function makeTask(
  title: string,
  offset: number | null,
  subtasks: ProjectTemplateTask[] = []
): ProjectTemplateTask {
  return {
    title,
    description: null,
    priority: 0,
    recurrence_rule: null,
    due_date_offset: offset,
    order_index: 0,
    labels: [],
    subtasks
  }
}

describe('computeOffset', () => {
  it('returns null for null due_date', () => {
    expect(computeOffset(null, new Date('2026-03-30'))).toBe(null)
  })

  it('returns 0 for same-day due_date', () => {
    expect(computeOffset('2026-03-30', new Date('2026-03-30'))).toBe(0)
  })

  it('returns positive offset for future date', () => {
    expect(computeOffset('2026-04-05', new Date('2026-03-30'))).toBe(6)
  })

  it('returns negative offset for past date', () => {
    expect(computeOffset('2026-03-25', new Date('2026-03-30'))).toBe(-5)
  })

  it('handles large offsets', () => {
    expect(computeOffset('2027-03-30', new Date('2026-03-30'))).toBe(365)
  })
})

describe('computeDateFromOffset', () => {
  it('returns null for null offset', () => {
    expect(computeDateFromOffset('2026-04-01', null)).toBe(null)
  })

  it('returns deploy date for offset 0', () => {
    expect(computeDateFromOffset('2026-04-01', 0)).toBe('2026-04-01')
  })

  it('adds positive offset', () => {
    expect(computeDateFromOffset('2026-04-01', 5)).toBe('2026-04-06')
  })

  it('handles negative offset', () => {
    expect(computeDateFromOffset('2026-04-01', -3)).toBe('2026-03-29')
  })

  it('handles month boundary', () => {
    expect(computeDateFromOffset('2026-01-30', 3)).toBe('2026-02-02')
  })

  it('handles year boundary', () => {
    expect(computeDateFromOffset('2026-12-30', 5)).toBe('2027-01-04')
  })
})

describe('formatOffset', () => {
  it('formats zero as "same day"', () => {
    expect(formatOffset(0)).toBe('same day')
  })

  it('formats +1 as "+1 day"', () => {
    expect(formatOffset(1)).toBe('+1 day')
  })

  it('formats +5 as "+5 days"', () => {
    expect(formatOffset(5)).toBe('+5 days')
  })

  it('formats -1 as "-1 day"', () => {
    expect(formatOffset(-1)).toBe('-1 day')
  })

  it('formats -3 as "-3 days"', () => {
    expect(formatOffset(-3)).toBe('-3 days')
  })
})

describe('collectTasksWithOffsets', () => {
  it('returns empty array for no tasks', () => {
    expect(collectTasksWithOffsets([])).toEqual([])
  })

  it('returns empty array when no tasks have offsets', () => {
    const tasks = [makeTask('A', null), makeTask('B', null)]
    expect(collectTasksWithOffsets(tasks)).toEqual([])
  })

  it('collects tasks with offsets', () => {
    const tasks = [makeTask('A', 5), makeTask('B', null), makeTask('C', -2)]
    expect(collectTasksWithOffsets(tasks)).toEqual([
      { title: 'A', offset: 5 },
      { title: 'C', offset: -2 }
    ])
  })

  it('collects offsets from subtasks', () => {
    const tasks = [makeTask('Parent', null, [makeTask('Child', 3)])]
    expect(collectTasksWithOffsets(tasks)).toEqual([{ title: 'Child', offset: 3 }])
  })

  it('collects from deeply nested subtasks', () => {
    const tasks = [
      makeTask('A', 1, [makeTask('B', null, [makeTask('C', 10)])])
    ]
    expect(collectTasksWithOffsets(tasks)).toEqual([
      { title: 'A', offset: 1 },
      { title: 'C', offset: 10 }
    ])
  })
})

describe('stripOffsets', () => {
  it('sets all offsets to null', () => {
    const tasks = [makeTask('A', 5), makeTask('B', -2)]
    const result = stripOffsets(tasks)
    expect(result[0].due_date_offset).toBe(null)
    expect(result[1].due_date_offset).toBe(null)
  })

  it('strips offsets from subtasks', () => {
    const tasks = [makeTask('Parent', 3, [makeTask('Child', 7)])]
    const result = stripOffsets(tasks)
    expect(result[0].due_date_offset).toBe(null)
    expect(result[0].subtasks[0].due_date_offset).toBe(null)
  })

  it('preserves other fields', () => {
    const tasks = [makeTask('A', 5)]
    const result = stripOffsets(tasks)
    expect(result[0].title).toBe('A')
    expect(result[0].priority).toBe(0)
    expect(result[0].labels).toEqual([])
  })

  it('does not mutate original', () => {
    const tasks = [makeTask('A', 5)]
    stripOffsets(tasks)
    expect(tasks[0].due_date_offset).toBe(5)
  })
})
