import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type Modifier
} from '@dnd-kit/core'
import { LayoutList, LayoutGrid, Columns3, LayoutTemplate, Trash2, Archive, Copy, Filter } from 'lucide-react'
import { NewProjectModal } from './features/projects'
import { UnifiedSettingsModal } from './features/settings/UnifiedSettingsModal'
import { UpdateAvailableModal } from './features/settings/UpdateAvailableModal'
import { UpdateReadyBanner } from './features/settings/UpdateReadyBanner'
import { SessionBanner } from './shared/components/SessionBanner'
import { TaskListView, TaskDragOverlay } from './features/tasks'
import { KanbanCard } from './features/tasks/KanbanCard'
import { useAppTaskDragHandlers } from './features/tasks/useAppTaskDragHandlers'
import { Sidebar, useSidebarItems } from './features/sidebar'
import { DetailPanel } from './features/detail'
import { MyDayView } from './features/views/MyDayView'
import { CalendarView } from './features/views/CalendarView'
import { SavedViewListView } from './features/views/SavedViewListView'
import { StatsView } from './features/views/StatsView'
import { ArchiveView } from './features/views/ArchiveView'
import { TemplatesView } from './features/views/TemplatesView'
import { useThemeApplicator } from './shared/hooks/useThemeApplicator'
import { useProjectStore, selectActiveProjects } from './shared/stores'
import { useStatusesByProject, useStatusStore } from './shared/stores'
import { useTaskStore } from './shared/stores'
import { useViewStore, selectLayoutMode, selectSelectedProjectId } from './shared/stores/viewStore'
import { useSettingsStore } from './shared/stores/settingsStore'
import { useLabelStore } from './shared/stores/labelStore'
import { useSavedViewStore } from './shared/stores/savedViewStore'
import type { ViewId } from './shared/stores/viewStore'
import { useAuthStore, takePendingPasswordSave } from './shared/stores/authStore'
import { useToast } from './shared/components/Toast'
import { ToastContainer } from './shared/components/Toast'
import { ContextMenu } from './shared/components/ContextMenu'
import { BulkContextMenu } from './shared/components/BulkContextMenu'
import { ConfirmDeleteModal } from './shared/components/ConfirmDeleteModal'
import { TimerOverlay } from './shared/components/TimerOverlay'
import { CommandPalette } from './features/command-palette'
import { useCommandPaletteStore } from './shared/stores/commandPaletteStore'
import { KeyboardShortcutsModal } from './features/help/KeyboardShortcutsModal'
import { useTemplateStore, selectAllProjectTemplates } from './shared/stores'
import type { Task, Label, ProjectTemplate, ProjectTemplateData } from '../../shared/types'
import { DeployProjectTemplateWizard } from './features/templates/DeployProjectTemplateWizard'
import { closeTopPopup } from './shared/utils/popupStack'
import { NotificationBell, NotificationPanel, MemberAvatars, ShareProjectMenu, RemovedFromProjectDialog, useSharedProjectRealtime } from './features/collaboration'
import { useNotificationStore } from './shared/stores/notificationStore'

export function AppLayout(): React.JSX.Element {
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpOpenRef = useRef(false)
  const dragWidthRef = useRef(0)
  helpOpenRef.current = helpOpen

  // Lock ghost horizontally (stays at original X), only moves vertically
  const lockHorizontal: Modifier = useCallback(({ transform }) => {
    return { ...transform, x: 0 }
  }, [])

  // Apply current theme CSS variables
  useThemeApplicator()
  const allProjects = useProjectStore(selectActiveProjects)
  const sortedProjects = useMemo(
    () => [...allProjects].sort((a, b) => a.sidebar_order - b.sidebar_order),
    [allProjects]
  )
  const allTasks = useTaskStore((s) => s.tasks)
  const { updateTask, reorderTasks } = useTaskStore()
  const currentView = useViewStore((s) => s.currentView)
  const selectedProjectId = useViewStore(selectSelectedProjectId)
  const setSelectedProject = useViewStore((s) => s.setSelectedProject)
  const rawSetView = useViewStore((s) => s.setView)
  const layoutMode = useViewStore(selectLayoutMode)
  const toggleLayoutMode = useViewStore((s) => s.toggleLayoutMode)
  const clearLabelFilters = useLabelStore((s) => s.clearLabelFilters)
  const selectedSavedViewId = useViewStore((s) => s.selectedSavedViewId)
  const savedViews = useSavedViewStore((s) => s.views)
  const currentSavedView = savedViews.find((v) => v.id === selectedSavedViewId)
  const { setSetting, getSetting } = useSettingsStore()

  // Selected project for the project view
  const selectedProject = selectedProjectId
    ? allProjects.find((p) => p.id === selectedProjectId) ?? null
    : null

  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)

  // Auto-select first project if none selected and we have projects
  useEffect(() => {
    if (sortedProjects.length > 0 && !selectedProjectId) {
      const defaultProject = sortedProjects.find((p) => p.is_default === 1) ?? sortedProjects[0]
      if (defaultProject) {
        useViewStore.setState({ selectedProjectId: defaultProject.id })
      }
    }
  }, [sortedProjects, selectedProjectId])

  // Sync projectStore.currentProjectId with viewStore.selectedProjectId
  useEffect(() => {
    if (selectedProjectId) {
      setCurrentProject(selectedProjectId)
    }
  }, [selectedProjectId, setCurrentProject])

  // Per-project layout memory: restore layout when switching projects
  useEffect(() => {
    if (currentView === 'project' && selectedProjectId) {
      const saved = getSetting(`project_layout_${selectedProjectId}`)
      const mode = saved === 'kanban' ? 'kanban' : 'list'
      useViewStore.setState({ layoutMode: mode })
    }
  }, [currentView, selectedProjectId, getSetting])

  // Listen for tray navigation events
  useEffect(() => {
    const unsubTask = window.api.tray.onNavigateToTask((taskId) => {
      rawSetView('my-day')
      useTaskStore.getState().selectTask(taskId)
      useTaskStore.getState().setPendingScrollTask(taskId)
    })
    const unsubMyDay = window.api.tray.onNavigateToMyDay(() => {
      rawSetView('my-day')
    })
    return () => {
      unsubTask()
      unsubMyDay()
    }
  }, [rawSetView])

  // Listen for notification navigation events
  useEffect(() => {
    const unsub = window.api.notifications.onNavigateToTask((taskId, projectId) => {
      useViewStore.setState({ currentView: 'project', selectedProjectId: projectId })
      useTaskStore.getState().selectTask(taskId)
      useTaskStore.getState().setPendingScrollTask(taskId)
    })
    return unsub
  }, [])

  // Auto-clear label filters and selection on view switch, reset kanban for non-supported views
  const setView = useCallback(
    (view: ViewId) => {
      clearLabelFilters()
      useTaskStore.getState().clearSelection()
      if (view !== 'my-day' && view !== 'project') {
        useViewStore.setState({ layoutMode: 'list' })
      }
      rawSetView(view)
    },
    [clearLabelFilters, rawSetView]
  )

  const handleToggleLayoutMode = useCallback(() => {
    toggleLayoutMode()
    // Persist per-project layout
    if (currentView === 'project' && selectedProjectId) {
      const newMode = useViewStore.getState().layoutMode
      setSetting(`project_layout_${selectedProjectId}`, newMode)
    }
  }, [toggleLayoutMode, currentView, selectedProjectId, setSetting])

  // Sidebar is always expanded (collapse removed in Story #52)
  const { addToast } = useToast()

  useEffect(() => {
    const pending = takePendingPasswordSave()
    if (!pending) return
    addToast({
      message: 'Save password to Keychain?',
      persistent: true,
      actions: [
        {
          label: 'Save',
          variant: 'accent' as const,
          onClick: async () => {
            await window.api.auth.savePassword(pending.email, pending.password).catch(() => {})
          }
        },
        { label: 'No thanks', variant: 'muted' as const, onClick: () => {} }
      ]
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lastRecurringClone = useTaskStore((s) => s.lastRecurringClone)

  // Hydrate notifications on mount
  const hydrateNotifications = useNotificationStore((s) => s.hydrate)
  useEffect(() => {
    hydrateNotifications()
  }, [hydrateNotifications])

  // Show toast when a recurring task clone is created
  useEffect(() => {
    if (!lastRecurringClone) return
    const { taskId, dueDate, projectId: cloneProjectId } = lastRecurringClone
    addToast({
      message: `Recurring task created → due ${dueDate}`,
      action: {
        label: 'Go to task',
        onClick: () => {
          // Navigate to the cloned task
          if (cloneProjectId !== selectedProject?.id) {
            const proj = sortedProjects.find((p) => p.id === cloneProjectId)
            if (proj) {
              useViewStore.getState().setSelectedProject(proj.id)
            }
          }
          useTaskStore.getState().selectTask(taskId)
          useTaskStore.getState().setPendingScrollTask(taskId)
        }
      }
    })
    useTaskStore.getState().clearLastRecurringClone()
  }, [lastRecurringClone, addToast, selectedProject?.id, sortedProjects, rawSetView])

  const projectId = selectedProject?.id ?? ''
  const statuses = useStatusesByProject(projectId)

  // Sidebar is always expanded

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 }
  })
  const sensors = useSensors(pointerSensor)

  const tasks = useTaskStore((s) => s.tasks)

  const { dragState, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel, collisionDetection } =
    useAppTaskDragHandlers({ tasks, statuses, updateTask, reorderTasks, addToast })

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  // Sidebar items for dynamic keyboard shortcuts
  const sidebarNavItems = useSidebarItems()

  // View task counts
  const projectTemplates = useTemplateStore(selectAllProjectTemplates)
  const allStatusMap = useStatusStore((s) => s.statuses)
  const viewCounts = useMemo(() => {
    const taskList = Object.values(allTasks)
    const today = new Date().toISOString().split('T')[0]
    const isDone = (t: Task): boolean => allStatusMap[t.status_id]?.is_done === 1
    const taskTemplateCount = taskList.filter((t) => t.is_template === 1 && t.parent_id === null).length
    return {
      'my-day': taskList.filter(
        (t) =>
          t.is_archived === 0 &&
          t.is_template === 0 &&
          t.parent_id === null &&
          !isDone(t) &&
          (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ).length,
      archive: taskList.filter((t) => t.is_archived === 1 && t.parent_id === null).length,
      templates: taskTemplateCount + projectTemplates.length
    }
  }, [allTasks, projectTemplates, allStatusMap])

  // Per-project task counts (exclude done tasks)
  const projectCounts = useMemo(() => {
    const taskList = Object.values(allTasks)
    const isDone = (t: Task): boolean => allStatusMap[t.status_id]?.is_done === 1
    const counts: Record<string, number> = {}
    for (const project of allProjects) {
      counts[project.id] = taskList.filter(
        (t) =>
          t.project_id === project.id &&
          t.is_archived === 0 &&
          t.is_template === 0 &&
          t.parent_id === null &&
          !isDone(t)
      ).length
    }
    return counts
  }, [allTasks, allProjects, allStatusMap])

  const handleOpenHelp = useCallback(() => {
    setHelpOpen(true)
  }, [])

  // Global Escape: close topmost popup (calendar, dropdowns, etc.) before anything else fires
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Close keyboard shortcuts modal first if open
      if (helpOpenRef.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setHelpOpen(false)
        return
      }
      if (closeTopPopup()) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      // Fallback: if a date/time picker popper is visible but wasn't registered in the popup stack
      // (e.g. showTimeSelectOnly mode), set a flag so downstream handlers know to bail out.
      // We do NOT stopImmediatePropagation here — react-datepicker needs the event to close the popper.
      const popper = document.querySelector('.react-datepicker-popper')
      if (popper) {
        e.preventDefault()
        ;(e as KeyboardEvent & { _popupHandled?: boolean })._popupHandled = true
        // After react-datepicker closes the popper, ensure focus lands on the date input
        // inside the detail panel (not on body, which would break Tab navigation)
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body) {
            const panel = document.querySelector('[data-detail-panel]')
            const dateInput = panel?.querySelector<HTMLInputElement>('.datepicker-wrapper input, .datepicker-wrapper-time input')
            dateInput?.focus()
          }
        })
      }
    }
    window.addEventListener('keydown', handleEscape, { capture: true })
    return () => window.removeEventListener('keydown', handleEscape, { capture: true })
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // ? opens keyboard shortcuts modal (when not in a text field)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
        if (target.isContentEditable) return
        e.preventDefault()
        setHelpOpen((prev) => !prev)
        return
      }

      // Tab/Shift+Tab cycles projects when in project view (only when no task is selected)
      if (e.key === 'Tab' && currentView === 'project' && sortedProjects.length > 1) {
        if (e.defaultPrevented) return
        const target = e.target as HTMLElement
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
        // Don't cycle projects if any task is selected — Tab should cycle tasks instead
        const { selectedTaskIds } = useTaskStore.getState()
        if (selectedTaskIds.size > 0) return
        e.preventDefault()
        const currentIdx = sortedProjects.findIndex((p) => p.id === selectedProjectId)
        if (e.shiftKey) {
          const prevIdx = (currentIdx - 1 + sortedProjects.length) % sortedProjects.length
          setSelectedProject(sortedProjects[prevIdx].id)
        } else {
          const nextIdx = (currentIdx + 1) % sortedProjects.length
          setSelectedProject(sortedProjects[nextIdx].id)
        }
        return
      }

      if (!e.metaKey && !e.ctrlKey) return

      // Dynamic Cmd+N shortcuts based on visible sidebar items
      const digitKey = parseInt(e.key, 10)
      if (digitKey >= 1 && digitKey <= 9) {
        const item = sidebarNavItems[digitKey - 1]
        if (item) {
          e.preventDefault()
          if (item.id === 'views') {
            const views = useSavedViewStore.getState().views
            if (views.length > 0) {
              clearLabelFilters()
              setView('saved-view')
              useViewStore.getState().setSelectedSavedView(views[0].id)
            }
          } else if (item.id === 'projects') {
            if (sortedProjects.length > 0) {
              clearLabelFilters()
              setSelectedProject(sortedProjects[0].id)
            }
          } else {
            setView(item.id as ViewId)
          }
          return
        }
      }

      // Cmd+K = open command palette (unless inside Tiptap editor, where it inserts/edits a link)
      if (e.key === 'k') {
        const active = document.activeElement
        if (active?.closest('.tiptap-editor-content')) return
        e.preventDefault()
        useCommandPaletteStore.getState().open()
        return
      }

      // Cmd+L = toggle kanban/list (only on my-day and project)
      if (e.key === 'l') {
        const view = useViewStore.getState().currentView
        if (view === 'my-day' || view === 'project') {
          e.preventDefault()
          handleToggleLayoutMode()
        }
        return
      }

      // Cmd+[ = prev view, Cmd+] = next view
      if (e.key === '[') {
        e.preventDefault()
        useViewStore.getState().prevView()
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        useViewStore.getState().nextView()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView, selectedProjectId, sortedProjects, setView, setSelectedProject, clearLabelFilters, handleToggleLayoutMode, sidebarNavItems])

  // Dynamic view title
  const viewTitle = useMemo(() => {
    if (currentView === 'my-day') return 'My Day'
    if (currentView === 'calendar') return 'Calendar'
    if (currentView === 'stats') return 'Stats'
    if (currentView === 'project' && selectedProject) return selectedProject.name
    if (currentView === 'saved-view' && currentSavedView) return currentSavedView.name
    if (currentView === 'archive') return 'Archive'
    if (currentView === 'templates') return 'Templates'
    return ''
  }, [currentView, selectedProject, currentSavedView])

  const [editingProjectName, setEditingProjectName] = useState(false)
  const [projectNameValue, setProjectNameValue] = useState('')
  const projectNameRef = useRef<HTMLInputElement>(null)
  const [editingViewName, setEditingViewName] = useState(false)
  const [viewNameValue, setViewNameValue] = useState('')
  const viewNameRef = useRef<HTMLInputElement>(null)
  const { updateProject, archiveProject: archiveProjectAction, unarchiveProject: unarchiveProjectAction } = useProjectStore()
  const currentUser = useAuthStore((s) => s.currentUser)

  const { projectMembers, removedFromProject, setRemovedFromProject } = useSharedProjectRealtime(
    selectedProject,
    currentUser
  )

  const handleStartEditProjectName = useCallback(() => {
    if (currentView === 'project' && selectedProject) {
      setProjectNameValue(selectedProject.name)
      setEditingProjectName(true)
      setTimeout(() => projectNameRef.current?.focus(), 0)
    }
  }, [currentView, selectedProject])

  const handleSaveProjectName = useCallback(() => {
    const trimmed = projectNameValue.trim()
    if (trimmed && selectedProject && trimmed !== selectedProject.name) {
      updateProject(selectedProject.id, { name: trimmed })
    }
    setEditingProjectName(false)
  }, [projectNameValue, selectedProject, updateProject])

  const handleStartEditViewName = useCallback(() => {
    if (currentView === 'saved-view' && currentSavedView) {
      setViewNameValue(currentSavedView.name)
      setEditingViewName(true)
      setTimeout(() => viewNameRef.current?.select(), 0)
    }
  }, [currentView, currentSavedView])

  const handleSaveViewName = useCallback(() => {
    const trimmed = viewNameValue.trim()
    if (trimmed && currentSavedView && trimmed !== currentSavedView.name) {
      useSavedViewStore.getState().updateView(currentSavedView.id, { name: trimmed })
    }
    setEditingViewName(false)
  }, [viewNameValue, currentSavedView])

  // Auto-edit newly created saved views (name defaults to "New View")
  useEffect(() => {
    if (currentView === 'saved-view' && currentSavedView?.name === 'New View') {
      handleStartEditViewName()
    }
  }, [currentSavedView?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [saveTemplateWizard, setSaveTemplateWizard] = useState<ProjectTemplate | null>(null)

  const handleSaveProjectAsTemplate = useCallback(() => {
    if (!selectedProject || !currentUser) return
    const projStatuses = statuses
    const labelState = useLabelStore.getState()
    const projectLabelIds = labelState.projectLabels[selectedProject.id] ?? new Set()
    const labelsForProject = Array.from(projectLabelIds)
      .map((id) => labelState.labels[id])
      .filter((l): l is Label => l !== undefined)
    const tasksForProject = Object.values(allTasks).filter(
      (t) =>
        t.project_id === selectedProject.id &&
        t.is_archived === 0 &&
        t.is_template === 0 &&
        t.parent_id === null
    )

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msPerDay = 86400000

    const buildTaskTree = (task: Task): import('../../shared/types').ProjectTemplateTask => {
      const taskLabelNames = (useTaskStore.getState().taskLabels[task.id] ?? []).map((l) => l.name)
      const subtasks = Object.values(allTasks)
        .filter((t) => t.parent_id === task.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map(buildTaskTree)

      let dueDateOffset: number | null = null
      if (task.due_date) {
        const dueDate = new Date(task.due_date)
        const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
        dueDateOffset = Math.round((dueStart.getTime() - todayStart.getTime()) / msPerDay)
      }

      return {
        title: task.title,
        description: task.description,
        priority: task.priority,
        recurrence_rule: task.recurrence_rule,
        due_date_offset: dueDateOffset,
        order_index: task.order_index,
        labels: taskLabelNames,
        subtasks
      }
    }

    const data: ProjectTemplateData = {
      statuses: projStatuses.map((s) => ({
        name: s.name,
        color: s.color,
        icon: s.icon,
        order_index: s.order_index,
        is_done: s.is_done,
        is_default: s.is_default
      })),
      labels: labelsForProject.map((l) => ({
        name: l.name,
        color: l.color,
        order_index: l.order_index
      })),
      tasks: tasksForProject
        .sort((a, b) => a.order_index - b.order_index)
        .map(buildTaskTree)
    }

    setSaveTemplateWizard({
      id: crypto.randomUUID(),
      name: `${selectedProject.name} Template`,
      color: selectedProject.color,
      owner_id: currentUser.id,
      data: JSON.stringify(data),
      created_at: '',
      updated_at: '',
      deleted_at: null
    })
  }, [selectedProject, currentUser, statuses, allTasks])

  const handleArchiveCurrentProject = useCallback(async () => {
    if (!selectedProject) return
    const savedProject = selectedProject

    const doArchive = async (): Promise<void> => {
      try {
        await archiveProjectAction(savedProject.id)
        const updatedTasks: Record<string, Task> = {}
        for (const [tid, t] of Object.entries(useTaskStore.getState().tasks)) {
          updatedTasks[tid] = (t as Task).project_id === savedProject.id ? { ...(t as Task), is_archived: 1 } : (t as Task)
        }
        useTaskStore.setState({ tasks: updatedTasks })
        const remaining = sortedProjects.filter((p) => p.id !== savedProject.id)
        if (remaining.length > 0) setSelectedProject(remaining[0].id)
        else setView('my-day')
        addToast({
          message: `"${savedProject.name}" archived`,
          action: {
            label: 'Undo',
            onClick: async () => {
              await unarchiveProjectAction(savedProject.id)
              const tasks = { ...useTaskStore.getState().tasks }
              for (const [tid, t] of Object.entries(tasks)) {
                if ((t as Task).project_id === savedProject.id) tasks[tid] = { ...(t as Task), is_archived: 0 }
              }
              useTaskStore.setState({ tasks })
              setSelectedProject(savedProject.id)
              setView('project')
            }
          }
        })
      } catch (err) {
        addToast({ message: err instanceof Error ? err.message : 'Failed to archive project', variant: 'danger' })
      }
    }

    if (savedProject.is_shared === 1) {
      const members = await window.api.projects.getMembers(savedProject.id)
      const otherMembers = members.filter((m) => m.user_id !== currentUser?.id)
      const isOwner = savedProject.owner_id === currentUser?.id
      const message = `Archive "${savedProject.name}"? You will be removed from the shared project.${isOwner && otherMembers.length > 0 ? ' Ownership will be transferred to another member.' : ''}`
      addToast({
        message,
        persistent: true,
        actions: [
          {
            label: 'Archive',
            variant: 'danger' as const,
            onClick: async () => {
              if (isOwner && otherMembers.length > 0) {
                const firstMember = [...otherMembers].sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0]
                try {
                  const { getSupabase } = await import('./lib/supabase')
                  const supabase = await getSupabase()
                  await supabase.from('projects').update({ owner_id: firstMember.user_id }).eq('id', savedProject.id)
                } catch (err) { console.error('[Archive] Failed to transfer ownership:', err) }
              }
              if (currentUser) {
                try {
                  const { removeSharedMember, unsubscribeFromProject } = await import('./services/SyncService')
                  await removeSharedMember(savedProject.id, currentUser.id)
                  await unsubscribeFromProject(savedProject.id)
                } catch (err) { console.error('[Archive] Failed to leave shared project:', err) }
              }
              await window.api.projects.update(savedProject.id, { is_shared: 0 })
              await doArchive()
            }
          },
          { label: 'Cancel', variant: 'muted' as const, onClick: () => {} }
        ]
      })
      return
    }
    await doArchive()
  }, [selectedProject, sortedProjects, archiveProjectAction, unarchiveProjectAction, addToast, setView, setSelectedProject, currentUser])

  // Set grabbing cursor globally during drag (class overrides element cursors)
  useEffect(() => {
    if (dragState.isDragging) {
      document.documentElement.classList.add('is-dragging')
      return (): void => { document.documentElement.classList.remove('is-dragging') }
    }
    return undefined
  }, [dragState.isDragging])

  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const showDetailPanel = useTaskStore((s) => s.showDetailPanel)
  const detailPanelPosition = useViewStore((s) => s.detailPanelPosition)
  const hasDetailPanel = showDetailPanel && selectedTaskIds.size === 1
  const isSidePanel = detailPanelPosition === 'side'

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(event) => { dragWidthRef.current = (event.active.rect.current.initial?.width ?? 0); handleDragStart(event) }}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-screen w-screen bg-background text-foreground">
        {/* Sidebar */}
        <Sidebar
          viewCounts={viewCounts}
          projectCounts={projectCounts}
          projects={sortedProjects}
          onSettings={handleOpenSettings}
          onHelp={handleOpenHelp}
          onNewProject={() => setNewProjectOpen(true)}
          isDragging={dragState.isDragging}
        />

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <UpdateReadyBanner />
          <header className="relative flex h-[57px] items-center gap-3 border-b border-foreground/10 px-6">
            {currentView === 'project' && selectedProject && (
              <>
                <LayoutGrid size={16} className="flex-shrink-0 text-muted" />
                <ViewColorDot
                  color={selectedProject.color ?? '#6366f1'}
                  onChange={(c) => updateProject(selectedProject.id, { color: c })}
                />
              </>
            )}
            {currentView === 'saved-view' && currentSavedView && (
              <>
                <Filter size={16} className="flex-shrink-0 text-muted" />
                <ViewColorDot
                  color={currentSavedView.color ?? '#6366f1'}
                  onChange={(c) => useSavedViewStore.getState().updateView(currentSavedView.id, { color: c })}
                />
              </>
            )}
            {editingProjectName && currentView === 'project' ? (
              <input
                ref={projectNameRef}
                type="text"
                value={projectNameValue}
                onChange={(e) => setProjectNameValue(e.target.value)}
                onBlur={handleSaveProjectName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveProjectName()
                  if (e.key === 'Escape') { e.stopPropagation(); setEditingProjectName(false) }
                }}
                className="text-3xl font-light tracking-[0.15em] uppercase text-foreground bg-transparent focus:outline-none"
              />
            ) : editingViewName && currentView === 'saved-view' ? (
              <input
                ref={viewNameRef}
                type="text"
                value={viewNameValue}
                onChange={(e) => setViewNameValue(e.target.value)}
                onBlur={handleSaveViewName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveViewName()
                  if (e.key === 'Escape') { e.stopPropagation(); setEditingViewName(false) }
                }}
                className="text-3xl font-light tracking-[0.15em] uppercase text-foreground bg-transparent focus:outline-none"
              />
            ) : (
              <h1
                className={`text-3xl font-light tracking-[0.15em] uppercase text-foreground ${currentView === 'project' || currentView === 'saved-view' ? 'cursor-pointer' : ''}`}
                onDoubleClick={currentView === 'saved-view' ? handleStartEditViewName : handleStartEditProjectName}
              >
                {viewTitle}
              </h1>
            )}

            {currentView === 'project' && selectedProject && (
              <>
                {/* Share / Member avatars */}
                {selectedProject.is_shared === 1 && (
                  <MemberAvatars
                    members={projectMembers}
                    currentUserId={currentUser?.id ?? ''}
                    projectId={selectedProject.id}
                  />
                )}
                <ShareProjectMenu selectedProject={selectedProject} currentUser={currentUser} />
                <button
                  onClick={handleSaveProjectAsTemplate}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                  title="Save as Project Template"
                  aria-label="Save as Project Template"
                >
                  <LayoutTemplate size={16} />
                </button>
                <div className="group relative">
                  <button
                    onClick={handleArchiveCurrentProject}
                    disabled={sortedProjects.length <= 1}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors ${sortedProjects.length <= 1 ? 'opacity-30' : 'hover:bg-foreground/10 hover:text-foreground'}`}
                    aria-label="Archive project"
                  >
                    <Archive size={16} />
                  </button>
                  <div className="pointer-events-none absolute left-1/2 top-full mt-1.5 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted opacity-0 shadow-md ring-1 ring-border transition-opacity group-hover:opacity-100">
                    {sortedProjects.length <= 1 ? "Can't archive the last project" : 'Archive this project'}
                  </div>
                </div>
              </>
            )}

            {/* Saved view actions — clone + delete */}
            {currentView === 'saved-view' && currentSavedView && (
              <>
                <button
                  onClick={async () => {
                    const clone = await useSavedViewStore.getState().createView(currentUser?.id ?? '', `${currentSavedView.name} (copy)`, currentSavedView.filter_config)
                    if (currentSavedView.color) await useSavedViewStore.getState().updateView(clone.id, { color: currentSavedView.color })
                    useLabelStore.getState().clearLabelFilters()
                    useViewStore.getState().setSelectedSavedView(clone.id)
                  }}
                  className="rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                  title="Duplicate view"
                >
                  <Copy size={14} />
                </button>
                <button
                  onClick={async () => {
                    const viewData = { name: currentSavedView.name, filter_config: currentSavedView.filter_config, color: currentSavedView.color }
                    await useSavedViewStore.getState().deleteView(currentSavedView.id)
                    setView('my-day')
                    addToast({
                      message: `"${viewData.name}" deleted`,
                      variant: 'danger',
                      action: {
                        label: 'Undo',
                        onClick: async () => {
                          const restored = await useSavedViewStore.getState().createView(currentUser?.id ?? '', viewData.name, viewData.filter_config)
                          if (viewData.color) await useSavedViewStore.getState().updateView(restored.id, { color: viewData.color })
                          useViewStore.getState().setSelectedSavedView(restored.id)
                        }
                      }
                    })
                  }}
                  className="rounded p-1 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                  title="Delete view"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}

            {/* Layout toggle + notifications */}
            {(currentView === 'my-day' || currentView === 'project') && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={handleToggleLayoutMode}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                  title={`Switch to ${layoutMode === 'list' ? 'kanban' : 'list'} view (Cmd+L)`}
                  aria-label={`Switch to ${layoutMode === 'list' ? 'kanban' : 'list'} view`}
                >
                  {layoutMode === 'list' ? (
                    <Columns3 size={16} />
                  ) : (
                    <LayoutList size={16} />
                  )}
                  <span className="text-[11px] font-bold uppercase tracking-widest">
                    {layoutMode === 'list' ? 'Kanban' : 'List'}
                  </span>
                </button>
                <div className="relative">
                  <NotificationBell />
                  <NotificationPanel />
                </div>
              </div>
            )}
            {/* Show notification bell on non-project views too */}
            {currentView !== 'my-day' && currentView !== 'project' && (
              <div className="relative ml-auto">
                <NotificationBell />
                <NotificationPanel />
              </div>
            )}
          <SessionBanner />
          </header>

          {/* Content + Detail Panel layout */}
          <div className={`flex flex-1 overflow-hidden ${isSidePanel ? 'flex-row' : 'flex-col'}`}>
            {/* View content */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {currentView === 'my-day' && <MyDayView dropIndicator={dragState.dropIndicator} />}
              {currentView === 'project' && selectedProject && (
                <TaskListView
                  projectId={selectedProject.id}
                  projectName={selectedProject.name}
                  dropIndicator={dragState.dropIndicator}
                />
              )}
              {currentView === 'project' && !selectedProject && (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm font-light text-muted">No project selected.</p>
                </div>
              )}
              {currentView === 'stats' && <StatsView />}
              {currentView === 'saved-view' && <SavedViewListView />}
              {currentView === 'calendar' && <CalendarView />}
              {currentView === 'archive' && <ArchiveView />}
              {currentView === 'templates' && <TemplatesView />}
            </div>

            {/* Detail Panel */}
            {hasDetailPanel && <DetailPanel />}
          </div>
        </main>

        {/* Modals */}
        <UpdateAvailableModal />
        <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
        <UnifiedSettingsModal
          open={settingsOpen}
          onClose={() => { setSettingsOpen(false); setSettingsInitialTab(undefined) }}
          projectId={selectedProject?.id ?? null}
          initialTab={settingsInitialTab}
        />

        {/* Removed from shared project dialog */}
        {removedFromProject && (
          <RemovedFromProjectDialog
            removedFromProject={removedFromProject}
            currentUser={currentUser}
            onClose={() => setRemovedFromProject(null)}
          />
        )}

        {/* Toast notifications */}
        <ToastContainer />

        {/* Context menu */}
        <ContextMenu />
        <BulkContextMenu />

        {/* Timer overlay */}
        <TimerOverlay />

        {/* Delete confirmation */}
        <ConfirmDeleteModal />

        {/* Command palette */}
        <CommandPalette />

        {/* Keyboard shortcuts modal */}
        <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

        {/* Save project template wizard */}
        {saveTemplateWizard && currentUser && (
          <DeployProjectTemplateWizard
            template={saveTemplateWizard}
            currentUser={currentUser}
            onClose={() => setSaveTemplateWizard(null)}
            mode="save"
          />
        )}
      </div>

      {/* Drag overlay - ghost card */}
      <DragOverlay dropAnimation={null} modifiers={[lockHorizontal]}>
        {dragState.activeTask ? (
          layoutMode === 'kanban' ? (
            <KanbanCard
              task={dragState.activeTask}
              statuses={statuses}
              isSelected={false}
              isDragOverlay
              onSelect={() => {}}
              onStatusChange={() => {}}
              onDeleteTask={() => {}}
            />
          ) : (
            <TaskDragOverlay task={dragState.activeTask} width={dragWidthRef.current} />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

const VIEW_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#14b8a6', '#f97316', '#84cc16', '#e11d48']

function ViewColorDot({ color, onChange }: { color: string; onChange: (c: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="h-2.5 w-2.5 rounded-full transition-transform hover:scale-125"
        style={{ backgroundColor: color }}
        title="Change view color"
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="flex gap-1.5">
            {VIEW_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { onChange(c); setOpen(false) }}
                className={`h-4 w-4 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-foreground/30 ring-offset-1 ring-offset-surface' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
