import { useEffect } from 'react'
import { useTaskStore } from '../stores/taskStore'
import { useToast } from './Toast'

export function ConfirmDeleteModal(): React.JSX.Element | null {
  const pendingDeleteTaskId = useTaskStore((s) => s.pendingDeleteTaskId)
  const tasks = useTaskStore((s) => s.tasks)
  const { deleteTask, updateTask, setPendingDeleteTask, setCurrentTask } = useTaskStore()
  const { addToast } = useToast()

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
            setCurrentTask(null)
          }
        },
        {
          label: 'Archive',
          variant: 'accent',
          onClick: async () => {
            await updateTask(taskId, { is_archived: 1 })
            setCurrentTask(null)
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
  }, [pendingDeleteTaskId, tasks, deleteTask, updateTask, setPendingDeleteTask, setCurrentTask, addToast])

  return null
}
