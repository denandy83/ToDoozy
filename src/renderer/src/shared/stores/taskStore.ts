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
  selectedTaskIds: Set<string>
  lastSelectedTaskId: string | null
  showDetailPanel: boolean
  pendingSubtaskParentId: string | null
  pendingDeleteTaskId: string | null
  pendingBulkDeleteTaskIds: string[] | null
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
  saveTaskAsTemplate(id: string, newId: string): Promise<Task | null>
  reorderTasks(taskIds: string[]): Promise<void>
  createSubtask(parentId: string, input: CreateTaskInput): Promise<Task>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  hydrateTaskLabels(taskId: string): Promise<void>
  hydrateAllTaskLabels(projectId: string): Promise<void>
  setCurrentTask(id: string | null): void
  selectTask(id: string, options?: { fromContextMenu?: boolean }): void
  toggleTaskInSelection(id: string): void
  selectTaskRange(ids: string[]): void
  selectAllTasks(ids: string[]): void
  clearSelection(): void
  bulkUpdateTasks(ids: string[], input: UpdateTaskInput): Promise<void>
  bulkDeleteTasks(ids: string[]): Promise<void>
  bulkAddLabel(ids: string[], labelId: string): Promise<void>
  bulkRemoveLabel(ids: string[], labelId: string): Promise<void>
  setPendingBulkDeleteTasks(ids: string[] | null): void
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
  selectedTaskIds: new Set<string>(),
  lastSelectedTaskId: null,
  showDetailPanel: false,
  pendingSubtaskParentId: null,
  pendingDeleteTaskId: null,
  pendingBulkDeleteTaskIds: null,
  movingTaskId: null,
  loading: false,
  error: null,

  async hydrateTasks(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const tasks = await window.api.tasks.findByProjectId(projectId)
      set((state) => {
        const updated: Record<string, Task> = {}
        for (const [id, t] of Object.entries(state.tasks)) {
          if (t.project_id !== projectId) updated[id] = t
        }
        for (const task of tasks) {
          updated[task.id] = task
        }
        return { tasks: updated, loading: false }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks'
      set({ error: message, loading: false })
    }
  },

  async hydrateMyDay(userId: string): Promise<void> {
    try {
      const tasks = await window.api.tasks.findMyDay(userId)
      set((state) => {
        const updated = { ...state.tasks }
        for (const task of tasks) {
          updated[task.id] = task
        }
        return { tasks: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load My Day tasks'
      set({ error: message })
    }
  },

  async hydrateArchived(projectId: string): Promise<void> {
    try {
      const tasks = await window.api.tasks.findArchived(projectId)
      set((state) => {
        const updated = { ...state.tasks }
        for (const task of tasks) {
          updated[task.id] = task
        }
        return { tasks: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load archived tasks'
      set({ error: message })
    }
  },

  async hydrateTemplates(_projectId: string): Promise<void> {
    try {
      const tasks = await window.api.tasks.findAllTemplates()
      set((state) => {
        const updated = { ...state.tasks }
        for (const task of tasks) {
          updated[task.id] = task
        }
        return { tasks: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load templates'
      set({ error: message })
    }
  },

  async hydrateAllForProject(projectId: string, userId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      // Load all projects' tasks for accurate sidebar counts
      const allProjects = await window.api.projects.getProjectsForUser(userId)
      const projectTaskPromises = allProjects.map((p) => window.api.tasks.findByProjectId(p.id))
      const [myDay, archived, templates, ...projectTasks] = await Promise.all([
        window.api.tasks.findMyDay(userId),
        window.api.tasks.findArchived(projectId),
        window.api.tasks.findAllTemplates(),
        ...projectTaskPromises
      ])
      const taskMap: Record<string, Task> = {}
      for (const tasks of projectTasks) {
        for (const task of tasks) taskMap[task.id] = task
      }
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

        // Cascade archive/unarchive to subtasks in store
        if (input.is_archived !== undefined) {
          const subtasks = await window.api.tasks.findSubtasks(id)
          if (subtasks.length > 0) {
            set((state) => {
              const updated = { ...state.tasks }
              for (const st of subtasks) {
                updated[st.id] = st
              }
              return { tasks: updated }
            })
          }
        }

        // When adding a subtask to My Day, also add its parent
        if (input.is_in_my_day === 1 && task.parent_id) {
          const parent = get().tasks[task.parent_id]
          if (parent && parent.is_in_my_day !== 1) {
            const updatedParent = await window.api.tasks.update(parent.id, { is_in_my_day: 1 })
            if (updatedParent) {
              set((state) => ({
                tasks: { ...state.tasks, [updatedParent.id]: updatedParent }
              }))
            }
          }
        }
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
      // Collect task IDs to clean up attachment files before DB cascade
      const idsForCleanup: string[] = [id]
      const collectChildIds = (parentId: string): void => {
        for (const task of Object.values(get().tasks)) {
          if (task.parent_id === parentId) {
            idsForCleanup.push(task.id)
            collectChildIds(task.id)
          }
        }
      }
      collectChildIds(id)

      const result = await window.api.tasks.delete(id)
      if (result) {
        // Clean up attachment files on disk (fire and forget)
        for (const tid of idsForCleanup) {
          window.api.fs.deleteTaskAttachmentDirs(tid).catch((err: unknown) =>
            console.error('Failed to clean attachment dirs for task:', tid, err)
          )
        }

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

          const newSelected = new Set(state.selectedTaskIds)
          for (const rid of idsToRemove) newSelected.delete(rid)

          return {
            tasks: remaining,
            taskLabels: remainingLabels,
            expandedTaskIds: newExpanded,
            selectedTaskIds: newSelected,
            lastSelectedTaskId: idsToRemove.has(state.lastSelectedTaskId ?? '') ? null : state.lastSelectedTaskId
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
        // Re-hydrate all tasks for the project since subtasks were also created
        const allTasks = await window.api.tasks.findByProjectId(task.project_id)
        const taskMap: Record<string, Task> = {}
        for (const t of allTasks) {
          taskMap[t.id] = t
        }
        set((state) => ({ tasks: { ...state.tasks, ...taskMap } }))

        // Also hydrate labels for the new task and its subtasks
        const newTaskLabels = await window.api.labels.findByTaskId(task.id)
        const subtasks = await window.api.tasks.findSubtasks(task.id)
        const labelUpdates: Record<string, import('../../../../shared/types').Label[]> = {
          [task.id]: newTaskLabels
        }
        for (const st of subtasks) {
          labelUpdates[st.id] = await window.api.labels.findByTaskId(st.id)
        }
        set((state) => ({ taskLabels: { ...state.taskLabels, ...labelUpdates } }))
      }
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate task'
      set({ error: message })
      throw err
    }
  },

  async saveTaskAsTemplate(id: string, newId: string): Promise<Task | null> {
    try {
      const template = await window.api.tasks.saveAsTemplate(id, newId)
      if (template) {
        // Re-hydrate templates globally
        const allTemplates = await window.api.tasks.findAllTemplates()
        set((state) => {
          const updated = { ...state.tasks }
          for (const t of allTemplates) {
            updated[t.id] = t
          }
          return { tasks: updated }
        })
      }
      return template
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save as template'
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
    if (id === null) {
      set({ selectedTaskIds: new Set<string>(), lastSelectedTaskId: null, showDetailPanel: false })
    } else {
      set({ selectedTaskIds: new Set<string>([id]), lastSelectedTaskId: id, showDetailPanel: true })
    }
  },

  selectTask(id: string, options?: { fromContextMenu?: boolean }): void {
    const keepPanel = options?.fromContextMenu ? get().showDetailPanel : true
    set({ selectedTaskIds: new Set<string>([id]), lastSelectedTaskId: id, showDetailPanel: keepPanel })
  },

  toggleTaskInSelection(id: string): void {
    set((state) => {
      const next = new Set(state.selectedTaskIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { selectedTaskIds: next, lastSelectedTaskId: id }
    })
  },

  selectTaskRange(ids: string[]): void {
    set((state) => {
      const next = new Set(state.selectedTaskIds)
      for (const id of ids) next.add(id)
      const lastId = ids.length > 0 ? ids[ids.length - 1] : state.lastSelectedTaskId
      return { selectedTaskIds: next, lastSelectedTaskId: lastId }
    })
  },

  selectAllTasks(ids: string[]): void {
    set({ selectedTaskIds: new Set<string>(ids) })
  },

  clearSelection(): void {
    set({ selectedTaskIds: new Set<string>(), lastSelectedTaskId: null, showDetailPanel: false })
  },

  async bulkUpdateTasks(ids: string[], input: UpdateTaskInput): Promise<void> {
    try {
      const results = await Promise.all(
        ids.map((id) => window.api.tasks.update(id, input))
      )
      set((state) => {
        const updated = { ...state.tasks }
        for (const task of results) {
          if (task) updated[task.id] = task
        }
        return { tasks: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to bulk update tasks'
      set({ error: message })
      throw err
    }
  },

  async bulkDeleteTasks(ids: string[]): Promise<void> {
    try {
      await Promise.all(ids.map((id) => window.api.tasks.delete(id)))
      set((state) => {
        const idsToRemove = new Set<string>(ids)
        // Collect descendants
        const collectChildren = (parentId: string): void => {
          for (const task of Object.values(state.tasks)) {
            if (task.parent_id === parentId && !idsToRemove.has(task.id)) {
              idsToRemove.add(task.id)
              collectChildren(task.id)
            }
          }
        }
        for (const id of ids) collectChildren(id)

        const remaining: Record<string, Task> = {}
        const remainingLabels: Record<string, Label[]> = {}
        for (const [tid, task] of Object.entries(state.tasks)) {
          if (!idsToRemove.has(tid)) remaining[tid] = task
        }
        for (const [tid, labels] of Object.entries(state.taskLabels)) {
          if (!idsToRemove.has(tid)) remainingLabels[tid] = labels
        }
        const newExpanded = new Set(state.expandedTaskIds)
        const newSelected = new Set(state.selectedTaskIds)
        for (const rid of idsToRemove) {
          newExpanded.delete(rid)
          newSelected.delete(rid)
        }
        return {
          tasks: remaining,
          taskLabels: remainingLabels,
          expandedTaskIds: newExpanded,
          selectedTaskIds: newSelected,
          lastSelectedTaskId: idsToRemove.has(state.lastSelectedTaskId ?? '') ? null : state.lastSelectedTaskId
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to bulk delete tasks'
      set({ error: message })
      throw err
    }
  },

  async bulkAddLabel(ids: string[], labelId: string): Promise<void> {
    try {
      await Promise.all(ids.map((id) => window.api.tasks.addLabel(id, labelId)))
      // Re-hydrate labels for affected tasks
      const labelResults: Record<string, Label[]> = {}
      for (const id of ids) {
        labelResults[id] = await window.api.labels.findByTaskId(id)
      }
      set((state) => ({
        taskLabels: { ...state.taskLabels, ...labelResults }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add label to tasks'
      set({ error: message })
      throw err
    }
  },

  async bulkRemoveLabel(ids: string[], labelId: string): Promise<void> {
    try {
      await Promise.all(ids.map((id) => window.api.tasks.removeLabel(id, labelId)))
      const labelResults: Record<string, Label[]> = {}
      for (const id of ids) {
        labelResults[id] = await window.api.labels.findByTaskId(id)
      }
      set((state) => ({
        taskLabels: { ...state.taskLabels, ...labelResults }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove label from tasks'
      set({ error: message })
      throw err
    }
  },

  setPendingBulkDeleteTasks(ids: string[] | null): void {
    set({ pendingBulkDeleteTaskIds: ids })
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

export const selectCurrentTaskId = (state: TaskState): string | null => {
  if (state.selectedTaskIds.size === 1) {
    const [id] = state.selectedTaskIds
    return id
  }
  return null
}

export const selectCurrentTask = (state: TaskState): Task | null => {
  const id = selectCurrentTaskId(state)
  return id ? state.tasks[id] ?? null : null
}

export const selectSelectedTaskIds = (state: TaskState): Set<string> => state.selectedTaskIds

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
