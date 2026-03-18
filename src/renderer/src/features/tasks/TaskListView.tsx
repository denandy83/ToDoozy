import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTaskStore, selectTasksByProject } from '../../shared/stores'
import { useStatusStore, selectStatusesByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { AddTaskInput, type AddTaskInputHandle } from './AddTaskInput'
import { StatusSection } from './StatusSection'
import type { Task } from '../../../../shared/types'

interface TaskListViewProps {
  projectId: string
  projectName: string
}

export function TaskListView({ projectId, projectName }: TaskListViewProps): React.JSX.Element {
  const tasks = useTaskStore(selectTasksByProject(projectId))
  const statuses = useStatusStore(selectStatusesByProject(projectId))
  const currentUser = useAuthStore((s) => s.currentUser)
  const { createTask, updateTask, deleteTask, setCurrentTask, toggleExpanded, setExpanded } =
    useTaskStore()
  const currentTaskId = useTaskStore((s) => s.currentTaskId)
  const allTasks = useTaskStore((s) => s.tasks)
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const { addToast } = useToast()
  const addInputRef = useRef<AddTaskInputHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build flat ordered list of visible tasks (respecting expand/collapse) for keyboard nav
  const flatTasks = useMemo(() => {
    const result: Task[] = []
    const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
    for (const status of sorted) {
      const statusTasks = tasks
        .filter(
          (t) =>
            t.status_id === status.id &&
            t.is_archived === 0 &&
            t.is_template === 0 &&
            t.parent_id === null
        )
        .sort((a, b) => a.order_index - b.order_index)

      const addWithChildren = (task: Task): void => {
        result.push(task)
        if (expandedTaskIds.has(task.id)) {
          const children = tasks
            .filter((t) => t.parent_id === task.id)
            .sort((a, b) => a.order_index - b.order_index)
          for (const child of children) {
            addWithChildren(child)
          }
        }
      }

      for (const task of statusTasks) {
        addWithChildren(task)
      }
    }
    return result
  }, [tasks, statuses, expandedTaskIds])

  const handleAddTask = useCallback(
    async (title: string) => {
      if (!currentUser) return
      const defaultStatus = statuses.find((s) => s.is_default === 1)
      if (!defaultStatus) return

      const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order_index), -1)
      await createTask({
        id: crypto.randomUUID(),
        project_id: projectId,
        owner_id: currentUser.id,
        title,
        status_id: defaultStatus.id,
        order_index: maxOrder + 1
      })
    },
    [currentUser, statuses, tasks, projectId, createTask]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatusId: string) => {
      const newStatus = statuses.find((s) => s.id === newStatusId)
      const update: { status_id: string; completed_date?: string | null } = {
        status_id: newStatusId
      }
      if (newStatus?.is_done === 1) {
        update.completed_date = new Date().toISOString()
      } else {
        update.completed_date = null
      }
      await updateTask(taskId, update)
    },
    [statuses, updateTask]
  )

  const handleTitleChange = useCallback(
    async (taskId: string, newTitle: string) => {
      await updateTask(taskId, { title: newTitle })
    },
    [updateTask]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const task = allTasks[taskId]
      const deleted = await deleteTask(taskId)
      if (deleted && task) {
        addToast({
          message: `"${task.title}" deleted`,
          variant: 'danger',
          action: {
            label: 'Undo',
            onClick: async () => {
              if (!currentUser) return
              await createTask({
                id: crypto.randomUUID(),
                project_id: task.project_id,
                owner_id: task.owner_id,
                title: task.title,
                status_id: task.status_id,
                priority: task.priority,
                due_date: task.due_date,
                description: task.description,
                order_index: task.order_index,
                is_in_my_day: task.is_in_my_day
              })
            }
          }
        })
      }
    },
    [allTasks, deleteTask, addToast, createTask, currentUser]
  )

  const handleSelectTask = useCallback(
    (taskId: string) => {
      setCurrentTask(taskId)
    },
    [setCurrentTask]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const currentIndex = currentTaskId
        ? flatTasks.findIndex((t) => t.id === currentTaskId)
        : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
          if (flatTasks[nextIndex]) setCurrentTask(flatTasks[nextIndex].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
            addInputRef.current?.focus()
          } else {
            setCurrentTask(flatTasks[currentIndex - 1].id)
          }
          break
        }
        case 'ArrowRight': {
          if (currentTaskId && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            // If task has children and is collapsed, expand it
            const hasChildren = tasks.some((t) => t.parent_id === currentTaskId)
            if (hasChildren) {
              setExpanded(currentTaskId, true)
            }
          }
          break
        }
        case 'ArrowLeft': {
          if (currentTaskId && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            // If expanded, collapse it
            if (expandedTaskIds.has(currentTaskId)) {
              setExpanded(currentTaskId, false)
            } else if (task?.parent_id) {
              // Navigate to parent
              setCurrentTask(task.parent_id)
            }
          }
          break
        }
        case 'Enter': {
          if (!currentTaskId) {
            e.preventDefault()
            addInputRef.current?.focus()
          }
          break
        }
        case ' ': {
          if (currentTaskId && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            if (task) {
              const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
              const idx = sorted.findIndex((s) => s.id === task.status_id)
              const nextIdx = (idx + 1) % sorted.length
              handleStatusChange(currentTaskId, sorted[nextIdx].id)
            }
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (currentTaskId && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            const nextIndex =
              currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
            const nextTask = flatTasks[nextIndex]
            handleDeleteTask(currentTaskId)
            setCurrentTask(nextTask?.id ?? null)
          }
          break
        }
        case 'Tab': {
          if (!(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            if (e.shiftKey) {
              const prevIndex = Math.max(currentIndex - 1, 0)
              if (flatTasks[prevIndex]) setCurrentTask(flatTasks[prevIndex].id)
            } else {
              const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
              if (flatTasks[nextIndex]) setCurrentTask(flatTasks[nextIndex].id)
            }
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [
    currentTaskId,
    flatTasks,
    setCurrentTask,
    allTasks,
    tasks,
    statuses,
    expandedTaskIds,
    toggleExpanded,
    setExpanded,
    handleStatusChange,
    handleDeleteTask
  ])

  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.order_index - b.order_index),
    [statuses]
  )

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <AddTaskInput ref={addInputRef} viewName={projectName} onSubmit={handleAddTask} />

      <div className="flex-1 overflow-y-auto" role="grid" aria-label="Task list">
        {sortedStatuses.map((status) => {
          const statusTasks = tasks.filter(
            (t) => t.status_id === status.id && t.is_archived === 0 && t.is_template === 0
          )
          return (
            <StatusSection
              key={status.id}
              status={status}
              tasks={statusTasks}
              allStatuses={statuses}
              selectedTaskId={currentTaskId}
              onSelectTask={handleSelectTask}
              onStatusChange={handleStatusChange}
              onTitleChange={handleTitleChange}
              onDeleteTask={handleDeleteTask}
            />
          )
        })}

        {sortedStatuses.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-20">
            <p className="text-sm font-light text-muted/60">
              No statuses configured. Add statuses in project settings.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
