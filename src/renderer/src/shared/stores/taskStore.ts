import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Label,
  TaskLabelMapping
} from '../../../../shared/types'

interface TaskState {
  tasks: Record<string, Task>
  taskLabels: Record<string, Label[]>
  expandedTaskIds: Set<string>
  currentTaskId: string | null
  pendingSubtaskParentId: string | null
  pendingDeleteTaskId: string | null
  movingTaskId: string | null
  loading: boolean
  error: string | null
}

interface TaskActions {
  hydrateTasks(projectId: string): Promise<void>
  hydrateMyDay(userId: string): Promise<void>
  hydrateArchived(projectId: string): Promise<void>
  hydrateTemplates(projectId: string): Promise<void>
  hydrateAllForProject(projectId: string, userId: string): Promise<void>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>
  deleteTask(id: string): Promise<boolean>
  duplicateTask(id: string, newId: string): Promise<Task | null>
  reorderTasks(taskIds: string[]): Promise<void>
  createSubtask(parentId: string, input: CreateTaskInput): Promise<Task>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  hydrateTaskLabels(taskId: string): Promise<void>
  hydrateAllTaskLabels(projectId: string): Promise<void>
  setCurrentTask(id: string | null): void
  toggleExpanded(taskId: string): void
  setExpanded(taskId: string, expanded: boolean): void
  setPendingSubtaskParent(parentId: string | null): void
  setPendingDeleteTask(taskId: string | null): void
  setMovingTask(taskId: string | null): void
  clearError(): void
}

export type TaskStore = TaskState & TaskActions

export const useTaskStore = createWithEqualityFn<TaskStore>((set, get) => ({
  tasks: {},
  taskLabels: {},
  expandedTaskIds: new Set<string>(),
  currentTaskId: null,
  pendingSubtaskParentId: null,
  pendingDeleteTaskId: null,
  movingTaskId: null,
  loading: false,
  error: null,

  async hydrateTasks(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const tasks = await window.api.tasks.findByProjectId(projectId)
      const taskMap: Record<string, Task> = {}
      for (const task of tasks) {
        taskMap[task.id] = task
      }
      set({ tasks: taskMap, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks'
      set({ error: message, loading: false })
    }
  },

  async hydrateMyDay(userId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const tasks = await window.api.tasks.findMyDay(userId)
      const taskMap: Record<string, Task> = {}
      for (const task of tasks) {
        taskMap[task.id] = task
      }
      set({ tasks: taskMap, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load My Day tasks'
      set({ error: message, loading: false })
    }
  },

  async hydrateArchived(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const tasks = await window.api.tasks.findArchived(projectId)
      const taskMap: Record<string, Task> = {}
      for (const task of tasks) {
        taskMap[task.id] = task
      }
      set({ tasks: taskMap, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load archived tasks'
      set({ error: message, loading: false })
    }
  },

  async hydrateTemplates(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const tasks = await window.api.tasks.findTemplates(projectId)
      const taskMap: Record<string, Task> = {}
      for (const task of tasks) {
        taskMap[task.id] = task
      }
      set({ tasks: taskMap, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load templates'
      set({ error: message, loading: false })
    }
  },

  async hydrateAllForProject(projectId: string, userId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const [regular, myDay, archived, templates] = await Promise.all([
        window.api.tasks.findByProjectId(projectId),
        window.api.tasks.findMyDay(userId),
        window.api.tasks.findArchived(projectId),
        window.api.tasks.findTemplates(projectId)
      ])
      const taskMap: Record<string, Task> = {}
      for (const task of regular) taskMap[task.id] = task
      for (const task of myDay) taskMap[task.id] = task
      for (const task of archived) taskMap[task.id] = task
      for (const task of templates) taskMap[task.id] = task
      set({ tasks: taskMap, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks'
      set({ error: message, loading: false })
    }
  },

  async createTask(input: CreateTaskInput): Promise<Task> {
    try {
      const task = await window.api.tasks.create(input)
      set((state) => ({
        tasks: { ...state.tasks, [task.id]: task }
      }))
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task'
      set({ error: message })
      throw err
    }
  },

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    try {
      const task = await window.api.tasks.update(id, input)
      if (task) {
        set((state) => ({
          tasks: { ...state.tasks, [task.id]: task }
        }))
      }
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update task'
      set({ error: message })
      throw err
    }
  },

  async deleteTask(id: string): Promise<boolean> {
    try {
      const result = await window.api.tasks.delete(id)
      if (result) {
        set((state) => {
          // Collect all descendant IDs (cascade delete in DB, mirror in store)
          const idsToRemove = new Set<string>([id])
          const collectChildren = (parentId: string): void => {
            for (const task of Object.values(state.tasks)) {
              if (task.parent_id === parentId && !idsToRemove.has(task.id)) {
                idsToRemove.add(task.id)
                collectChildren(task.id)
              }
            }
          }
          collectChildren(id)

          const remaining: Record<string, Task> = {}
          const remainingLabels: Record<string, Label[]> = {}
          for (const [tid, task] of Object.entries(state.tasks)) {
            if (!idsToRemove.has(tid)) remaining[tid] = task
          }
          for (const [tid, labels] of Object.entries(state.taskLabels)) {
            if (!idsToRemove.has(tid)) remainingLabels[tid] = labels
          }
          const newExpanded = new Set(state.expandedTaskIds)
          for (const rid of idsToRemove) newExpanded.delete(rid)

          return {
            tasks: remaining,
            taskLabels: remainingLabels,
            expandedTaskIds: newExpanded,
            currentTaskId: idsToRemove.has(state.currentTaskId ?? '') ? null : state.currentTaskId
          }
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete task'
      set({ error: message })
      throw err
    }
  },

  async duplicateTask(id: string, newId: string): Promise<Task | null> {
    try {
      const task = await window.api.tasks.duplicate(id, newId)
      if (task) {
        set((state) => ({
          tasks: { ...state.tasks, [task.id]: task }
        }))
      }
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate task'
      set({ error: message })
      throw err
    }
  },

  async reorderTasks(taskIds: string[]): Promise<void> {
    try {
      await window.api.tasks.reorder(taskIds)
      set((state) => {
        const updated = { ...state.tasks }
        for (let i = 0; i < taskIds.length; i++) {
          const task = updated[taskIds[i]]
          if (task) {
            updated[taskIds[i]] = { ...task, order_index: i }
          }
        }
        return { tasks: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reorder tasks'
      set({ error: message })
      throw err
    }
  },

  async createSubtask(parentId: string, input: CreateTaskInput): Promise<Task> {
    try {
      const task = await window.api.tasks.create({ ...input, parent_id: parentId })
      set((state) => {
        const newExpanded = new Set(state.expandedTaskIds)
        newExpanded.add(parentId)
        return {
          tasks: { ...state.tasks, [task.id]: task },
          expandedTaskIds: newExpanded
        }
      })
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create subtask'
      set({ error: message })
      throw err
    }
  },

  async addLabel(taskId: string, labelId: string): Promise<void> {
    try {
      await window.api.tasks.addLabel(taskId, labelId)
      await get().hydrateTaskLabels(taskId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add label'
      set({ error: message })
      throw err
    }
  },

  async removeLabel(taskId: string, labelId: string): Promise<boolean> {
    try {
      const result = await window.api.tasks.removeLabel(taskId, labelId)
      await get().hydrateTaskLabels(taskId)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove label'
      set({ error: message })
      throw err
    }
  },

  async hydrateTaskLabels(taskId: string): Promise<void> {
    try {
      const labels = await window.api.labels.findByTaskId(taskId)
      set((state) => ({
        taskLabels: { ...state.taskLabels, [taskId]: labels }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load task labels'
      set({ error: message })
    }
  },

  async hydrateAllTaskLabels(projectId: string): Promise<void> {
    try {
      const mappings: TaskLabelMapping[] =
        await window.api.labels.findTaskLabelsByProject(projectId)
      const grouped: Record<string, Label[]> = {}
      for (const m of mappings) {
        const { task_id, ...label } = m
        if (!grouped[task_id]) grouped[task_id] = []
        grouped[task_id].push(label)
      }
      set((state) => ({
        taskLabels: { ...state.taskLabels, ...grouped }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load task labels'
      set({ error: message })
    }
  },

  setCurrentTask(id: string | null): void {
    set({ currentTaskId: id })
  },

  toggleExpanded(taskId: string): void {
    set((state) => {
      const next = new Set(state.expandedTaskIds)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return { expandedTaskIds: next }
    })
  },

  setExpanded(taskId: string, expanded: boolean): void {
    set((state) => {
      const next = new Set(state.expandedTaskIds)
      if (expanded) {
        next.add(taskId)
      } else {
        next.delete(taskId)
      }
      return { expandedTaskIds: next }
    })
  },

  setPendingSubtaskParent(parentId: string | null): void {
    if (parentId) {
      // Expand the parent so the inline input is visible
      set((state) => {
        const next = new Set(state.expandedTaskIds)
        next.add(parentId)
        return { pendingSubtaskParentId: parentId, expandedTaskIds: next }
      })
    } else {
      set({ pendingSubtaskParentId: null })
    }
  },

  setPendingDeleteTask(taskId: string | null): void {
    set({ pendingDeleteTaskId: taskId })
  },

  setMovingTask(taskId: string | null): void {
    set({ movingTaskId: taskId })
  },

  clearError(): void {
    set({ error: null })
  }
}), shallow)

// Selectors
export const selectTasksByProject = (projectId: string) => (state: TaskState): Task[] =>
  Object.values(state.tasks).filter((t) => t.project_id === projectId)

export const selectTasksByStatus = (statusId: string) => (state: TaskState): Task[] =>
  Object.values(state.tasks)
    .filter((t) => t.status_id === statusId)
    .sort((a, b) => a.order_index - b.order_index)

export const selectMyDayTasks = (state: TaskState): Task[] =>
  Object.values(state.tasks)
    .filter((t) => t.is_in_my_day === 1)
    .sort((a, b) => a.order_index - b.order_index)

export const selectArchivedTasks = (state: TaskState): Task[] =>
  Object.values(state.tasks).filter((t) => t.is_archived === 1)

export const selectSubtasks = (parentId: string) => (state: TaskState): Task[] =>
  Object.values(state.tasks)
    .filter((t) => t.parent_id === parentId)
    .sort((a, b) => a.order_index - b.order_index)

export const selectTopLevelTasks = (projectId: string) => (state: TaskState): Task[] =>
  Object.values(state.tasks).filter(
    (t) => t.project_id === projectId && t.parent_id === null
  )

export const selectExpandedTaskIds = (state: TaskState): Set<string> => state.expandedTaskIds

export const selectIsExpanded = (taskId: string) => (state: TaskState): boolean =>
  state.expandedTaskIds.has(taskId)

export const selectChildCount = (parentId: string) => (state: TaskState): { total: number; done: number } => {
  const children = Object.values(state.tasks).filter((t) => t.parent_id === parentId)
  const done = children.filter((t) => {
    // We check the task's completed_date as a proxy for "done"
    return t.completed_date !== null
  }).length
  return { total: children.length, done }
}

export const selectHasChildren = (taskId: string) => (state: TaskState): boolean =>
  Object.values(state.tasks).some((t) => t.parent_id === taskId)

export const selectCurrentTask = (state: TaskState): Task | null =>
  state.currentTaskId ? state.tasks[state.currentTaskId] ?? null : null

export const selectTaskLabels = (taskId: string) => (state: TaskState): Label[] =>
  state.taskLabels[taskId] ?? []

// Hooks — stable selectors for parameterized queries

function tasksArrayEqual(a: Task[], b: Task[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function labelsArrayEqual(a: Label[], b: Label[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function useTasksByProject(projectId: string): Task[] {
  const tasks = useTaskStore((s) => s.tasks)
  const prevRef = useRef<Task[]>([])
  return useMemo(() => {
    const next = Object.values(tasks).filter((t) => t.project_id === projectId)
    if (tasksArrayEqual(prevRef.current, next)) return prevRef.current
    prevRef.current = next
    return next
  }, [tasks, projectId])
}

export function useSubtasks(parentId: string): Task[] {
  const tasks = useTaskStore((s) => s.tasks)
  const prevRef = useRef<Task[]>([])
  return useMemo(() => {
    const next = Object.values(tasks)
      .filter((t) => t.parent_id === parentId)
      .sort((a, b) => a.order_index - b.order_index)
    if (tasksArrayEqual(prevRef.current, next)) return prevRef.current
    prevRef.current = next
    return next
  }, [tasks, parentId])
}

export function useChildCount(parentId: string): { total: number; done: number } {
  const tasks = useTaskStore((s) => s.tasks)
  const prevRef = useRef<{ total: number; done: number }>({ total: 0, done: 0 })
  return useMemo(() => {
    const children = Object.values(tasks).filter((t) => t.parent_id === parentId)
    const done = children.filter((t) => t.completed_date !== null).length
    const next = { total: children.length, done }
    if (prevRef.current.total === next.total && prevRef.current.done === next.done) return prevRef.current
    prevRef.current = next
    return next
  }, [tasks, parentId])
}

export function useTaskLabelsHook(taskId: string): Label[] {
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const prevRef = useRef<Label[]>([])
  return useMemo(() => {
    const next = taskLabels[taskId] ?? []
    if (labelsArrayEqual(prevRef.current, next)) return prevRef.current
    prevRef.current = next
    return next
  }, [taskLabels, taskId])
}
