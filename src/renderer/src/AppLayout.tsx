import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { LayoutList, Columns3 } from 'lucide-react'
import { ProjectSwitcher, NewProjectModal, ProjectSettingsModal } from './features/projects'
import { ThemeSettingsModal, PrioritySettingsModal } from './features/settings'
import { TaskListView, TaskDragOverlay } from './features/tasks'
import { useDragAndDrop } from './features/tasks/useDragAndDrop'
import { Sidebar } from './features/sidebar'
import { DetailPanel } from './features/detail'
import { MyDayView } from './features/views/MyDayView'
import { ArchiveView } from './features/views/ArchiveView'
import { TemplatesView } from './features/views/TemplatesView'
import { useThemeApplicator } from './shared/hooks/useThemeApplicator'
import { useAuthStore } from './shared/stores/authStore'
import { useProjectStore, selectCurrentProject } from './shared/stores'
import { useStatusesByProject } from './shared/stores'
import { useTaskStore } from './shared/stores'
import { useViewStore, selectLayoutMode } from './shared/stores/viewStore'
import { useLabelStore } from './shared/stores/labelStore'
import type { ViewId } from './shared/stores/viewStore'
import { useToast } from './shared/components/Toast'
import { ToastContainer } from './shared/components/Toast'
import { ContextMenu } from './shared/components/ContextMenu'
import { CommandPalette } from './features/command-palette'
import { useCommandPaletteStore } from './shared/stores/commandPaletteStore'
import type { Task } from '../../shared/types'

const VIEW_TITLES: Record<ViewId, string> = {
  'my-day': 'My Day',
  backlog: 'Backlog',
  archive: 'Archive',
  templates: 'Templates'
}

const VIEW_SHORTCUTS: ViewId[] = ['my-day', 'backlog', 'archive', 'templates']

export function AppLayout(): React.JSX.Element {
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false)
  const [prioritySettingsOpen, setPrioritySettingsOpen] = useState(false)

  // Apply current theme CSS variables
  useThemeApplicator()
  const currentProject = useProjectStore(selectCurrentProject)
  const logout = useAuthStore((s) => s.logout)
  const allTasks = useTaskStore((s) => s.tasks)
  const { updateTask, reorderTasks } = useTaskStore()
  const currentView = useViewStore((s) => s.currentView)
  const rawSetView = useViewStore((s) => s.setView)
  const layoutMode = useViewStore(selectLayoutMode)
  const toggleLayoutMode = useViewStore((s) => s.toggleLayoutMode)
  const clearLabelFilters = useLabelStore((s) => s.clearLabelFilters)

  // Auto-clear label filters on view switch, reset kanban for non-supported views
  const setView = useCallback(
    (view: ViewId) => {
      clearLabelFilters()
      if (view !== 'my-day' && view !== 'backlog') {
        useViewStore.setState({ layoutMode: 'list' })
      }
      rawSetView(view)
    },
    [clearLabelFilters, rawSetView]
  )
  const sidebarPinned = useViewStore((s) => s.sidebarPinned)
  const toggleSidebarPinned = useViewStore((s) => s.toggleSidebarPinned)
  const setSidebarExpanded = useViewStore((s) => s.setSidebarExpanded)
  const sidebarExpanded = useViewStore((s) => s.sidebarExpanded)
  const { addToast } = useToast()

  const projectId = currentProject?.id ?? ''
  const statuses = useStatusesByProject(projectId)

  const collapsed = !sidebarExpanded

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 }
  })
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  })
  const sensors = useSensors(pointerSensor, keyboardSensor)

  // DnD helpers
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
      } else if (viewId === 'backlog') {
        await updateTask(taskId, { is_in_my_day: 0 })
        addToast({ message: 'Removed from My Day' })
      } else if (viewId === 'archive') {
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

  const handleProjectSettings = useCallback((projectId: string) => {
    setSettingsProjectId(projectId)
  }, [])

  const handleCurrentProjectSettings = useCallback(() => {
    if (currentProject) {
      setSettingsProjectId(currentProject.id)
    }
  }, [currentProject])

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
          (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ).length,
      backlog: taskList.filter(
        (t) => t.is_archived === 0 && t.is_template === 0
      ).length,
      archive: taskList.filter((t) => t.is_archived === 1).length,
      templates: taskList.filter((t) => t.is_template === 1).length
    }
  }, [allTasks])

  // Global keyboard shortcuts: Cmd+1-4, Cmd+[, Cmd+]
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return

      // Cmd+1 through Cmd+4
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= 4) {
        e.preventDefault()
        setView(VIEW_SHORTCUTS[num - 1])
        return
      }

      // Cmd+K = open command palette
      if (e.key === 'k') {
        e.preventDefault()
        useCommandPaletteStore.getState().open()
        return
      }

      // Cmd+L = toggle kanban/list (only on my-day and backlog)
      if (e.key === 'l') {
        const view = useViewStore.getState().currentView
        if (view === 'my-day' || view === 'backlog') {
          e.preventDefault()
          toggleLayoutMode()
        }
        return
      }

      // Cmd+[ = prev view, Cmd+] = next view
      if (e.key === '[') {
        e.preventDefault()
        const idx = VIEW_SHORTCUTS.indexOf(currentView)
        const prev = VIEW_SHORTCUTS[(idx - 1 + VIEW_SHORTCUTS.length) % VIEW_SHORTCUTS.length]
        setView(prev)
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        const idx = VIEW_SHORTCUTS.indexOf(currentView)
        const next = VIEW_SHORTCUTS[(idx + 1) % VIEW_SHORTCUTS.length]
        setView(next)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView, setView, toggleLayoutMode])

  const viewTitle = VIEW_TITLES[currentView]
  const currentTaskId = useTaskStore((s) => s.currentTaskId)
  const detailPanelPosition = useViewStore((s) => s.detailPanelPosition)
  const hasDetailPanel = currentTaskId !== null
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
          counts={viewCounts}
          onSettings={handleCurrentProjectSettings}
          onThemeSettings={() => setThemeSettingsOpen(true)}
          onPrioritySettings={() => setPrioritySettingsOpen(true)}
          onLogout={logout}
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
            <h1 className="text-3xl font-light tracking-[0.15em] uppercase text-foreground">
              {viewTitle}
            </h1>
            {currentView === 'backlog' && currentProject && (
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: currentProject.color }}
                />
                <ProjectSwitcher
                  onNewProject={() => setNewProjectOpen(true)}
                  onProjectSettings={handleProjectSettings}
                />
              </div>
            )}

            {/* Layout toggle - only on views that support kanban */}
            {(currentView === 'my-day' || currentView === 'backlog') && (
              <div className="ml-auto flex items-center">
                <button
                  onClick={toggleLayoutMode}
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
              {currentView === 'backlog' && currentProject && (
                <TaskListView
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  dropIndicator={dragState.dropIndicator}
                />
              )}
              {currentView === 'backlog' && !currentProject && (
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
        <ProjectSettingsModal
          open={settingsProjectId !== null}
          onClose={() => setSettingsProjectId(null)}
          projectId={settingsProjectId}
        />
        <ThemeSettingsModal
          open={themeSettingsOpen}
          onClose={() => setThemeSettingsOpen(false)}
        />
        <PrioritySettingsModal
          open={prioritySettingsOpen}
          onClose={() => setPrioritySettingsOpen(false)}
        />

        {/* Toast notifications */}
        <ToastContainer />

        {/* Context menu */}
        <ContextMenu />

        {/* Command palette */}
        <CommandPalette />
      </div>

      {/* Drag overlay - ghost card */}
      <DragOverlay dropAnimation={null}>
        {dragState.activeTask ? (
          <TaskDragOverlay task={dragState.activeTask} statuses={statuses} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
