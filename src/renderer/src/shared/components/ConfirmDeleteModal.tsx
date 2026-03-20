import { useEffect } from 'react'
import { useTaskStore } from '../stores/taskStore'
import { useToast } from './Toast'

export function ConfirmDeleteModal(): React.JSX.Element | null {
  const pendingDeleteTaskId = useTaskStore((s) => s.pendingDeleteTaskId)
  const pendingBulkDeleteTaskIds = useTaskStore((s) => s.pendingBulkDeleteTaskIds)
  const tasks = useTaskStore((s) => s.tasks)
  const { deleteTask, updateTask, bulkDeleteTasks, bulkUpdateTasks, setPendingDeleteTask, setPendingBulkDeleteTasks, clearSelection } = useTaskStore()
  const { addToast } = useToast()

  // Single task delete
  useEffect(() => {
    if (!pendingDeleteTaskId) return
    const task = tasks[pendingDeleteTaskId]
    if (!task) {
      setPendingDeleteTask(null)
      return
    }

    const taskId = pendingDeleteTaskId
    const title = task.title || 'Untitled'

    addToast({
      message: `Delete "${title}"?`,
      persistent: true,
      actions: [
        {
          label: 'Delete',
          variant: 'danger',
          onClick: async () => {
            await deleteTask(taskId)
            clearSelection()
          }
        },
        {
          label: 'Archive',
          variant: 'accent',
          onClick: async () => {
            await updateTask(taskId, { is_archived: 1 })
            clearSelection()
          }
        },
        {
          label: 'Cancel',
          variant: 'muted',
          onClick: () => {}
        }
      ]
    })

    setPendingDeleteTask(null)
  }, [pendingDeleteTaskId, tasks, deleteTask, updateTask, setPendingDeleteTask, clearSelection, addToast])

  // Bulk delete
  useEffect(() => {
    if (!pendingBulkDeleteTaskIds || pendingBulkDeleteTaskIds.length === 0) return

    const ids = pendingBulkDeleteTaskIds
    const count = ids.length

    addToast({
      message: `Delete ${count} tasks?`,
      persistent: true,
      actions: [
        {
          label: 'Delete',
          variant: 'danger',
          onClick: async () => {
            await bulkDeleteTasks(ids)
            clearSelection()
          }
        },
        {
          label: 'Archive',
          variant: 'accent',
          onClick: async () => {
            await bulkUpdateTasks(ids, { is_archived: 1 })
            clearSelection()
          }
        },
        {
          label: 'Cancel',
          variant: 'muted',
          onClick: () => {}
        }
      ]
    })

    setPendingBulkDeleteTasks(null)
  }, [pendingBulkDeleteTaskIds, bulkDeleteTasks, bulkUpdateTasks, setPendingBulkDeleteTasks, clearSelection, addToast])

  return null
}
