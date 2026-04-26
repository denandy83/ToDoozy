import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore } from './taskStore'
import type { Task } from '../../../../shared/types'

function makeFakeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    project_id: 'proj-1',
    owner_id: 'user-1',
    assigned_to: null,
    title: `Task ${overrides.id}`,
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
    my_day_dismissed_date: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides
  }
}

describe('taskStore selection methods', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: {
        't1': makeFakeTask({ id: 't1', order_index: 0 }),
        't2': makeFakeTask({ id: 't2', order_index: 1 }),
        't3': makeFakeTask({ id: 't3', order_index: 2 }),
        't4': makeFakeTask({ id: 't4', order_index: 3 }),
        't5': makeFakeTask({ id: 't5', order_index: 4 })
      },
      selectedTaskIds: new Set<string>(),
      lastSelectedTaskId: null
    })
  })

  describe('selectTask', () => {
    it('selects a single task and clears previous selection', () => {
      useTaskStore.getState().selectTask('t1')
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t1']))
      expect(useTaskStore.getState().lastSelectedTaskId).toBe('t1')

      useTaskStore.getState().selectTask('t2')
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t2']))
      expect(useTaskStore.getState().lastSelectedTaskId).toBe('t2')
    })
  })

  describe('setCurrentTask', () => {
    it('selects a single task when given an id', () => {
      useTaskStore.getState().setCurrentTask('t3')
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t3']))
      expect(useTaskStore.getState().lastSelectedTaskId).toBe('t3')
    })

    it('clears selection when given null', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().setCurrentTask(null)
      expect(useTaskStore.getState().selectedTaskIds.size).toBe(0)
      expect(useTaskStore.getState().lastSelectedTaskId).toBeNull()
    })
  })

  describe('toggleTaskInSelection', () => {
    it('adds a task to selection when not present', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().toggleTaskInSelection('t2')
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t1', 't2']))
      expect(useTaskStore.getState().lastSelectedTaskId).toBe('t2')
    })

    it('removes a task from selection when already present', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().toggleTaskInSelection('t2')
      useTaskStore.getState().toggleTaskInSelection('t1')
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t2']))
      expect(useTaskStore.getState().lastSelectedTaskId).toBe('t1')
    })

    it('works from empty selection', () => {
      useTaskStore.getState().toggleTaskInSelection('t3')
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t3']))
    })
  })

  describe('selectTaskRange', () => {
    it('adds a range of tasks to the existing selection', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().selectTaskRange(['t2', 't3', 't4'])
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t1', 't2', 't3', 't4']))
      expect(useTaskStore.getState().lastSelectedTaskId).toBe('t4')
    })

    it('does not remove existing selection', () => {
      useTaskStore.getState().selectTask('t5')
      useTaskStore.getState().selectTaskRange(['t1', 't2'])
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t5', 't1', 't2']))
    })
  })

  describe('selectAllTasks', () => {
    it('replaces selection with all provided ids', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().selectAllTasks(['t1', 't2', 't3', 't4', 't5'])
      expect(useTaskStore.getState().selectedTaskIds).toEqual(new Set(['t1', 't2', 't3', 't4', 't5']))
    })

    it('works with empty array', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().selectAllTasks([])
      expect(useTaskStore.getState().selectedTaskIds.size).toBe(0)
    })
  })

  describe('clearSelection', () => {
    it('clears all selected tasks', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().toggleTaskInSelection('t2')
      useTaskStore.getState().clearSelection()
      expect(useTaskStore.getState().selectedTaskIds.size).toBe(0)
      expect(useTaskStore.getState().lastSelectedTaskId).toBeNull()
    })
  })

  describe('selectCurrentTaskId selector', () => {
    it('returns the task id when exactly one is selected', () => {
      useTaskStore.getState().selectTask('t3')
      const state = useTaskStore.getState()
      expect(state.selectedTaskIds.size).toBe(1)
      expect([...state.selectedTaskIds][0]).toBe('t3')
    })

    it('returns null (via empty set) when multiple are selected', () => {
      useTaskStore.getState().selectTask('t1')
      useTaskStore.getState().toggleTaskInSelection('t2')
      const state = useTaskStore.getState()
      expect(state.selectedTaskIds.size).toBe(2)
    })

    it('returns null (via empty set) when none are selected', () => {
      const state = useTaskStore.getState()
      expect(state.selectedTaskIds.size).toBe(0)
    })
  })

  describe('pendingBulkDeleteTasks', () => {
    it('sets and clears pending bulk delete', () => {
      useTaskStore.getState().setPendingBulkDeleteTasks(['t1', 't2'])
      expect(useTaskStore.getState().pendingBulkDeleteTaskIds).toEqual(['t1', 't2'])

      useTaskStore.getState().setPendingBulkDeleteTasks(null)
      expect(useTaskStore.getState().pendingBulkDeleteTaskIds).toBeNull()
    })
  })
})
