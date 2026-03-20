import { useCallback } from 'react'
import { useTaskStore } from '../stores/taskStore'
import { useToast } from '../components/Toast'
import type { Task } from '../../../../shared/types'

interface CopyTasksResult {
  copySelectedTasks: (flatTasks: Task[]) => void
  copyTaskIds: (taskIds: string[], flatTasks?: Task[]) => void
}

export function useCopyTasks(): CopyTasksResult {
  const { addToast } = useToast()

  const copyTaskIds = useCallback(
    (taskIds: string[], flatTasks?: Task[]) => {
      if (taskIds.length === 0) return
      const tasks = useTaskStore.getState().tasks

      let orderedTitles: string[]
      if (flatTasks && taskIds.length > 1) {
        const idSet = new Set(taskIds)
        orderedTitles = flatTasks.filter((t) => idSet.has(t.id)).map((t) => t.title)
      } else {
        orderedTitles = taskIds.map((id) => tasks[id]?.title).filter(Boolean) as string[]
      }

      if (orderedTitles.length === 0) return

      const text =
        orderedTitles.length === 1
          ? orderedTitles[0]
          : orderedTitles.join('\n')

      navigator.clipboard.writeText(text).then(() => {
        addToast({
          message: orderedTitles.length === 1 ? 'Copied' : `Copied ${orderedTitles.length} tasks`
        })
      }, (err) => {
        console.error('Failed to copy to clipboard:', err)
      })
    },
    [addToast]
  )

  const copySelectedTasks = useCallback(
    (flatTasks: Task[]) => {
      const selectedTaskIds = useTaskStore.getState().selectedTaskIds
      if (selectedTaskIds.size === 0) return
      copyTaskIds([...selectedTaskIds], flatTasks)
    },
    [copyTaskIds]
  )

  return { copySelectedTasks, copyTaskIds }
}
