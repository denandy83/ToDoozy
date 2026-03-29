import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type Modifier
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { LayoutList, Columns3, LayoutTemplate, Trash2 } from 'lucide-react'
import { NewProjectModal } from './features/projects'
import { UnifiedSettingsModal } from './features/settings/UnifiedSettingsModal'
import { TaskListView, TaskDragOverlay } from './features/tasks'
import { KanbanCard } from './features/tasks/KanbanCard'
import { useDragAndDrop } from './features/tasks/useDragAndDrop'
import { Sidebar } from './features/sidebar'
import { DetailPanel } from './features/detail'
import { MyDayView } from './features/views/MyDayView'
import { findProjectStatusForBucket, type BucketKey } from './features/views/myDayBuckets'
import { ArchiveView } from './features/views/ArchiveView'
import { TemplatesView } from './features/views/TemplatesView'
import { useThemeApplicator } from './shared/hooks/useThemeApplicator'
import { useProjectStore, selectAllProjects } from './shared/stores'
import { useStatusesByProject, useStatusStore } from './shared/stores'
import { useTaskStore } from './shared/stores'
import { useViewStore, selectLayoutMode, selectSelectedProjectId } from './shared/stores/viewStore'
import { useSettingsStore } from './shared/stores/settingsStore'
import { useLabelStore } from './shared/stores/labelStore'
import type { ViewId } from './shared/stores/viewStore'
import { useAuthStore } from './shared/stores/authStore'
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
import { shouldForceDelete } from './shared/utils/shiftDelete'
import { closeTopPopup } from './shared/utils/popupStack'

export function AppLayout(): React.JSX.Element {
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Apply current theme CSS variables
  useThemeApplicator()
  const allProjects = useProjectStore(selectAllProjects)
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
    })
    const unsubMyDay = window.api.tray.onNavigateToMyDay(() => {
      rawSetView('my-day')
    })
    return () => {
      unsubTask()
      unsubMyDay()
    }
  }, [rawSetView])

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

  const sidebarPinned = useViewStore((s) => s.sidebarPinned)
  const toggleSidebarPinned = useViewStore((s) => s.toggleSidebarPinned)
  const setSidebarExpanded = useViewStore((s) => s.setSidebarExpanded)
  const sidebarExpanded = useViewStore((s) => s.sidebarExpanded)
  const { addToast } = useToast()

  const projectId = selectedProject?.id ?? ''
  const statuses = useStatusesByProject(projectId)

  const collapsed = !sidebarExpanded

  // Snap drag overlay top-left to cursor position
  const snapToPointer: Modifier = useCallback(({ activatorEvent, draggingNodeRect, transform }) => {
    if (draggingNodeRect && activatorEvent) {
      const coords = getEventCoordinates(activatorEvent)
      if (coords) {
        return {
          ...transform,
          x: transform.x + (coords.x - draggingNodeRect.left),
          y: transform.y + (coords.y - draggingNodeRect.top)
        }
      }
    }
    return transform
  }, [])

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 }
  })
  const sensors = useSensors(pointerSensor)

  const tasks = useTaskStore((s) => s.tasks)

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
      if (targetStatus && targetStatus.id !== task.status_id) {
        await handleDndStatusChange(taskId, targetStatus.id)
      }
    },
    [tasks, handleDndStatusChange]
  )

  const { dragState, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel, collisionDetection } =
    useDragAndDrop({
      tasks,
      onReorder: reorderTasks,
      onReparent: handleReparent,
      onMoveToView: handleMoveToView,
      onStatusChange: handleDndStatusChange,
      onBucketDrop: handleBucketDrop,
      getTasksForParent,
      getSelectedTaskIds: () => [...useTaskStore.getState().selectedTaskIds]
    })

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  const handleSidebarMouseEnter = useCallback(() => {
    if (!sidebarPinned) {
      setSidebarExpanded(true)
    }
  }, [sidebarPinned, setSidebarExpanded])

  const handleSidebarMouseLeave = useCallback(() => {
    if (!sidebarPinned) {
      setSidebarExpanded(false)
    }
  }, [sidebarPinned, setSidebarExpanded])

  // View task counts
  const projectTemplates = useTemplateStore(selectAllProjectTemplates)
  const viewCounts = useMemo(() => {
    const taskList = Object.values(allTasks)
    const today = new Date().toISOString().split('T')[0]
    const taskTemplateCount = taskList.filter((t) => t.is_template === 1 && t.parent_id === null).length
    return {
      'my-day': taskList.filter(
        (t) =>
          t.is_archived === 0 &&
          t.is_template === 0 &&
          t.parent_id === null &&
          (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ).length,
      archive: taskList.filter((t) => t.is_archived === 1 && t.parent_id === null).length,
      templates: taskTemplateCount + projectTemplates.length
    }
  }, [allTasks, projectTemplates])

  // Per-project task counts
  const projectCounts = useMemo(() => {
    const taskList = Object.values(allTasks)
    const counts: Record<string, number> = {}
    for (const project of allProjects) {
      counts[project.id] = taskList.filter(
        (t) =>
          t.project_id === project.id &&
          t.is_archived === 0 &&
          t.is_template === 0 &&
          t.parent_id === null
      ).length
    }
    return counts
  }, [allTasks, allProjects])

  const handleOpenHelp = useCallback(() => {
    setHelpOpen(true)
  }, [])

  // Global Escape: close topmost popup (calendar, dropdowns, etc.) before anything else fires
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (closeTopPopup()) {
        e.preventDefault()
        e.stopPropagation()
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

      // Cmd+1 = My Day
      if (e.key === '1') {
        e.preventDefault()
        setView('my-day')
        return
      }

      // Cmd+2 = Project view (topmost project)
      if (e.key === '2') {
        e.preventDefault()
        if (sortedProjects.length > 0) {
          clearLabelFilters()
          useTaskStore.getState().clearSelection()
          setSelectedProject(sortedProjects[0].id)
        }
        return
      }

      // Cmd+3 = Archive
      if (e.key === '3') {
        e.preventDefault()
        setView('archive')
        return
      }

      // Cmd+4 = Templates
      if (e.key === '4') {
        e.preventDefault()
        setView('templates')
        return
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
  }, [currentView, selectedProjectId, sortedProjects, setView, setSelectedProject, clearLabelFilters, handleToggleLayoutMode])

  // Dynamic view title
  const viewTitle = useMemo(() => {
    if (currentView === 'my-day') return 'My Day'
    if (currentView === 'project' && selectedProject) return selectedProject.name
    if (currentView === 'archive') return 'Archive'
    if (currentView === 'templates') return 'Templates'
    return ''
  }, [currentView, selectedProject])

  const [editingProjectName, setEditingProjectName] = useState(false)
  const [projectNameValue, setProjectNameValue] = useState('')
  const projectNameRef = useRef<HTMLInputElement>(null)
  const { updateProject, deleteProject } = useProjectStore()
  const currentUser = useAuthStore((s) => s.currentUser)

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

    const buildTaskTree = (task: Task): import('../../shared/types').ProjectTemplateTask => {
      const taskLabelNames = (useTaskStore.getState().taskLabels[task.id] ?? []).map((l) => l.name)
      const subtasks = Object.values(allTasks)
        .filter((t) => t.parent_id === task.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map(buildTaskTree)
      return {
        title: task.title,
        description: task.description,
        priority: task.priority,
        recurrence_rule: task.recurrence_rule,
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
      updated_at: ''
    })
  }, [selectedProject, currentUser, statuses, allTasks])

  const handleDeleteCurrentProject = useCallback(async (e: React.MouseEvent) => {
    if (!selectedProject) return
    if (sortedProjects.length <= 1) return
    const doDelete = async (): Promise<void> => {
      try {
        await deleteProject(selectedProject.id)
        const remainingTasks: Record<string, Task> = {}
        for (const [id, t] of Object.entries(useTaskStore.getState().tasks)) {
          if ((t as Task).project_id !== selectedProject.id) remainingTasks[id] = t as Task
        }
        useTaskStore.setState({ tasks: remainingTasks })
        const remaining = sortedProjects.filter((p) => p.id !== selectedProject.id)
        if (remaining.length > 0) {
          useViewStore.getState().setSelectedProject(remaining[0].id)
        } else {
          setView('my-day')
        }
        addToast({ message: `Deleted "${selectedProject.name}"`, variant: 'danger' })
      } catch (err) {
        addToast({ message: err instanceof Error ? err.message : 'Failed to delete project', variant: 'danger' })
      }
    }
    if (shouldForceDelete(e)) {
      await doDelete()
      return
    }
    const allTaskValues = Object.values(useTaskStore.getState().tasks) as Task[]
    const projectTasks = allTaskValues.filter((t) => t.project_id === selectedProject.id && t.is_archived === 0)
    const archivedTasks = allTaskValues.filter((t) => t.project_id === selectedProject.id && t.is_archived === 1)
    const parts = [`Delete "${selectedProject.name}"?`]
    if (projectTasks.length > 0 || archivedTasks.length > 0) {
      const counts: string[] = []
      if (projectTasks.length > 0) counts.push(`${projectTasks.length} task${projectTasks.length !== 1 ? 's' : ''}`)
      if (archivedTasks.length > 0) counts.push(`${archivedTasks.length} archived`)
      parts.push(`This will delete ${counts.join(' and ')}.`)
    }
    addToast({
      message: parts.join(' '),
      persistent: true,
      actions: [
        { label: 'Delete', variant: 'danger' as const, onClick: async () => { await doDelete() } },
        { label: 'Cancel', variant: 'muted' as const, onClick: () => {} }
      ]
    })
  }, [selectedProject, sortedProjects, deleteProject, addToast, setView])

  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const showDetailPanel = useTaskStore((s) => s.showDetailPanel)
  const detailPanelPosition = useViewStore((s) => s.detailPanelPosition)
  const hasDetailPanel = showDetailPanel && selectedTaskIds.size === 1
  const isSidePanel = detailPanelPosition === 'side'

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
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
          collapsed={collapsed}
          pinned={sidebarPinned}
          isDragging={dragState.isDragging}
          onTogglePin={toggleSidebarPinned}
          onMouseEnter={handleSidebarMouseEnter}
          onMouseLeave={handleSidebarMouseLeave}
        />

        {/* Main content area */}
        <main className={`flex flex-1 flex-col overflow-hidden transition-opacity duration-150 ${dragState.isDragging ? 'opacity-40' : 'opacity-100'}`}>
          <header className="flex h-[57px] items-center gap-3 border-b border-border px-6">
            {currentView === 'project' && selectedProject && (
              <div
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: selectedProject.color }}
              />
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
            ) : (
              <h1
                className={`text-3xl font-light tracking-[0.15em] uppercase text-foreground ${currentView === 'project' ? 'cursor-pointer' : ''}`}
                onDoubleClick={handleStartEditProjectName}
              >
                {viewTitle}
              </h1>
            )}

            {currentView === 'project' && selectedProject && (
              <>
                <button
                  onClick={handleSaveProjectAsTemplate}
                  className="ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                  title="Save as Project Template"
                  aria-label="Save as Project Template"
                >
                  <LayoutTemplate size={16} />
                </button>
                <div className="group relative">
                  <button
                    onClick={handleDeleteCurrentProject}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors ${sortedProjects.length <= 1 ? 'opacity-30' : 'hover:bg-danger/10 hover:text-danger'}`}
                    aria-label="Delete project"
                  >
                    <Trash2 size={16} />
                  </button>
                  <div className="pointer-events-none absolute left-1/2 top-full mt-1.5 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted opacity-0 shadow-md ring-1 ring-border transition-opacity group-hover:opacity-100">
                    {sortedProjects.length <= 1 ? "Can't delete the last project" : 'Shift+click to skip confirmation'}
                  </div>
                </div>
              </>
            )}

            {/* Layout toggle */}
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
              </div>
            )}
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
              {currentView === 'archive' && <ArchiveView />}
              {currentView === 'templates' && <TemplatesView />}
            </div>

            {/* Detail Panel */}
            {hasDetailPanel && <DetailPanel />}
          </div>
        </main>

        {/* Modals */}
        <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
        <UnifiedSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          projectId={selectedProject?.id ?? null}
        />

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
      <DragOverlay dropAnimation={null} modifiers={[snapToPointer]}>
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
            <TaskDragOverlay task={dragState.activeTask} statuses={statuses} count={selectedTaskIds.size > 1 && selectedTaskIds.has(dragState.activeTask.id) ? selectedTaskIds.size : 1} />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
