import { create } from 'zustand'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Label
} from '../../../../shared/types'

interface TaskState {
  tasks: Record<string, Task>
  taskLabels: Record<string, Label[]>
  currentTaskId: string | null
  loading: boolean
  error: string | null
}

interface TaskActions {
  hydrateTasks(projectId: string): Promise<void>
  hydrateMyDay(userId: string): Promise<void>
  hydrateArchived(projectId: string): Promise<void>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>
  deleteTask(id: string): Promise<boolean>
  duplicateTask(id: string, newId: string): Promise<Task | null>
  reorderTasks(taskIds: string[]): Promise<void>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  hydrateTaskLabels(taskId: string): Promise<void>
  setCurrentTask(id: string | null): void
  clearError(): void
}

export type TaskStore = TaskState & TaskActions

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: {},
  taskLabels: {},
  currentTaskId: null,
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
          const { [id]: _, ...remaining } = state.tasks
          const { [id]: __, ...remainingLabels } = state.taskLabels
          return {
            tasks: remaining,
            taskLabels: remainingLabels,
            currentTaskId: state.currentTaskId === id ? null : state.currentTaskId
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

  setCurrentTask(id: string | null): void {
    set({ currentTaskId: id })
  },

  clearError(): void {
    set({ error: null })
  }
}))

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

export const selectCurrentTask = (state: TaskState): Task | null =>
  state.currentTaskId ? state.tasks[state.currentTaskId] ?? null : null

export const selectTaskLabels = (taskId: string) => (state: TaskState): Label[] =>
  state.taskLabels[taskId] ?? []
