import { useCallback } from 'react'
import type { Status, Task } from '../../../../shared/types'
import { findProjectStatusForBucket, type BucketKey } from '../views/myDayBuckets'
import { useDragAndDrop } from './useDragAndDrop'
import { useTaskStore } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import { useSettingsStore } from '../../shared/stores/settingsStore'
import { useLabelStore } from '../../shared/stores/labelStore'
import { useProjectStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'

type TaskStoreState = ReturnType<typeof useTaskStore.getState>

interface UseAppTaskDragHandlersParams {
  tasks: TaskStoreState['tasks']
  statuses: Status[]
  updateTask: TaskStoreState['updateTask']
  reorderTasks: TaskStoreState['reorderTasks']
  addToast: ReturnType<typeof useToast>['addToast']
}

/**
 * Bundles the app-level drag-and-drop task handlers (reparent, status change,
 * move-to-view, bucket drop, calendar-day drop) and wires them into
 * useDragAndDrop. Extracted verbatim from AppLayout (Story #107); every
 * callback dependency array is preserved, so drag behavior is unchanged.
 */
export function useAppTaskDragHandlers({
  tasks,
  statuses,
  updateTask,
  reorderTasks,
  addToast
}: UseAppTaskDragHandlersParams): ReturnType<typeof useDragAndDrop> {
  const getTasksForParent = useCallback(
    (parentId: string | null, statusId: string): Task[] => {
      return Object.values(tasks)
        .filter((t) => {
          if (parentId !== null) {
            return t.parent_id === parentId
          }
          return (
            t.parent_id === null &&
            t.status_id === statusId &&
            t.is_archived === 0 &&
            t.is_template === 0
          )
        })
        .sort((a, b) => a.order_index - b.order_index)
    },
    [tasks]
  )

  const handleReparent = useCallback(
    async (taskId: string, newParentId: string | null) => {
      const task = tasks[taskId]
      const prevParentId = task?.parent_id ?? null
      const prevStatusId = task?.status_id

      const update: { parent_id: string | null; status_id?: string } = {
        parent_id: newParentId
      }
      if (newParentId) {
        const parent = tasks[newParentId]
        if (parent) update.status_id = parent.status_id
      }
      await updateTask(taskId, update)

      if (newParentId && newParentId !== prevParentId) {
        const parentTitle = tasks[newParentId]?.title ?? 'task'
        addToast({
          message: `Nested under "${parentTitle}"`,
          duration: 3000,
          action: {
            label: 'Undo',
            onClick: () => updateTask(taskId, { parent_id: prevParentId, status_id: prevStatusId })
          }
        })
      }
    },
    [tasks, updateTask, addToast]
  )

  const handleDndStatusChange = useCallback(
    async (taskId: string, newStatusId: string) => {
      const task = tasks[taskId]
      if (!task) return
      const newStatus = statuses.find((s) => s.id === newStatusId)
      const update: { status_id: string; completed_date?: string | null; order_index?: number } = {
        status_id: newStatusId
      }
      if (newStatus?.is_done === 1) {
        update.completed_date = new Date().toISOString()
      } else {
        update.completed_date = null
      }
      // Position task at top or bottom of target status group based on setting
      const position = useSettingsStore.getState().settings['new_task_position'] ?? 'top'
      const allCurrentTasks = Object.values(useTaskStore.getState().tasks)
      const targetTasks = allCurrentTasks.filter((t) => t.status_id === newStatusId && t.parent_id === null && t.id !== taskId)
      if (targetTasks.length > 0) {
        update.order_index = position === 'bottom'
          ? Math.max(...targetTasks.map((t) => t.order_index)) + 1
          : Math.min(...targetTasks.map((t) => t.order_index)) - 1
      } else {
        update.order_index = 0
      }
      await updateTask(taskId, update)
      // Cascade status to all subtasks when marking done or resetting to default
      if (newStatus?.is_done === 1 || newStatus?.is_default === 1) {
        const allTasks = Object.values(useTaskStore.getState().tasks)
        const cascade = async (parentId: string): Promise<void> => {
          for (const t of allTasks.filter((t) => t.parent_id === parentId)) {
            await updateTask(t.id, {
              status_id: newStatusId,
              completed_date: newStatus.is_done === 1 ? new Date().toISOString() : null
            })
            await cascade(t.id)
          }
        }
        await cascade(taskId)
      }
    },
    [tasks, statuses, updateTask]
  )

  const handleMoveToView = useCallback(
    async (taskIds: string[], viewId: string) => {
      if (viewId === 'my-day') {
        await Promise.all(taskIds.map((id) => updateTask(id, { is_in_my_day: 1 })))
        addToast({ message: taskIds.length > 1 ? `Added ${taskIds.length} tasks to My Day` : 'Added to My Day' })
      } else if (viewId.startsWith('project-')) {
        const targetProjectId = viewId.replace('project-', '')
        const allTasks = useTaskStore.getState().tasks
        const targetStatuses = Object.values(useStatusStore.getState().statuses)
          .filter((s) => s.project_id === targetProjectId)
        const defaultStatus = targetStatuses.find((s) => s.is_default === 1) ?? targetStatuses[0]
        if (!defaultStatus) return
        const toMove = taskIds.filter((id) => allTasks[id]?.project_id !== targetProjectId)
        if (toMove.length === 0) return
        const prevStates = toMove.map((id) => ({
          id,
          project_id: allTasks[id]!.project_id,
          status_id: allTasks[id]!.status_id
        }))
        await Promise.all(toMove.map((id) => updateTask(id, { project_id: targetProjectId, status_id: defaultStatus.id })))
        // Link moved tasks' labels to the target project so they appear in filters
        const taskLabelMap = useTaskStore.getState().taskLabels
        const targetProjectLabelIds = useLabelStore.getState().projectLabels[targetProjectId] ?? new Set<string>()
        const labelsToLink = new Set<string>()
        for (const id of toMove) {
          const labels = taskLabelMap[id]
          if (labels) {
            for (const l of labels) {
              if (!targetProjectLabelIds.has(l.id)) labelsToLink.add(l.id)
            }
          }
        }
        if (labelsToLink.size > 0) {
          const { addToProject } = useLabelStore.getState()
          await Promise.all([...labelsToLink].map((labelId) => addToProject(targetProjectId, labelId)))
        }
        const targetProject = Object.values(useProjectStore.getState().projects).find((p) => p.id === targetProjectId)
        addToast({
          message: toMove.length > 1 ? `Moved ${toMove.length} tasks to ${targetProject?.name ?? 'project'}` : `Moved to ${targetProject?.name ?? 'project'}`,
          duration: 3000,
          action: {
            label: 'Undo',
            onClick: () => Promise.all(prevStates.map(({ id, project_id, status_id }) => updateTask(id, { project_id, status_id })))
          }
        })
      } else if (viewId === 'archive' || viewId === 'nav-archive') {
        await Promise.all(taskIds.map((id) => updateTask(id, { is_archived: 1 })))
        addToast({ message: taskIds.length > 1 ? `Archived ${taskIds.length} tasks` : 'Archived' })
      }
    },
    [updateTask, addToast]
  )

  const handleBucketDrop = useCallback(
    async (taskId: string, bucketKey: string) => {
      const task = tasks[taskId]
      if (!task) return
      const allStatusMap = useStatusStore.getState().statuses
      const targetStatus = findProjectStatusForBucket(task.project_id, bucketKey as BucketKey, allStatusMap)
      if (!targetStatus) {
        addToast({ message: 'This project has no in-progress status' })
        return
      }
      if (targetStatus.id !== task.status_id) {
        await handleDndStatusChange(taskId, targetStatus.id)
      }
    },
    [tasks, handleDndStatusChange, addToast]
  )

  const handleCalendarDayDrop = useCallback(
    async (taskId: string, date: string) => {
      await updateTask(taskId, { due_date: date })
      addToast({ message: `Due date set to ${date}` })
    },
    [updateTask, addToast]
  )

  return useDragAndDrop({
    tasks,
    onReorder: reorderTasks,
    onReparent: handleReparent,
    onMoveToView: handleMoveToView,
    onStatusChange: handleDndStatusChange,
    onBucketDrop: handleBucketDrop,
    onCalendarDayDrop: handleCalendarDayDrop,
    getTasksForParent,
    getSelectedTaskIds: () => [...useTaskStore.getState().selectedTaskIds]
  })
}
