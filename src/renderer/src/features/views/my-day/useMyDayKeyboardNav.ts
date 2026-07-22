import { useEffect } from 'react'
import type { Task, Status } from '../../../../../shared/types'
import { useTaskStore } from '../../../shared/stores'
import { shouldForceDelete } from '../../../shared/utils/shiftDelete'
import type { AddTaskInputHandle } from '../../tasks/AddTaskInput'

type TaskStoreState = ReturnType<typeof useTaskStore.getState>

interface UseMyDayKeyboardNavParams {
  containerRef: React.RefObject<HTMLDivElement | null>
  addInputRef: React.RefObject<AddTaskInputHandle | null>
  selectedTaskIds: Set<string>
  flatTasks: Task[]
  allTasks: Record<string, Task>
  allStatuses: Record<string, Status>
  expandedTaskIds: Set<string>
  setCurrentTask: TaskStoreState['setCurrentTask']
  navigateTask: TaskStoreState['navigateTask']
  selectAllTasks: TaskStoreState['selectAllTasks']
  clearSelection: TaskStoreState['clearSelection']
  setExpanded: TaskStoreState['setExpanded']
  toggleExpanded: TaskStoreState['toggleExpanded']
  deleteTask: TaskStoreState['deleteTask']
  handleStatusChange: (taskId: string, newStatusId: string) => void
  handleDeleteTask: (taskId: string) => void
  copySelectedTasks: (tasks: Task[]) => void
}

/**
 * Container-scoped keyboard navigation, auto-selection, and Tab cycling for the
 * My Day view. Extracted verbatim from MyDayView (Story #107) — the three
 * effects (keydown nav, first-task auto-select, global Tab intercept) keep
 * their exact dependency arrays and listener wiring, so behavior is unchanged.
 */
export function useMyDayKeyboardNav({
  containerRef,
  addInputRef,
  selectedTaskIds,
  flatTasks,
  allTasks,
  allStatuses,
  expandedTaskIds,
  setCurrentTask,
  navigateTask,
  selectAllTasks,
  clearSelection,
  setExpanded,
  toggleExpanded,
  deleteTask,
  handleStatusChange,
  handleDeleteTask,
  copySelectedTasks
}: UseMyDayKeyboardNavParams): void {
  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scrollTaskIntoView = (taskId: string): void => {
      requestAnimationFrame(() => {
        const el = container.querySelector(`[data-task-id="${taskId}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      const currentTaskId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentTaskId
        ? flatTasks.findIndex((t) => t.id === currentTaskId)
        : -1

      // Cmd+A = select all visible tasks
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        selectAllTasks(flatTasks.map((t) => t.id))
        return
      }

      // Cmd+C = copy selected task titles
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        if (selectedTaskIds.size > 0) {
          e.preventDefault()
          copySelectedTasks(flatTasks)
        }
        return
      }

      // Escape: close panel first (keeps selection), then clear selection on second press
      if (e.key === 'Escape') {
        // If a date/time picker dropdown is open (or was just closed), don't close panel
        if (document.querySelector('.react-datepicker-popper')) return
        if ((e as KeyboardEvent & { _popupHandled?: boolean })._popupHandled) return
        const { showDetailPanel: panelOpen } = useTaskStore.getState()
        if (panelOpen) {
          e.preventDefault()
          useTaskStore.setState({ showDetailPanel: false })
          return
        }
        if (selectedTaskIds.size > 0) {
          e.preventDefault()
          clearSelection()
          return
        }
      }

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
          if (flatTasks[nextIndex]) {
            const id = flatTasks[nextIndex].id
            setCurrentTask(id)
            scrollTaskIntoView(id)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
            addInputRef.current?.focus()
          } else {
            const id = flatTasks[currentIndex - 1].id
            setCurrentTask(id)
            scrollTaskIntoView(id)
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          if (currentTaskId) {
            setCurrentTask(currentTaskId)
            requestAnimationFrame(() => {
              const titleEl = document.querySelector<HTMLElement>('[data-detail-title]')
              titleEl?.focus()
            })
          } else {
            addInputRef.current?.focus()
          }
          break
        }
        case ' ': {
          if (!(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            const tasksToUpdate = selectedTaskIds.size > 0 ? [...selectedTaskIds] : currentTaskId ? [currentTaskId] : []
            if (tasksToUpdate.length > 0) {
              const anchorId = currentTaskId ?? tasksToUpdate[0]
              for (const taskId of tasksToUpdate) {
                const task = allTasks[taskId]
                if (task) {
                  const taskStatuses = Object.values(allStatuses)
                    .filter((s) => s.project_id === task.project_id)
                    .sort((a, b) => {
                      if (a.is_default === 1 && b.is_default !== 1) return -1
                      if (b.is_default === 1 && a.is_default !== 1) return 1
                      if (a.is_done === 1 && b.is_done !== 1) return 1
                      if (b.is_done === 1 && a.is_done !== 1) return -1
                      return a.order_index - b.order_index
                    })
                  const idx = taskStatuses.findIndex((s) => s.id === task.status_id)
                  const nextStatus = taskStatuses[(idx + 1) % taskStatuses.length]
                  if (nextStatus) handleStatusChange(taskId, nextStatus.id)
                }
              }
              // Re-focus container and scroll anchor task into view after DOM update
              requestAnimationFrame(() => {
                containerRef.current?.focus()
                if (anchorId) scrollTaskIntoView(anchorId)
              })
            }
          }
          break
        }
        case 'ArrowRight': {
          if (currentTaskId) {
            e.preventDefault()
            const hasSubtasks = Object.values(allTasks).some((t) => t.parent_id === currentTaskId)
            if (hasSubtasks) setExpanded(currentTaskId, true)
          }
          break
        }
        case 'ArrowLeft': {
          if (currentTaskId) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            if (expandedTaskIds.has(currentTaskId)) {
              setExpanded(currentTaskId, false)
            } else if (task?.parent_id) {
              navigateTask(task.parent_id)
            }
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (!(e.target instanceof HTMLInputElement)) {
            if (shouldForceDelete(e)) {
              e.preventDefault()
              if (selectedTaskIds.size > 1) {
                const ids = [...selectedTaskIds]
                clearSelection()
                for (const id of ids) deleteTask(id)
              } else if (currentTaskId) {
                const nextIndex =
                  currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
                const nextTask = flatTasks[nextIndex]
                deleteTask(currentTaskId)
                setCurrentTask(nextTask?.id ?? null)
              }
            } else if (selectedTaskIds.size > 1) {
              e.preventDefault()
              useTaskStore.getState().setPendingBulkDeleteTasks([...selectedTaskIds])
            } else if (currentTaskId) {
              e.preventDefault()
              const nextIndex =
                currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
              const nextTask = flatTasks[nextIndex]
              handleDeleteTask(currentTaskId)
              setCurrentTask(nextTask?.id ?? null)
            }
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedTaskIds,
    flatTasks,
    setCurrentTask,
    navigateTask,
    selectAllTasks,
    clearSelection,
    allTasks,
    allStatuses,
    handleStatusChange,
    handleDeleteTask,
    copySelectedTasks,
    toggleExpanded,
    setExpanded,
    expandedTaskIds
  ])

  // Auto-select first task (without opening detail panel) when My Day mounts or selection is cleared
  const hasSelection = selectedTaskIds.size > 0
  useEffect(() => {
    if (hasSelection) return
    requestAnimationFrame(() => {
      if (flatTasks.length > 0) {
        useTaskStore.setState({
          selectedTaskIds: new Set([flatTasks[0].id]),
          lastSelectedTaskId: flatTasks[0].id,
          showDetailPanel: false
        })
      }
      containerRef.current?.focus()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelection])

  // Tab navigation: intercept Tab globally when My Day is the active view.
  // Skips text inputs and rich-text editors; everything else (header buttons, project
  // filter chips, sidebar items) should not consume Tab — tasks should.
  useEffect(() => {
    const handleTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      // Only handle when focus is inside this container (not on body, detail panel, or popups)
      if (!container.contains(document.activeElement)) return
      // Let Tab work normally inside text inputs and textareas
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return
      // If no tasks, nothing to cycle — let browser handle it
      const tasks = flatTasks
      if (tasks.length === 0) return
      e.preventDefault()
      const selectedId = useTaskStore.getState().selectedTaskIds.values().next().value as string | undefined
      const idx = selectedId ? tasks.findIndex((t) => t.id === selectedId) : -1
      const nextId = e.shiftKey
        ? tasks[idx <= 0 ? tasks.length - 1 : idx - 1].id
        : tasks[idx >= tasks.length - 1 ? 0 : idx + 1].id
      navigateTask(nextId)
      requestAnimationFrame(() => {
        container.querySelector<HTMLElement>(`[data-task-id="${nextId}"]`)?.focus()
      })
    }
    document.addEventListener('keydown', handleTab, { capture: true })
    return () => document.removeEventListener('keydown', handleTab, { capture: true })
  }, [flatTasks, navigateTask])
}
