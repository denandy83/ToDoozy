import { describe, it, expect } from 'vitest'
import { getBucketForStatus, truncateTitle, classifyMyDayTasks } from './tray-utils'
import type { Status, Task } from '../shared/types'

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    id: 'status-1',
    project_id: 'proj-1',
    name: 'Test',
    color: '#888',
    icon: 'circle',
    order_index: 0,
    is_done: 0,
    is_default: 0,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...overrides
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    owner_id: 'user-1',
    assigned_to: null,
    title: 'Test Task',
    description: null,
    status_id: 'status-1',
    priority: 0,
    due_date: null,
    parent_id: null,
    order_index: 0,
    is_in_my_day: 1,
    is_template: 0,
    is_archived: 0,
    completed_date: null,
    recurrence_rule: null,
    reference_url: null,
    my_day_dismissed_date: null,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...overrides
  }
}

describe('getBucketForStatus', () => {
  it('returns not_started for undefined status', () => {
    expect(getBucketForStatus(undefined)).toBe('not_started')
  })

  it('returns done for is_done=1', () => {
    expect(getBucketForStatus(makeStatus({ is_done: 1 }))).toBe('done')
  })

  it('returns not_started for is_default=1', () => {
    expect(getBucketForStatus(makeStatus({ is_default: 1 }))).toBe('not_started')
  })

  it('returns in_progress for non-default, non-done', () => {
    expect(getBucketForStatus(makeStatus())).toBe('in_progress')
  })

  it('is_done takes priority over is_default', () => {
    expect(getBucketForStatus(makeStatus({ is_done: 1, is_default: 1 }))).toBe('done')
  })
})

describe('truncateTitle', () => {
  it('returns short titles unchanged', () => {
    expect(truncateTitle('Hello')).toBe('Hello')
  })

  it('returns titles at exact max length unchanged', () => {
    const title = 'A'.repeat(40)
    expect(truncateTitle(title)).toBe(title)
  })

  it('truncates long titles with ellipsis', () => {
    const title = 'A'.repeat(50)
    const result = truncateTitle(title)
    expect(result.length).toBe(40)
    expect(result.endsWith('\u2026')).toBe(true)
  })

  it('respects custom max length', () => {
    expect(truncateTitle('Hello World', 5)).toBe('Hell\u2026')
  })
})

describe('classifyMyDayTasks', () => {
  const defaultStatus = makeStatus({ id: 'default', is_default: 1 })
  const inProgressStatus = makeStatus({ id: 'in-prog' })
  const doneStatus = makeStatus({ id: 'done', is_done: 1 })

  const statusMap: Record<string, Status> = {
    default: defaultStatus,
    'in-prog': inProgressStatus,
    done: doneStatus
  }

  const getStatus = (id: string): Status | undefined => statusMap[id]

  it('returns empty for no tasks', () => {
    const result = classifyMyDayTasks([], getStatus)
    expect(result.tasks).toEqual([])
    expect(result.totalNonDone).toBe(0)
  })

  it('excludes done tasks', () => {
    const tasks = [makeTask({ id: 't1', status_id: 'done', title: 'Done task' })]
    const result = classifyMyDayTasks(tasks, getStatus)
    expect(result.tasks).toEqual([])
    expect(result.totalNonDone).toBe(0)
  })

  it('excludes subtasks (parent_id set)', () => {
    const tasks = [makeTask({ id: 't1', status_id: 'default', parent_id: 'parent-1' })]
    const result = classifyMyDayTasks(tasks, getStatus)
    expect(result.tasks).toEqual([])
    expect(result.totalNonDone).toBe(0)
  })

  it('classifies tasks with not_started first, then in_progress', () => {
    const tasks = [
      makeTask({ id: 't1', status_id: 'in-prog', title: 'Working' }),
      makeTask({ id: 't2', status_id: 'default', title: 'Not started' })
    ]
    const result = classifyMyDayTasks(tasks, getStatus)
    expect(result.totalNonDone).toBe(2)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toEqual({ id: 't2', title: 'Not started', bucket: 'not_started' })
    expect(result.tasks[1]).toEqual({ id: 't1', title: 'Working', bucket: 'in_progress' })
  })

  it('limits to 15 total tasks', () => {
    const tasks = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeTask({ id: `op-${i}`, status_id: 'default', title: `OP ${i}`, order_index: i })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeTask({ id: `ip-${i}`, status_id: 'in-prog', title: `IP ${i}`, order_index: i + 10 })
      )
    ]
    const result = classifyMyDayTasks(tasks, getStatus)
    expect(result.totalNonDone).toBe(20)
    expect(result.tasks).toHaveLength(15)
    // not_started first, then in_progress
    expect(result.tasks.filter((t) => t.bucket === 'not_started')).toHaveLength(10)
    expect(result.tasks.filter((t) => t.bucket === 'in_progress')).toHaveLength(5)
  })

  it('returns all tasks when under the limit', () => {
    const tasks = [
      makeTask({ id: 'ip-1', status_id: 'in-prog', title: 'IP 1' }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeTask({ id: `op-${i}`, status_id: 'default', title: `OP ${i}`, order_index: i + 1 })
      )
    ]
    const result = classifyMyDayTasks(tasks, getStatus)
    expect(result.totalNonDone).toBe(6)
    expect(result.tasks).toHaveLength(6)
  })
})
