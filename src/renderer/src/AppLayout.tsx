import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { LayoutList, Columns3 } from 'lucide-react'
import { NewProjectModal } from './features/projects'
import { UnifiedSettingsModal } from './features/settings/UnifiedSettingsModal'
import { TaskListView, TaskDragOverlay } from './features/tasks'
import { KanbanCard } from './features/tasks/KanbanCard'
import { useDragAndDrop } from './features/tasks/useDragAndDrop'
import { Sidebar } from './features/sidebar'
import { DetailPanel } from './features/detail'
import { MyDayView } from './features/views/MyDayView'
import { ArchiveView } from './features/views/ArchiveView'
import { TemplatesView } from './features/views/TemplatesView'
import { useThemeApplicator } from './shared/hooks/useThemeApplicator'
import { useProjectStore, selectAllProjects } from './shared/stores'
import { useStatusesByProject } from './shared/stores'
import { useTaskStore } from './shared/stores'
import { useViewStore, selectLayoutMode, selectSelectedProjectId } from './shared/stores/viewStore'
import { useSettingsStore } from './shared/stores/settingsStore'
import { useLabelStore } from './shared/stores/labelStore'
import type { ViewId } from './shared/stores/viewStore'
import { useToast } from './shared/components/Toast'
import { ToastContainer } from './shared/components/Toast'
import { ContextMenu } from './shared/components/ContextMenu'
import { BulkContextMenu } from './shared/components/BulkContextMenu'
import { ConfirmDeleteModal } from './shared/components/ConfirmDeleteModal'
import { CommandPalette } from './features/command-palette'
import { useCommandPaletteStore } from './shared/stores/commandPaletteStore'
import type { Task } from '../../shared/types'

export function AppLayout(): React.JSX.Element {
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { delay: 200, tolerance: 5 }
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
      const update: { parent_id: string | null; status_id?: string } = {
        parent_id: newParentId
      }
      if (newParentId) {
        const parent = tasks[newParentId]
        if (parent) {
          update.status_id = parent.status_id
        }
      }
      await updateTask(taskId, update)
    },
    [tasks, updateTask]
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
    async (taskId: string, viewId: string) => {
      if (viewId === 'my-day') {
        await updateTask(taskId, { is_in_my_day: 1 })
        addToast({ message: 'Added to My Day' })
      } else if (viewId.startsWith('nav-project-')) {
        // Dropped on a project nav item — move to that project
        const targetProjectId = viewId.replace('nav-project-', '')
        await updateTask(taskId, { is_in_my_day: 0 })
        // Could also change project_id if needed
        addToast({ message: 'Removed from My Day' })
        void targetProjectId
      } else if (viewId === 'archive' || viewId === 'nav-archive') {
        await updateTask(taskId, { is_archived: 1 })
        addToast({ message: 'Archived' })
      }
    },
    [updateTask, addToast]
  )

  const { dragState, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel, collisionDetection } =
    useDragAndDrop({
      tasks,
      onReorder: reorderTasks,
      onReparent: handleReparent,
      onMoveToView: handleMoveToView,
      onStatusChange: handleDndStatusChange,
      getTasksForParent
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
  const viewCounts = useMemo(() => {
    const taskList = Object.values(allTasks)
    const today = new Date().toISOString().split('T')[0]
    return {
      'my-day': taskList.filter(
        (t) =>
          t.is_archived === 0 &&
          t.is_template === 0 &&
          t.parent_id === null &&
          (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ).length,
      archive: taskList.filter((t) => t.is_archived === 1 && t.parent_id === null).length,
      templates: taskList.filter((t) => t.is_template === 1 && t.parent_id === null).length
    }
  }, [allTasks])

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

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Tab/Shift+Tab cycles projects when in project view
      if (e.key === 'Tab' && currentView === 'project' && sortedProjects.length > 1) {
        const target = e.target as HTMLElement
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
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

      // Cmd+K = open command palette
      if (e.key === 'k') {
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
          collapsed={collapsed}
          pinned={sidebarPinned}
          isDragging={dragState.isDragging}
          onTogglePin={toggleSidebarPinned}
          onMouseEnter={handleSidebarMouseEnter}
          onMouseLeave={handleSidebarMouseLeave}
        />

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border px-6 py-4">
            {currentView === 'project' && selectedProject && (
              <div
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: selectedProject.color }}
              />
            )}
            <h1 className="text-3xl font-light tracking-[0.15em] uppercase text-foreground">
              {viewTitle}
            </h1>

            {/* Layout toggle - only on views that support kanban */}
            {(currentView === 'my-day' || currentView === 'project') && (
              <div className="ml-auto flex items-center">
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

        {/* Delete confirmation */}
        <ConfirmDeleteModal />

        {/* Command palette */}
        <CommandPalette />
      </div>

      {/* Drag overlay - ghost card */}
      <DragOverlay dropAnimation={null}>
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
            <TaskDragOverlay task={dragState.activeTask} statuses={statuses} />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
