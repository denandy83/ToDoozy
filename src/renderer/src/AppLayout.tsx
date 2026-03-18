import { useState, useCallback, useEffect, useMemo } from 'react'
import { ProjectSwitcher, NewProjectModal, ProjectSettingsModal } from './features/projects'
import { TaskListView } from './features/tasks'
import { Sidebar } from './features/sidebar'
import { DetailPanel } from './features/detail'
import { MyDayView } from './features/views/MyDayView'
import { ArchiveView } from './features/views/ArchiveView'
import { TemplatesView } from './features/views/TemplatesView'
import { useAuthStore } from './shared/stores/authStore'
import { useProjectStore, selectCurrentProject } from './shared/stores'
import { useTaskStore } from './shared/stores'
import { useViewStore } from './shared/stores/viewStore'
import type { ViewId } from './shared/stores/viewStore'
import { ToastContainer } from './shared/components/Toast'

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
  const currentProject = useProjectStore(selectCurrentProject)
  const logout = useAuthStore((s) => s.logout)
  const allTasks = useTaskStore((s) => s.tasks)
  const currentView = useViewStore((s) => s.currentView)
  const setView = useViewStore((s) => s.setView)
  const sidebarPinned = useViewStore((s) => s.sidebarPinned)
  const toggleSidebarPinned = useViewStore((s) => s.toggleSidebarPinned)
  const setSidebarExpanded = useViewStore((s) => s.setSidebarExpanded)
  const sidebarExpanded = useViewStore((s) => s.sidebarExpanded)

  const collapsed = !sidebarExpanded

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
    const tasks = Object.values(allTasks)
    const today = new Date().toISOString().split('T')[0]
    return {
      'my-day': tasks.filter(
        (t) =>
          t.is_archived === 0 &&
          t.is_template === 0 &&
          (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ).length,
      backlog: tasks.filter(
        (t) => t.is_archived === 0 && t.is_template === 0
      ).length,
      archive: tasks.filter((t) => t.is_archived === 1).length,
      templates: tasks.filter((t) => t.is_template === 1).length
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
  }, [currentView, setView])

  const viewTitle = VIEW_TITLES[currentView]
  const currentTaskId = useTaskStore((s) => s.currentTaskId)
  const detailPanelPosition = useViewStore((s) => s.detailPanelPosition)
  const hasDetailPanel = currentTaskId !== null
  const isSidePanel = detailPanelPosition === 'side'

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* Sidebar */}
      <Sidebar
        counts={viewCounts}
        onSettings={handleCurrentProjectSettings}
        onLogout={logout}
        collapsed={collapsed}
        pinned={sidebarPinned}
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
        </header>

        {/* Content + Detail Panel layout */}
        <div className={`flex flex-1 overflow-hidden ${isSidePanel ? 'flex-row' : 'flex-col'}`}>
          {/* View content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {currentView === 'my-day' && <MyDayView />}
            {currentView === 'backlog' && currentProject && (
              <TaskListView projectId={currentProject.id} projectName={currentProject.name} />
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

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
