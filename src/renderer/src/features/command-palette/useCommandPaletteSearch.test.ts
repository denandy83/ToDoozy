import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Task, Label, Status } from '../../../../shared/types'
import {
  parseQuery,
  matchesPriority,
  matchesLabel,
  matchesStatus,
  matchesDue,
  matchesHas
} from './useCommandPaletteSearch'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    owner_id: 'user-1',
    assigned_to: null,
    title: 'Test task',
    description: null,
    status_id: 'status-1',
    priority: 0,
    due_date: null,
    parent_id: null,
    order_index: 0,
    is_in_my_day: 0,
    is_template: 0,
    is_archived: 0,
    completed_date: null,
    recurrence_rule: null,
    reference_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: 'label-1',
    name: 'Bug',
    color: '#ff0000',
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

// --- parseQuery ---

describe('parseQuery', () => {
  it('parses plain text terms', () => {
    const result = parseQuery('hello world')
    expect(result.textTerms).toEqual(['hello', 'world'])
    expect(result.priorityFilters).toEqual([])
  })

  it('parses priority operator with full name', () => {
    const result = parseQuery('priority:high')
    expect(result.priorityFilters).toEqual(['high'])
    expect(result.textTerms).toEqual([])
  })

  it('parses priority shorthand p:', () => {
    const result = parseQuery('p:urgent')
    expect(result.priorityFilters).toEqual(['urgent'])
  })

  it('parses label operator', () => {
    const result = parseQuery('label:bug')
    expect(result.labelFilters).toEqual(['bug'])
  })

  it('parses label shorthand l:', () => {
    const result = parseQuery('l:feature')
    expect(result.labelFilters).toEqual(['feature'])
  })

  it('parses status operator', () => {
    const result = parseQuery('status:done')
    expect(result.statusFilters).toEqual(['done'])
  })

  it('parses status shorthand s:', () => {
    const result = parseQuery('s:todo')
    expect(result.statusFilters).toEqual(['todo'])
  })

  it('parses d: operator', () => {
    const result = parseQuery('d:today')
    expect(result.dueFilters).toEqual(['today'])
  })

  it('treats due: as plain text since d: replaced it', () => {
    const result = parseQuery('due:today')
    expect(result.dueFilters).toEqual([])
    expect(result.textTerms).toEqual(['due:today'])
  })

  it('parses has operator', () => {
    const result = parseQuery('has:subtasks')
    expect(result.hasFilters).toEqual(['subtasks'])
  })

  it('handles mixed text and operators', () => {
    const result = parseQuery('fix bug p:high l:bug')
    expect(result.textTerms).toEqual(['fix', 'bug'])
    expect(result.priorityFilters).toEqual(['high'])
    expect(result.labelFilters).toEqual(['bug'])
  })

  it('treats unknown operator as text', () => {
    const result = parseQuery('foo:bar')
    expect(result.textTerms).toEqual(['foo:bar'])
  })

  it('treats operator with empty value as text', () => {
    const result = parseQuery('priority:')
    expect(result.textTerms).toEqual(['priority:'])
  })

  it('handles empty query', () => {
    const result = parseQuery('')
    expect(result.textTerms).toEqual([])
    expect(result.priorityFilters).toEqual([])
  })

  it('handles whitespace-only query', () => {
    const result = parseQuery('   ')
    expect(result.textTerms).toEqual([])
  })

  it('lowercases all values', () => {
    const result = parseQuery('Hello P:HIGH')
    expect(result.textTerms).toEqual(['hello'])
    expect(result.priorityFilters).toEqual(['high'])
  })
})

// --- matchesPriority ---

describe('matchesPriority', () => {
  it('matches by exact priority name', () => {
    const task = makeTask({ priority: 3 })
    expect(matchesPriority(task, ['high'])).toBe(true)
  })

  it('matches by numeric value', () => {
    const task = makeTask({ priority: 4 })
    expect(matchesPriority(task, ['4'])).toBe(true)
  })

  it('matches by prefix substring', () => {
    const task = makeTask({ priority: 4 })
    expect(matchesPriority(task, ['urg'])).toBe(true)
  })

  it('does not match wrong priority', () => {
    const task = makeTask({ priority: 1 })
    expect(matchesPriority(task, ['high'])).toBe(false)
  })

  it('matches medium as alias for normal (both priority 2)', () => {
    const task = makeTask({ priority: 2 })
    expect(matchesPriority(task, ['medium'])).toBe(true)
    expect(matchesPriority(task, ['normal'])).toBe(true)
  })

  it('matches none for priority 0', () => {
    const task = makeTask({ priority: 0 })
    expect(matchesPriority(task, ['none'])).toBe(true)
  })

  it('returns false for empty filters', () => {
    const task = makeTask({ priority: 3 })
    expect(matchesPriority(task, [])).toBe(false)
  })
})

// --- matchesLabel ---

describe('matchesLabel', () => {
  it('matches label by substring', () => {
    const labels = [makeLabel({ name: 'Bug Fix' })]
    expect(matchesLabel(labels, ['bug'])).toBe(true)
  })

  it('is case insensitive', () => {
    const labels = [makeLabel({ name: 'Feature' })]
    expect(matchesLabel(labels, ['feature'])).toBe(true)
  })

  it('does not match when no labels match', () => {
    const labels = [makeLabel({ name: 'Bug' })]
    expect(matchesLabel(labels, ['feature'])).toBe(false)
  })

  it('returns false for empty labels list', () => {
    expect(matchesLabel([], ['bug'])).toBe(false)
  })

  it('returns false for empty filters', () => {
    const labels = [makeLabel({ name: 'Bug' })]
    expect(matchesLabel(labels, [])).toBe(false)
  })
})

// --- matchesStatus ---

describe('matchesStatus', () => {
  const statuses: Record<string, Status> = {
    'status-1': {
      id: 'status-1',
      project_id: 'proj-1',
      name: 'In Progress',
      color: '#00ff00',
      icon: 'circle',
      order_index: 0,
      is_done: 0,
      is_default: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  }

  it('matches by status name substring', () => {
    const task = makeTask({ status_id: 'status-1' })
    expect(matchesStatus(task, ['progress'], statuses)).toBe(true)
  })

  it('is case insensitive', () => {
    const task = makeTask({ status_id: 'status-1' })
    expect(matchesStatus(task, ['in progress'], statuses)).toBe(true)
  })

  it('returns false for unknown status id', () => {
    const task = makeTask({ status_id: 'unknown' })
    expect(matchesStatus(task, ['progress'], statuses)).toBe(false)
  })

  it('returns false when status name does not match', () => {
    const task = makeTask({ status_id: 'status-1' })
    expect(matchesStatus(task, ['done'], statuses)).toBe(false)
  })
})

// --- matchesDue ---

describe('matchesDue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('matches overdue tasks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const task = makeTask({ due_date: '2026-03-10T00:00:00.000Z' })
    expect(matchesDue(task, ['overdue'])).toBe(true)
  })

  it('does not match future tasks as overdue', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const task = makeTask({ due_date: '2026-03-20T00:00:00.000Z' })
    expect(matchesDue(task, ['overdue'])).toBe(false)
  })

  it('matches tasks due today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    // Use the same date format the code checks: startsWith on the local today string
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const todayStr = now.toISOString().split('T')[0]
    const task = makeTask({ due_date: `${todayStr}T09:00:00.000Z` })
    expect(matchesDue(task, ['today'])).toBe(true)
  })

  it('does not match tasks due tomorrow as today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const task = makeTask({ due_date: '2026-03-16T00:00:00.000Z' })
    expect(matchesDue(task, ['today'])).toBe(false)
  })

  it('matches tasks due within the week', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const task = makeTask({ due_date: '2026-03-20T00:00:00.000Z' })
    expect(matchesDue(task, ['week'])).toBe(true)
  })

  it('does not match tasks due beyond a week', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const task = makeTask({ due_date: '2026-03-25T00:00:00.000Z' })
    expect(matchesDue(task, ['week'])).toBe(false)
  })

  it('returns false for tasks with no due date (overdue filter)', () => {
    const task = makeTask({ due_date: null })
    expect(matchesDue(task, ['overdue'])).toBe(false)
  })

  it('matches prefix of overdue', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const task = makeTask({ due_date: '2026-03-10T00:00:00.000Z' })
    expect(matchesDue(task, ['over'])).toBe(true)
  })
})

// --- matchesHas ---

describe('matchesHas', () => {
  it('matches tasks with subtasks', () => {
    const parent = makeTask({ id: 'parent-1' })
    const child = makeTask({ id: 'child-1', parent_id: 'parent-1' })
    const allTasks: Record<string, Task> = {
      'parent-1': parent,
      'child-1': child
    }
    expect(matchesHas(parent, ['subtasks'], allTasks)).toBe(true)
  })

  it('does not match tasks without subtasks', () => {
    const task = makeTask({ id: 'task-1' })
    const allTasks: Record<string, Task> = { 'task-1': task }
    expect(matchesHas(task, ['subtasks'], allTasks)).toBe(false)
  })

  it('matches tasks with markdown images', () => {
    const task = makeTask({ description: 'Check ![screenshot](url)' })
    expect(matchesHas(task, ['image'], { 'task-1': task })).toBe(true)
  })

  it('matches tasks with HTML images', () => {
    const task = makeTask({ description: 'See <img src="test.png">' })
    expect(matchesHas(task, ['image'], { 'task-1': task })).toBe(true)
  })

  it('does not match tasks without images', () => {
    const task = makeTask({ description: 'Just text' })
    expect(matchesHas(task, ['image'], { 'task-1': task })).toBe(false)
  })

  it('matches tasks with recurrence', () => {
    const task = makeTask({ recurrence_rule: 'FREQ=DAILY' })
    expect(matchesHas(task, ['recurrence'], { 'task-1': task })).toBe(true)
  })

  it('does not match tasks with recurrence_rule of none', () => {
    const task = makeTask({ recurrence_rule: 'none' })
    expect(matchesHas(task, ['recurrence'], { 'task-1': task })).toBe(false)
  })

  it('does not match tasks with null recurrence', () => {
    const task = makeTask({ recurrence_rule: null })
    expect(matchesHas(task, ['recurrence'], { 'task-1': task })).toBe(false)
  })

  it('matches by prefix of filter name', () => {
    const parent = makeTask({ id: 'parent-1' })
    const child = makeTask({ id: 'child-1', parent_id: 'parent-1' })
    const allTasks: Record<string, Task> = { 'parent-1': parent, 'child-1': child }
    expect(matchesHas(parent, ['sub'], allTasks)).toBe(true)
  })
})
