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
import { useSettingsStore } from './settingsStore'
import { useAuthStore } from './authStore'

function getUserId(): string {
  return useAuthStore.getState().currentUser?.id ?? ''
}

function logTaskActivity(taskId: string, action: string, oldValue: string | null, newValue: string | null): void {
  const userId = getUserId()
  if (!userId) return
  window.api.activityLog.create({
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    action,
    old_value: oldValue,
    new_value: newValue
  }).catch(() => {})
}

// Sync task changes to Supabase for ALL projects (shared and personal)
async function syncIfShared(task: Task, operation: 'INSERT' | 'UPDATE' | 'DELETE'): Promise<void> {
  try {
    const project = await window.api.projects.findById(task.project_id)
    if (!project) return

    if (project.is_shared === 1) {
      // Shared project — use existing SyncService (handles Realtime, offline queue)
      const { syncTaskChange } = await import('../../services/SyncService')
      let labelData: Array<{ name: string; color: string }> | undefined
      if (operation !== 'DELETE') {
        const taskLabels = await window.api.tasks.getLabels(task.id)
        labelData = []
        for (const tl of taskLabels) {
          const label = await window.api.labels.findById(tl.label_id)
          if (label) labelData.push({ name: label.name, color: label.color })
        }
      }
      await syncTaskChange(task, operation, labelData)
    } else {
      // Personal project — push to Supabase via PersonalSyncService
      const { pushTask, deleteTaskFromSupabase } = await import('../../services/PersonalSyncService')
      if (operation === 'DELETE') {
        await deleteTaskFromSupabase(task.id)
      } else {
        await pushTask(task)
      }
    }
  } catch (err) {
    console.error('[TaskStore] Failed to sync task to Supabase:', err)
  }
}

interface RecurringCloneResult {
  taskId: string
  dueDate: string
  projectId: string
}

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
  lastRecurringClone: RecurringCloneResult | null
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
  navigateTask(id: string): void
  selectTask(id: string, options?: { fromContextMenu?: boolean; openPanel?: boolean }): void
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
  clearLastRecurringClone(): void
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
  lastRecurringClone: null,
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
      // Auto-add tasks based on due date setting
      const { getSetting } = useSettingsStore.getState()
      const autoAddMode = getSetting('myday_auto_add') ?? 'due_today'
      if (autoAddMode !== 'off') {
        await window.api.tasks.autoAddMyDay(userId, autoAddMode)
      }

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
      const tasks = await window.api.tasks.findAllTemplates(getUserId())
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

  async hydrateAllForProject(_projectId: string, userId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      // Load all projects' tasks for accurate sidebar counts
      const allProjects = await window.api.projects.getProjectsForUser(userId)
      const projectTaskPromises = allProjects.map((p) => window.api.tasks.findByProjectId(p.id))
      const archivedPromises = allProjects.map((p) => window.api.tasks.findArchived(p.id))
      const [myDay, templates, ...rest] = await Promise.all([
        window.api.tasks.findMyDay(userId),
        window.api.tasks.findAllTemplates(getUserId()),
        ...projectTaskPromises,
        ...archivedPromises
      ])
      const taskMap: Record<string, Task> = {}
      for (const tasks of rest) {
        for (const task of tasks) taskMap[task.id] = task
      }
      for (const task of myDay) taskMap[task.id] = task
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
      syncIfShared(task, 'INSERT')
      logTaskActivity(task.id, 'created', null, null)
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task'
      set({ error: message })
      throw err
    }
  },

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    try {
      const oldTask = get().tasks[id]
      const task = await window.api.tasks.update(id, input)
      if (task) {
        set((state) => ({
          tasks: { ...state.tasks, [task.id]: task }
        }))

        // Log activity for each changed field
        if (oldTask) {
          if (input.title !== undefined && input.title !== oldTask.title) {
            logTaskActivity(id, 'title_changed', oldTask.title, input.title)
          }
          if (input.status_id !== undefined && input.status_id !== oldTask.status_id) {
            const [oldStatus, newStatus] = await Promise.all([
              window.api.statuses.findById(oldTask.status_id),
              window.api.statuses.findById(input.status_id)
            ])
            logTaskActivity(id, 'status_changed', oldStatus?.name ?? '', newStatus?.name ?? '')
            window.api.tray.refresh()
          }
          if (input.priority !== undefined && input.priority !== oldTask.priority) {
            const names = ['None', 'Low', 'Normal', 'High', 'Urgent']
            logTaskActivity(id, 'priority_changed', names[oldTask.priority] ?? '', names[input.priority] ?? '')
          }
          if (input.due_date !== undefined && input.due_date !== oldTask.due_date) {
            logTaskActivity(id, 'due_date_changed', oldTask.due_date ?? '', input.due_date ?? '')
          }
          if (input.is_archived !== undefined && input.is_archived !== oldTask.is_archived) {
            logTaskActivity(id, input.is_archived === 1 ? 'archived' : 'unarchived', null, null)
          }
          if (input.assigned_to !== undefined && input.assigned_to !== oldTask.assigned_to) {
            logTaskActivity(id, 'assigned', oldTask.assigned_to ?? '', input.assigned_to ?? 'unassigned')
          }
          if (input.recurrence_rule !== undefined && input.recurrence_rule !== oldTask.recurrence_rule) {
            logTaskActivity(id, 'recurrence_changed', oldTask.recurrence_rule ?? '', input.recurrence_rule ?? '')
          }
          if (input.reference_url !== undefined && input.reference_url !== oldTask.reference_url) {
            logTaskActivity(id, 'reference_url_changed', oldTask.reference_url ?? '', input.reference_url ?? '')
          }
          if (input.is_in_my_day !== undefined && input.is_in_my_day !== oldTask.is_in_my_day) {
            logTaskActivity(id, input.is_in_my_day === 1 ? 'pinned_to_my_day' : 'unpinned_from_my_day', null, null)
            window.api.tray.refresh()
          }
          if (input.project_id !== undefined && input.project_id !== oldTask.project_id) {
            logTaskActivity(id, 'moved_to_project', oldTask.project_id, input.project_id)
          }
        }

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

        // Check if a recurring task was moved to done status → create clone
        if (input.status_id && task.recurrence_rule) {
          const status = await window.api.statuses.findById(input.status_id)
          if (status && status.is_done === 1) {
            try {
              const result = await window.api.tasks.completeRecurring(task.id)
              if (result) {
                // Load the new task into the store
                const newTask = await window.api.tasks.findById(result.id)
                if (newTask) {
                  set((state) => ({
                    tasks: { ...state.tasks, [newTask.id]: newTask },
                    lastRecurringClone: { taskId: result.id, dueDate: result.dueDate, projectId: newTask.project_id }
                  }))
                  // Also load subtasks of the new task
                  const subtasks = await window.api.tasks.findSubtasks(result.id)
                  if (subtasks.length > 0) {
                    set((state) => {
                      const updated = { ...state.tasks }
                      for (const st of subtasks) updated[st.id] = st
                      return { tasks: updated }
                    })
                  }
                  // Load labels for the new task
                  const labels = await window.api.labels.findByTaskId(result.id)
                  set((state) => ({
                    taskLabels: { ...state.taskLabels, [result.id]: labels }
                  }))
                }
              }
            } catch (err) {
              console.error('Failed to create recurring task clone:', err)
            }
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
        syncIfShared(task, 'UPDATE')
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
      // Capture task before deletion for sync
      const taskToDelete = get().tasks[id]
      if (taskToDelete) logTaskActivity(id, 'deleted', taskToDelete.title, null)

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
        if (taskToDelete) syncIfShared(taskToDelete, 'DELETE')
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

        // Sync duplicated task + subtasks to Supabase
        syncIfShared(task, 'INSERT')
        for (const st of subtasks) {
          syncIfShared(st, 'INSERT')
        }
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
        const allTemplates = await window.api.tasks.findAllTemplates(getUserId())
        set((state) => {
          const updated = { ...state.tasks }
          for (const t of allTemplates) {
            updated[t.id] = t
          }
          return { tasks: updated }
        })

        // Sync template to Supabase
        syncIfShared(template, 'INSERT')
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
      // Sync reordered tasks to Supabase
      const currentTasks = get().tasks
      for (const id of taskIds) {
        const task = currentTasks[id]
        if (task) syncIfShared(task, 'UPDATE')
      }
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
      syncIfShared(task, 'INSERT')
      logTaskActivity(task.id, 'created', null, null)
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
      const labels = get().taskLabels[taskId] ?? []
      const added = labels.find((l) => l.id === labelId)
      logTaskActivity(taskId, 'label_added', null, added?.name ?? labelId)
      // Sync task to Supabase (label_names changed)
      const task = get().tasks[taskId]
      if (task) syncIfShared(task, 'UPDATE')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add label'
      set({ error: message })
      throw err
    }
  },

  async removeLabel(taskId: string, labelId: string): Promise<boolean> {
    try {
      const labels = get().taskLabels[taskId] ?? []
      const removed = labels.find((l) => l.id === labelId)
      const result = await window.api.tasks.removeLabel(taskId, labelId)
      await get().hydrateTaskLabels(taskId)
      if (result) {
        logTaskActivity(taskId, 'label_removed', removed?.name ?? labelId, null)
        // Sync task to Supabase (label_names changed)
        const task = get().tasks[taskId]
        if (task) syncIfShared(task, 'UPDATE')
      }
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

  // Navigate to a task without affecting showDetailPanel (for Tab key navigation)
  navigateTask(id: string): void {
    set({ selectedTaskIds: new Set<string>([id]), lastSelectedTaskId: id })
  },

  selectTask(id: string, options?: { fromContextMenu?: boolean; openPanel?: boolean }): void {
    const currentlyOpen = get().showDetailPanel
    const showPanel = options?.fromContextMenu
      ? currentlyOpen
      : currentlyOpen || (options?.openPanel ?? true)
    set({ selectedTaskIds: new Set<string>([id]), lastSelectedTaskId: id, showDetailPanel: showPanel })
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
      // Sync all updated tasks to Supabase
      for (const task of results) {
        if (task) syncIfShared(task, 'UPDATE')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to bulk update tasks'
      set({ error: message })
      throw err
    }
  },

  async bulkDeleteTasks(ids: string[]): Promise<void> {
    try {
      // Capture tasks before deletion for sync
      const tasksToDelete = ids.map((id) => get().tasks[id]).filter(Boolean) as Task[]
      await Promise.all(ids.map((id) => window.api.tasks.delete(id)))
      // Sync deletions to Supabase
      for (const task of tasksToDelete) {
        syncIfShared(task, 'DELETE')
      }
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
      // Sync affected tasks to Supabase (label_names changed)
      for (const id of ids) {
        const task = get().tasks[id]
        if (task) syncIfShared(task, 'UPDATE')
      }
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
      // Sync affected tasks to Supabase (label_names changed)
      for (const id of ids) {
        const task = get().tasks[id]
        if (task) syncIfShared(task, 'UPDATE')
      }
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
  },

  clearLastRecurringClone(): void {
    set({ lastRecurringClone: null })
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
