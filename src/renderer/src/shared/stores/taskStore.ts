import { withSyncProducer, captureSyncProducer, captureProjectProducer, requireProducerCurrent, type SyncProducer } from '../../services/syncContext'
import { reportPushFailure } from '../../services/syncFeedback'
import { type HydrationOrigin, hydrationContext } from './hydrationContext'
import { evictProjectData } from './projectCache'
import { useMemo, useRef } from 'react'
import { sortSubtasksForDisplay } from '../utils/sortTasks'
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
import { useLabelStore } from './labelStore'
import { useProjectStore } from './projectStore'
import { useStatusStore } from './statusStore'
import { deduplicateLabelsByName, remapLabelsToCurrentUser } from '../utils/labelUtils'
import * as TaskBatchSyncManager from '../../services/TaskBatchSyncManager'

function getUserId(): string {
  return useAuthStore.getState().currentUser?.id ?? ''
}

/**
 * Per-user label invariant (#d5b138b1): a task_labels row a user creates must
 * point at a label that user OWNS — never another member's label id. When
 * applying a label owned by someone else (picked from a shared project's
 * palette, or the cross-user display remap fell back to the foreign row),
 * resolve to the current user's OWN same-name label, materializing it (copying
 * the color) if they don't have one yet. Returns the label id to actually link.
 * Mine-already / legacy-null-owner / unknown ids pass through unchanged.
 */
async function resolveLabelForCurrentUser(labelId: string, origin: SyncProducer): Promise<string> {
  const userId = origin.userId ?? ''
  if (!userId) return labelId
  const label = await origin.api.labels.findById(labelId).catch(() => null)
  if (!label || label.user_id === userId || label.user_id == null) return labelId
  const mine = await origin.api.labels.findByName(userId, label.name).catch(() => null)
  if (mine) {
    return mine.id
  }
  const created = await origin.api.labels.adopt(userId, label)
  await requireProducerCurrent(origin)
  useLabelStore.setState((state) => ({ labels: { ...state.labels, [created.id]: created } }))
  return created.id
}

function logTaskActivity(taskId: string, action: string, oldValue: string | null, newValue: string | null, origin: SyncProducer): void {
  const userId = origin.userId ?? ''
  if (!userId) return
  origin.api.activityLog.create({
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    action,
    old_value: oldValue,
    new_value: newValue
  }).catch(() => {})
}

/**
 * Tell the saved-view store to refresh its sidebar counts (debounced 1s).
 * Called after any task mutation that can change which tasks match a view's
 * filter (create/update/delete/archive/label add+remove, bulk variants).
 * Dynamic import avoids a static taskStore → savedViewStore → viewStore →
 * taskStore cycle; the recount is debounced so the import latency is irrelevant.
 */
function scheduleSavedViewRecount(origin: SyncProducer): void {
  const userId = origin.userId ?? ''
  if (!userId) return
  import('./savedViewStore')
    .then(async ({ useSavedViewStore }) => { if (await origin.isCurrent()) useSavedViewStore.getState().scheduleRecount(userId, origin) })
    .catch(() => {})
}

// Sync task changes to Supabase for ALL projects (shared and personal).
// Exported for TaskBatchSyncManager, which flushes batched detail-panel
// edits through the same shared/personal routing (story #92).
export async function syncIfShared(task: Task, operation: 'INSERT' | 'UPDATE' | 'DELETE', producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
  try {
    const project = await origin.api.projects.findById(task.project_id)
    if (!project) return

    if (project.is_shared === 1) {
      // Shared project — use existing SyncService (handles Realtime, offline queue)
      const { syncTaskChange } = await import('../../services/SyncService')
      let labelData: Array<{ name: string; color: string }> | undefined
      if (operation !== 'DELETE') {
        const links = await origin.api.tasks.getLabels(task.id)
        labelData = []
        for (const link of links) {
          const label = await origin.api.labels.findById(link.label_id)
          if (label) labelData.push({ name: label.name, color: label.color })
        }
      }
      await syncTaskChange(task, operation, labelData, origin)
    } else {
      // Personal project — push to Supabase via PersonalSyncService
      const { pushTask, deleteTaskFromSupabase } = await import('../../services/PersonalSyncService')
      if (operation === 'DELETE') {
        await deleteTaskFromSupabase(task.id, origin)
      } else {
        await pushTask(task, origin)
      }
    }
  } catch (err) {
    await reportPushFailure(origin, 'syncIfShared', err, 'tasks', task.id, JSON.stringify(task), operation)
  }
  }, producer ?? captureProjectProducer(task.project_id))
}

async function publishCreatedSubtree(root: Task, origin: SyncProducer): Promise<void> {
  const children = new Map<string, Task[]>()
  for (const task of await origin.api.tasks.findAllByProject(root.project_id)) {
    if (task.parent_id) children.set(task.parent_id, [...(children.get(task.parent_id) ?? []), task])
  }
  const tasks = [root]
  const seen = new Set([root.id])
  const labels: Record<string, Label[]> = {}
  for (const task of tasks) {
    labels[task.id] = await origin.api.labels.findByTaskId(task.id)
    for (const child of children.get(task.id) ?? []) {
      if (!seen.has(child.id)) { seen.add(child.id); tasks.push(child) }
    }
  }
  await requireProducerCurrent(origin)
  useTaskStore.setState((state) => ({
    tasks: { ...state.tasks, ...Object.fromEntries(tasks.map((task) => [task.id, task])) },
    taskLabels: { ...state.taskLabels, ...labels }
  }))
  for (const task of tasks) {
    await requireProducerCurrent(origin)
    await syncIfShared(task, 'INSERT', origin)
  }
}

/**
 * Ops that must reach Supabase immediately even while the task is open in
 * the Detail panel: archive/unarchive, completion, and My Day membership —
 * the tray and other devices read these live. Everything else batches until
 * a panel boundary (story #92).
 */
function isImmediateOp(input: UpdateTaskInput): boolean {
  if (input.is_archived !== undefined) return true
  if (input.is_in_my_day !== undefined) return true
  if (input.status_id !== undefined) {
    const status = useStatusStore.getState().statuses[input.status_id]
    if (status?.is_done === 1) return true
    // Status not hydrated (cross-project views): completed_date is only ever
    // set alongside a done status, so a non-null value means completion.
    if (typeof input.completed_date === 'string') return true
  }
  return false
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
  pendingScrollTaskId: string | null
  /** Per-task counter bumped when a remote activity_log row lands — the
   * Detail panel's activity list re-fetches when its task's counter moves. */
  activityRefresh: Record<string, number>
  loading: boolean
  error: string | null
}

interface TaskActions {
  hydrateTasks(projectId: string): Promise<void>
  hydrateMyDay(userId: string, origin?: HydrationOrigin): Promise<void>
  hydrateArchived(projectId: string): Promise<void>
  hydrateTemplates(projectId: string): Promise<void>
  hydrateAllForProject(projectId: string, origin?: Pick<SyncProducer, 'api' | 'isCurrent'>): Promise<void>
  hydrateAllForUser(userId: string, origin?: HydrationOrigin): Promise<void>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>
  deleteTask(id: string): Promise<boolean>
  duplicateTask(id: string, newId: string): Promise<Task | null>
  saveTaskAsTemplate(id: string, newId: string): Promise<Task | null>
  reorderTasks(taskIds: string[]): Promise<void>
  createSubtask(parentId: string, input: CreateTaskInput): Promise<Task>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  hydrateTaskLabels(taskId: string, producer?: SyncProducer): Promise<void>
  hydrateAllTaskLabels(projectId: string, origin?: HydrationOrigin): Promise<void>
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
  setPendingScrollTask(taskId: string | null): void
  bumpActivityRefresh(taskId: string): void
  clearError(): void
  clearLastRecurringClone(): void
}

export type TaskStore = TaskState & TaskActions

function mergeHydratedTasks(state: TaskStore, initial: TaskStore, projectIds: Set<string>, taskArrays: Task[][], isProjectCurrent: (id: string) => boolean, labelMappingArrays?: TaskLabelMapping[][]): Pick<TaskStore, 'tasks' | 'taskLabels'> {
  projectIds = new Set([...projectIds].filter(isProjectCurrent))
  const tasks = Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => !projectIds.has(task.project_id)))
  for (const rows of taskArrays) for (const task of rows) if (isProjectCurrent(task.project_id) && !task.deleted_at) tasks[task.id] = task
  for (const [id, task] of Object.entries(state.tasks)) if (task !== initial.tasks[id]) tasks[id] = task
  for (const id of Object.keys(initial.tasks)) if (!state.tasks[id]) delete tasks[id]
  if (!labelMappingArrays) return { tasks, taskLabels: state.taskLabels }
  const taskLabels = Object.fromEntries(Object.entries(state.taskLabels).filter(([id]) => !projectIds.has(state.tasks[id]?.project_id ?? initial.tasks[id]?.project_id)))
  const grouped: Record<string, Label[]> = {}
  for (const mappings of labelMappingArrays) {
    for (const { task_id, ...label } of mappings) {
      if (tasks[task_id] && isProjectCurrent(tasks[task_id].project_id)) (grouped[task_id] ??= []).push(label)
    }
  }
  Object.assign(taskLabels, grouped)
  for (const [id, labels] of Object.entries(state.taskLabels)) if (labels !== initial.taskLabels[id]) taskLabels[id] = labels
  for (const id of Object.keys(initial.tasks)) if (projectIds.has(initial.tasks[id].project_id) && !tasks[id]) delete taskLabels[id]
  return { tasks, taskLabels }
}

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
  pendingScrollTaskId: null,
  activityRefresh: {},
  loading: false,
  error: null,

  async hydrateTasks(projectId: string): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(undefined, projectId, getUserId())
    const initial = get()
    try {
      if (!await isCurrent()) return
      assertCurrent()
      set({ loading: true, error: null })
      const tasks = await api.tasks.findByProjectId(projectId)
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => ({ ...mergeHydratedTasks(state, initial, new Set([projectId]), [tasks], isProjectCurrent), loading: false }))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load tasks', loading: false })
    }
  },

  async hydrateMyDay(userId: string, origin?: HydrationOrigin): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(origin, undefined, userId)
    const initial = get()
    try {
      const { getSetting } = useSettingsStore.getState()
      const autoAddMode = getSetting('myday_auto_add') ?? 'due_today'
      if (autoAddMode !== 'off') await api.tasks.autoAddMyDay(userId, autoAddMode)
      const tasks = await api.tasks.findMyDay(userId)
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => mergeHydratedTasks(state, initial, new Set(), [tasks], isProjectCurrent))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load My Day tasks' })
    }
  },

  async hydrateArchived(projectId: string): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(undefined, projectId, getUserId())
    const initial = get()
    try {
      const tasks = await api.tasks.findArchived(projectId)
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => mergeHydratedTasks(state, initial, new Set(), [tasks], isProjectCurrent))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load archived tasks' })
    }
  },

  async hydrateTemplates(_projectId: string): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext()
    const initial = get()
    try {
      const tasks = await api.tasks.findAllTemplates(getUserId())
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => mergeHydratedTasks(state, initial, new Set(), [tasks], isProjectCurrent))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load templates' })
    }
  },

  async hydrateAllForProject(projectId: string, origin?: Pick<SyncProducer, 'api' | 'isCurrent'>): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(origin, projectId, getUserId())
    const initial = get()
    try {
      if (!await isCurrent()) return
      assertCurrent()
      const [tasks, mappings] = await Promise.all([
        api.tasks.findAllByProject(projectId, { includeTombstones: true }),
        api.labels.findTaskLabelsByProject(projectId)
      ])
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => mergeHydratedTasks(state, initial, new Set([projectId]), [tasks], isProjectCurrent, [mappings]))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load project tasks' })
    }
  },

  async hydrateAllForUser(userId: string, origin?: HydrationOrigin): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(origin, undefined, userId)
    const initial = get()
    try {
      const allProjects = await api.projects.getProjectsForUser(userId)
      const [taskArrays, labelMappingArrays] = await Promise.all([
        Promise.all(allProjects.map((p) => api.tasks.findAllByProject(p.id, { includeTombstones: true }))),
        Promise.all(allProjects.map((p) => api.labels.findTaskLabelsByProject(p.id)))
      ])
      if (!await isCurrent()) return
      assertCurrent()
      const activeIds = new Set(allProjects.map(project => project.id))
      for (const id of new Set(Object.values(initial.tasks).map(task => task.project_id))) if (!activeIds.has(id) && isProjectCurrent(id)) evictProjectData(id)
      set((state) => mergeHydratedTasks(state, initial, activeIds, taskArrays, isProjectCurrent, labelMappingArrays))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load tasks for user' })
    }
  },

  async createTask(input: CreateTaskInput): Promise<Task> {
    const origin = captureProjectProducer(input.project_id)
    const api = origin.api
    try {
      const task = await api.tasks.create(input)
      await requireProducerCurrent(origin)
      set((state) => ({
        tasks: { ...state.tasks, [task.id]: task }
      }))
      syncIfShared(task, 'INSERT', origin)
      logTaskActivity(task.id, 'created', null, null, origin)
      scheduleSavedViewRecount(origin)
      await requireProducerCurrent(origin)
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task'
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const origin = captureProjectProducer(get().tasks[id]?.project_id)
    const api = origin.api
    try {
      const oldTask = get().tasks[id] ?? await api.tasks.findById(id)
      if (oldTask) origin.includeProject(oldTask.project_id)
      if (input.project_id) origin.includeProject(input.project_id)
      const task = await api.tasks.update(id, input)
      if (task) {
        await requireProducerCurrent(origin)
        set((state) => ({
          tasks: { ...state.tasks, [task.id]: task }
        }))

        // Log activity for each changed field
        if (oldTask) {
          if (input.title !== undefined && input.title !== oldTask.title) {
            logTaskActivity(id, 'title_changed', oldTask.title, input.title, origin)
          }
          if (input.status_id !== undefined && input.status_id !== oldTask.status_id) {
            const [oldStatus, newStatus] = await Promise.all([
              api.statuses.findById(oldTask.status_id),
              api.statuses.findById(input.status_id)
            ])
            logTaskActivity(id, 'status_changed', oldStatus?.name ?? '', newStatus?.name ?? '', origin)
            await requireProducerCurrent(origin)
            window.api.tray.refresh()
          }
          if (input.priority !== undefined && input.priority !== oldTask.priority) {
            const names = ['None', 'Low', 'Normal', 'High', 'Urgent']
            logTaskActivity(id, 'priority_changed', names[oldTask.priority] ?? '', names[input.priority] ?? '', origin)
          }
          if (input.due_date !== undefined && input.due_date !== oldTask.due_date) {
            logTaskActivity(id, 'due_date_changed', oldTask.due_date ?? '', input.due_date ?? '', origin)
          }
          if (input.is_archived !== undefined && input.is_archived !== oldTask.is_archived) {
            logTaskActivity(id, input.is_archived === 1 ? 'archived' : 'unarchived', null, null, origin)
          }
          if (input.assigned_to !== undefined && input.assigned_to !== oldTask.assigned_to) {
            logTaskActivity(id, 'assigned', oldTask.assigned_to ?? '', input.assigned_to ?? 'unassigned', origin)
          }
          if (input.recurrence_rule !== undefined && input.recurrence_rule !== oldTask.recurrence_rule) {
            logTaskActivity(id, 'recurrence_changed', oldTask.recurrence_rule ?? '', input.recurrence_rule ?? '', origin)
          }
          if (input.reference_url !== undefined && input.reference_url !== oldTask.reference_url) {
            logTaskActivity(id, 'reference_url_changed', oldTask.reference_url ?? '', input.reference_url ?? '', origin)
          }
          if (input.is_in_my_day !== undefined && input.is_in_my_day !== oldTask.is_in_my_day) {
            logTaskActivity(id, input.is_in_my_day === 1 ? 'pinned_to_my_day' : 'unpinned_from_my_day', null, null, origin)
            await requireProducerCurrent(origin)
            window.api.tray.refresh()
          }
          if (input.project_id !== undefined && input.project_id !== oldTask.project_id) {
            logTaskActivity(id, 'moved_to_project', oldTask.project_id, input.project_id, origin)
          }
        }

        // Cascade archive/unarchive to subtasks in store
        if (input.is_archived !== undefined) {
          await get().hydrateAllForProject(task.project_id, origin)
        }

        // Check if a recurring task was moved to done status → create clone
        if (input.status_id && task.recurrence_rule) {
          const status = await api.statuses.findById(input.status_id)
          if (status && status.is_done === 1) {
            try {
              const result = await api.tasks.completeRecurring(task.id)
              if (result) {
                const newTask = await api.tasks.findById(result.id)
                if (newTask) {
                  await publishCreatedSubtree(newTask, origin)
                  await requireProducerCurrent(origin)
                  set({ lastRecurringClone: { taskId: result.id, dueDate: result.dueDate, projectId: newTask.project_id } })
                }
              }
            } catch (err) {
              if (await origin.isCurrent()) console.error('Failed to create recurring task clone:', err)
            }
          }
        }

        // When adding a subtask to My Day, also add its parent
        if (input.is_in_my_day === 1 && task.parent_id) {
          const parent = get().tasks[task.parent_id]
          if (parent && parent.is_in_my_day !== 1) {
            const updatedParent = await api.tasks.update(parent.id, { is_in_my_day: 1 })
            if (updatedParent) {
              await requireProducerCurrent(origin)
              set((state) => ({
                tasks: { ...state.tasks, [updatedParent.id]: updatedParent }
              }))
            }
          }
        }
        await requireProducerCurrent(origin)
        const openTaskId = get().showDetailPanel ? get().lastSelectedTaskId : null
        if (task.id === openTaskId && !isImmediateOp(input)) {
          await requireProducerCurrent(origin)
          TaskBatchSyncManager.markPending(task.id, origin)
        } else {
          // An immediate push carries the full task row, so any buffered
          // edits ride along — drop the pending mark instead of pushing the
          // same state again at the next boundary.
          TaskBatchSyncManager.cancelPending(task.id)
          syncIfShared(task, 'UPDATE', origin)
        }
        scheduleSavedViewRecount(origin)
      }
      await requireProducerCurrent(origin)
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update task'
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async deleteTask(id: string): Promise<boolean> {
    const origin = captureProjectProducer(get().tasks[id]?.project_id)
    const api = origin.api
    try {
      // Capture task before deletion for sync
      const taskToDelete = get().tasks[id] ?? await api.tasks.findById(id)
      if (taskToDelete) origin.includeProject(taskToDelete.project_id)
      if (taskToDelete) logTaskActivity(id, 'deleted', taskToDelete.title, null, origin)

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

      const result = await api.tasks.delete(id)
      if (result) {

        await requireProducerCurrent(origin)

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
        TaskBatchSyncManager.cancelPending(id)
        if (taskToDelete) syncIfShared(taskToDelete, 'DELETE', origin)
        scheduleSavedViewRecount(origin)
      }
      await requireProducerCurrent(origin)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete task'
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async duplicateTask(id: string, newId: string): Promise<Task | null> {
    const origin = captureProjectProducer(get().tasks[id]?.project_id)
    const api = origin.api
    try {
      const source = get().tasks[id] ?? await api.tasks.findById(id)
      if (source) origin.includeProject(source.project_id)
      const task = await api.tasks.duplicate(id, newId)
      if (task) {
        await publishCreatedSubtree(task, origin)
        scheduleSavedViewRecount(origin)
      }
      await requireProducerCurrent(origin)
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate task'
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async saveTaskAsTemplate(id: string, newId: string): Promise<Task | null> {
    const origin = captureProjectProducer(get().tasks[id]?.project_id)
    const api = origin.api
    try {
      const source = get().tasks[id] ?? await api.tasks.findById(id)
      if (source) origin.includeProject(source.project_id)
      const template = await api.tasks.saveAsTemplate(id, newId)
      if (template) {
        await publishCreatedSubtree(template, origin)
      }
      await requireProducerCurrent(origin)
      return template
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save as template'
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async reorderTasks(taskIds: string[]): Promise<void> {
    const batch = captureSyncProducer()
    const origins = taskIds.map(id => ({ id, origin: captureProjectProducer(get().tasks[id]?.project_id) }))
    try {
      const eligible = await Promise.all(origins.map(async ({ id, origin }) => {
        try {
          const task = get().tasks[id] ?? await origin.api.tasks.findById(id)
          if (!task) return false
          origin.includeProject(task.project_id)
          await requireProducerCurrent(origin)
          return true
        } catch (error) {
          if (await origin.isCurrent()) throw error
          return false
        }
      }))
      const current = origins.filter((_, index) => eligible[index])
      if (!current.length) return
      await Promise.all(current.map(async ({ id, origin }, index) => {
        try {
          await origin.api.tasks.update(id, { order_index: index })
          const task = await origin.api.tasks.findById(id)
          if (!task) return
          origin.includeProject(task.project_id)
          await requireProducerCurrent(origin)
          set(state => ({ tasks: { ...state.tasks, [id]: task } }))
          syncIfShared(task, 'UPDATE', origin)
        } catch (error) {
          if (await origin.isCurrent()) throw error
        }
      }))
    } catch (error) {
      if (!await batch.isCurrent() || !(await Promise.all(origins.map(({ origin }) => origin.isCurrent()))).every(Boolean)) return
      set({ error: error instanceof Error ? error.message : 'Failed to reorder tasks' })
      throw error
    }
  },

  async createSubtask(parentId: string, input: CreateTaskInput): Promise<Task> {
    const origin = captureProjectProducer(input.project_id)
    const api = origin.api
    try {
      const task = await api.tasks.create({ ...input, parent_id: parentId })
      await requireProducerCurrent(origin)
      set((state) => {
        const newExpanded = new Set(state.expandedTaskIds)
        newExpanded.add(parentId)
        return {
          tasks: { ...state.tasks, [task.id]: task },
          expandedTaskIds: newExpanded
        }
      })
      syncIfShared(task, 'INSERT', origin)
      logTaskActivity(task.id, 'created', null, null, origin)
      scheduleSavedViewRecount(origin)
      await requireProducerCurrent(origin)
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create subtask'
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async addLabel(taskId: string, labelId: string): Promise<void> {
    const origin = captureProjectProducer(get().tasks[taskId]?.project_id)
    const api = origin.api
    try {
      const source = get().tasks[taskId] ?? await api.tasks.findById(taskId)
      if (source) origin.includeProject(source.project_id)
      // Resolve to the current user's own same-name label before linking, so
      // we never attach another member's label id to this user's task (#d5b138b1).
      const linkId = await resolveLabelForCurrentUser(labelId, origin)
      await api.tasks.addLabel(taskId, linkId)
      const projectId = (await api.tasks.findById(taskId))?.project_id
      const { pushProjectLabel } = await import('../../services/PersonalSyncService')
      if (projectId) await pushProjectLabel(projectId, linkId, null, origin)
      await get().hydrateTaskLabels(taskId, origin)
      await requireProducerCurrent(origin)
      const labels = get().taskLabels[taskId] ?? []
      const added = labels.find((l) => l.id === linkId)
      logTaskActivity(taskId, 'label_added', null, added?.name ?? linkId, origin)
      const task = get().tasks[taskId]
      if (task) {
        await requireProducerCurrent(origin)
        const openTaskId = get().showDetailPanel ? get().lastSelectedTaskId : null
        if (task.id === openTaskId) TaskBatchSyncManager.markPending(task.id, origin)
        else syncIfShared(task, 'UPDATE', origin)
      }
      scheduleSavedViewRecount(origin)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add label'
      if (await origin.isCurrent()) console.error('[addLabel] threw', err)
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async removeLabel(taskId: string, labelId: string): Promise<boolean> {
    const origin = captureProjectProducer(get().tasks[taskId]?.project_id)
    const api = origin.api
    try {
      const source = get().tasks[taskId] ?? await api.tasks.findById(taskId)
      if (source) origin.includeProject(source.project_id)
      const labels = get().taskLabels[taskId] ?? []
      let passedLabel: Label | undefined =
        labels.find((l) => l.id === labelId)
        ?? useLabelStore.getState().labels[labelId]
      if (!passedLabel) {
        const fetched = await api.labels.findById(labelId).catch(() => null)
        if (fetched) passedLabel = fetched
      }
      const targetName = passedLabel?.name.toLowerCase() ?? null
      const toRemove = targetName
        ? labels.filter((l) => l.name.toLowerCase() === targetName)
        : labels.filter((l) => l.id === labelId)

      let anyRemoved = false
      for (const l of toRemove) {
        const result = await api.tasks.removeLabel(taskId, l.id)
        if (result) anyRemoved = true
      }
      await get().hydrateTaskLabels(taskId, origin)
      await requireProducerCurrent(origin)
      if (anyRemoved) {
        logTaskActivity(taskId, 'label_removed', passedLabel?.name ?? labelId, null, origin)
        const task = get().tasks[taskId]
        if (task) {
          await requireProducerCurrent(origin)
        const openTaskId = get().showDetailPanel ? get().lastSelectedTaskId : null
          if (task.id === openTaskId) TaskBatchSyncManager.markPending(task.id, origin)
          else syncIfShared(task, 'UPDATE', origin)
        }
        scheduleSavedViewRecount(origin)
      }
      await requireProducerCurrent(origin)
      return anyRemoved
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove label'
      if (await origin.isCurrent()) console.error('[removeLabel] threw', err)
      await requireProducerCurrent(origin)
      set({ error: message })
      throw err
    }
  },

  async hydrateTaskLabels(taskId: string, producer?: SyncProducer): Promise<void> {
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(producer)
    const initial = get().taskLabels[taskId]
    let projectId: string | undefined
    try {
      const task = get().tasks[taskId] ?? await api.tasks.findById(taskId)
      projectId = task?.project_id
      if (!task || !isProjectCurrent(task.project_id) || !await isCurrent()) return
      assertCurrent()
      const project = hydrationContext({ api, isCurrent, assertCurrent }, task.project_id, getUserId())
      if (!await project.isCurrent()) return
      const labels = await project.api.labels.findByTaskId(taskId)
      if (!await project.isCurrent()) return
      if (!await isCurrent() || !isProjectCurrent(task.project_id)) return
      assertCurrent()
      set((state) => state.taskLabels[taskId] === initial && isProjectCurrent(task.project_id)
        ? { taskLabels: { ...state.taskLabels, [taskId]: labels } } : {})
    } catch (err) {
      if (!await isCurrent() || (projectId && !isProjectCurrent(projectId))) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load task labels' })
    }
  },

  async hydrateAllTaskLabels(projectId: string, origin?: HydrationOrigin): Promise<void> {
    const { api, isCurrent, assertCurrent } = hydrationContext(origin, projectId, getUserId())
    const initial = get().taskLabels
    try {
      const mappings: TaskLabelMapping[] = await api.labels.findTaskLabelsByProject(projectId)
      const grouped: Record<string, Label[]> = {}
      for (const { task_id, ...label } of mappings) (grouped[task_id] ??= []).push(label)
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => ({ taskLabels: { ...state.taskLabels, ...Object.fromEntries(Object.entries(grouped).filter(([id]) => state.taskLabels[id] === initial[id])) } }))
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      set({ error: err instanceof Error ? err.message : 'Failed to load task labels' })
    }
  },

  setCurrentTask(id: string | null): void {
    if (id === null) {
      // Panel close boundary — push everything buffered while it was open.
      void TaskBatchSyncManager.flushAll()
      set({ selectedTaskIds: new Set<string>(), lastSelectedTaskId: null, showDetailPanel: false })
    } else {
      const prev = get().lastSelectedTaskId
      if (prev && prev !== id) void TaskBatchSyncManager.flush(prev)
      set({ selectedTaskIds: new Set<string>([id]), lastSelectedTaskId: id, showDetailPanel: true })
    }
  },

  // Navigate to a task without affecting showDetailPanel (for Tab key navigation)
  navigateTask(id: string): void {
    // Task switch boundary — flush the previous task's buffered edits.
    const prev = get().lastSelectedTaskId
    if (prev && prev !== id) void TaskBatchSyncManager.flush(prev)
    set({ selectedTaskIds: new Set<string>([id]), lastSelectedTaskId: id })
  },

  selectTask(id: string, options?: { fromContextMenu?: boolean; openPanel?: boolean }): void {
    // Task switch boundary — flush the previous task's buffered edits.
    const prev = get().lastSelectedTaskId
    if (prev && prev !== id) void TaskBatchSyncManager.flush(prev)
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
    // Panel close boundary — push everything buffered while it was open.
    void TaskBatchSyncManager.flushAll()
    set({ selectedTaskIds: new Set<string>(), lastSelectedTaskId: null, showDetailPanel: false })
  },

  async bulkUpdateTasks(ids: string[], input: UpdateTaskInput): Promise<void> {
    await Promise.all(ids.map(id => ({ id, origin: captureProjectProducer(get().tasks[id]?.project_id) })).map(async ({ id, origin }) => {
      try {
        const source = get().tasks[id] ?? await origin.api.tasks.findById(id)
        if (source) origin.includeProject(source.project_id)
        if (input.project_id) origin.includeProject(input.project_id)
        const task = await origin.api.tasks.update(id, input)
        await requireProducerCurrent(origin)
        if (task) {
          set(state => ({ tasks: { ...state.tasks, [id]: task } }))
          syncIfShared(task, 'UPDATE', origin)
          scheduleSavedViewRecount(origin)
        }
      } catch (error) {
        if (!await origin.isCurrent()) return
        set({ error: error instanceof Error ? error.message : 'Failed to bulk update tasks' })
        throw error
      }
    }))
  },

  async bulkDeleteTasks(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => ({ id, origin: captureProjectProducer(get().tasks[id]?.project_id) })).map(async ({ id, origin }) => {
      try {
        const source = get().tasks[id] ?? await origin.api.tasks.findById(id)
        if (!source) return
        origin.includeProject(source.project_id)
        await origin.api.tasks.delete(id)
        await requireProducerCurrent(origin)
        set(state => {
          const removed = new Set([id])
          const collect = (parentId: string): void => {
            for (const task of Object.values(state.tasks)) if (task.parent_id === parentId && !removed.has(task.id)) {
              removed.add(task.id)
              collect(task.id)
            }
          }
          collect(id)
          return {
            tasks: Object.fromEntries(Object.entries(state.tasks).filter(([key]) => !removed.has(key))),
            taskLabels: Object.fromEntries(Object.entries(state.taskLabels).filter(([key]) => !removed.has(key))),
            expandedTaskIds: new Set([...state.expandedTaskIds].filter(key => !removed.has(key))),
            selectedTaskIds: new Set([...state.selectedTaskIds].filter(key => !removed.has(key))),
            lastSelectedTaskId: removed.has(state.lastSelectedTaskId ?? '') ? null : state.lastSelectedTaskId
          }
        })
        TaskBatchSyncManager.cancelPending(id)
        syncIfShared(source, 'DELETE', origin)
        scheduleSavedViewRecount(origin)
      } catch (error) {
        if (!await origin.isCurrent()) return
        set({ error: error instanceof Error ? error.message : 'Failed to bulk delete tasks' })
        throw error
      }
    }))
  },

  async bulkAddLabel(ids: string[], labelId: string): Promise<void> {
    const labels = new Map<string, Promise<string>>()
    const projectSync = new Map<string, Promise<unknown>>()
    await Promise.all(ids.map(id => ({ id, origin: captureProjectProducer(get().tasks[id]?.project_id) })).map(async ({ id, origin }) => {
      try {
        const source = get().tasks[id] ?? await origin.api.tasks.findById(id)
        if (!source) return
        origin.includeProject(source.project_id)
        let label = labels.get(source.project_id)
        if (!label) {
          label = resolveLabelForCurrentUser(labelId, origin)
          labels.set(source.project_id, label)
        }
        const linkId = await label
        await requireProducerCurrent(origin)
        await origin.api.tasks.addLabel(id, linkId)
        await requireProducerCurrent(origin)
        let sync = projectSync.get(source.project_id)
        if (!sync) {
          sync = import('../../services/PersonalSyncService').then(({ pushProjectLabel }) => pushProjectLabel(source.project_id, linkId, null, origin))
          projectSync.set(source.project_id, sync)
        }
        await sync
        await requireProducerCurrent(origin)
        await get().hydrateTaskLabels(id, origin)
        await requireProducerCurrent(origin)
        syncIfShared(source, 'UPDATE', origin)
        scheduleSavedViewRecount(origin)
      } catch (error) {
        if (!await origin.isCurrent()) return
        set({ error: error instanceof Error ? error.message : 'Failed to add label to tasks' })
        throw error
      }
    }))
  },

  async bulkRemoveLabel(ids: string[], labelId: string): Promise<void> {
    await Promise.all(ids.map(id => ({ id, origin: captureProjectProducer(get().tasks[id]?.project_id) })).map(async ({ id, origin }) => {
      try {
        const source = get().tasks[id] ?? await origin.api.tasks.findById(id)
        if (!source) return
        origin.includeProject(source.project_id)
        const name = useLabelStore.getState().labels[labelId]?.name.toLowerCase()
        const labels = get().taskLabels[id] ?? []
        for (const label of labels.filter(label => name ? label.name.toLowerCase() === name : label.id === labelId)) {
          await origin.api.tasks.removeLabel(id, label.id)
        }
        await get().hydrateTaskLabels(id, origin)
        await requireProducerCurrent(origin)
        syncIfShared(source, 'UPDATE', origin)
        scheduleSavedViewRecount(origin)
      } catch (error) {
        if (!await origin.isCurrent()) return
        set({ error: error instanceof Error ? error.message : 'Failed to remove label from tasks' })
        throw error
      }
    }))
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

  setPendingScrollTask(taskId: string | null): void {
    set({ pendingScrollTaskId: taskId })
  },

  bumpActivityRefresh(taskId: string): void {
    set((state) => ({
      activityRefresh: {
        ...state.activityRefresh,
        [taskId]: (state.activityRefresh[taskId] ?? 0) + 1
      }
    }))
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
    const next = sortSubtasksForDisplay(Object.values(tasks)
      .filter((t) => t.parent_id === parentId && !t.is_archived && !t.deleted_at))
    if (tasksArrayEqual(prevRef.current, next)) return prevRef.current
    prevRef.current = next
    return next
  }, [tasks, parentId])
}

export function useChildCount(parentId: string): { total: number; done: number } {
  const tasks = useTaskStore((s) => s.tasks)
  const prevRef = useRef<{ total: number; done: number }>({ total: 0, done: 0 })
  return useMemo(() => {
    const children = Object.values(tasks).filter((t) => t.parent_id === parentId && !t.is_archived && !t.deleted_at)
    const done = children.filter((t) => t.completed_date !== null).length
    const next = { total: children.length, done }
    if (prevRef.current.total === next.total && prevRef.current.done === next.done) return prevRef.current
    prevRef.current = next
    return next
  }, [tasks, parentId])
}

export function useTaskLabelsHook(taskId: string): Label[] {
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const task = useTaskStore((s) => s.tasks[taskId])
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? '')
  // Lazy-import to avoid a top-level cycle with labelStore and projectStore.
  // The hook re-runs when stores change because we subscribe via the
  // selectors below.
  const allLabels = useLabelStoreLabels()
  const isShared = useIsTaskInSharedProject(task?.project_id)
  const prevRef = useRef<Label[]>([])
  return useMemo(() => {
    const raw = taskLabels[taskId] ?? []
    let next: Label[]
    if (isShared) {
      // Shared project: each member has their own copy of every label.
      // Remap each task label to the viewer's same-name version (so chip
      // color/casing reflects the viewer's own labels) and dedupe by name
      // so multi-member tagging collapses to one chip.
      next = remapLabelsToCurrentUser(raw, allLabels, currentUserId)
    } else {
      // Personal project: at most one label per name per user, so no
      // remap is needed. Keep dedup as cheap defense for any historical
      // duplicate-name rows that pre-date the unique index.
      next = raw.length > 1 ? deduplicateLabelsByName(raw, currentUserId) : raw
    }
    if (labelsArrayEqual(prevRef.current, next)) return prevRef.current
    prevRef.current = next
    return next
  }, [taskLabels, taskId, currentUserId, allLabels, isShared])
}

function useLabelStoreLabels(): Record<string, Label> {
  return useLabelStore((s) => s.labels)
}

function useIsTaskInSharedProject(projectId: string | undefined): boolean {
  return useProjectStore((s) => (projectId ? s.projects[projectId]?.is_shared === 1 : false))
}
