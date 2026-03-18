import { useState, useCallback } from 'react'
import { Settings, LogOut } from 'lucide-react'
import { ProjectSwitcher, NewProjectModal, ProjectSettingsModal } from './features/projects'
import { TaskListView } from './features/tasks'
import { useAuthStore } from './shared/stores/authStore'
import { useProjectStore, selectCurrentProject } from './shared/stores'
import { ToastContainer } from './shared/components/Toast'

export function AppLayout(): React.JSX.Element {
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)
  const currentProject = useProjectStore(selectCurrentProject)
  const logout = useAuthStore((s) => s.logout)

  const handleProjectSettings = useCallback((projectId: string) => {
    setSettingsProjectId(projectId)
  }, [])

  const handleCurrentProjectSettings = useCallback(() => {
    if (currentProject) {
      setSettingsProjectId(currentProject.id)
    }
  }, [currentProject])

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border bg-surface">
        {/* Sidebar header — project switcher */}
        <div className="border-b border-border p-3">
          <ProjectSwitcher
            onNewProject={() => setNewProjectOpen(true)}
            onProjectSettings={handleProjectSettings}
          />
        </div>

        {/* Nav items placeholder — will be built in Story 9 */}
        <nav className="flex-1 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Views</p>
          <p className="mt-2 text-sm font-light text-muted/60">Coming soon...</p>
        </nav>

        {/* Sidebar footer */}
        <div className="flex items-center gap-1 border-t border-border p-3">
          <button
            onClick={handleCurrentProjectSettings}
            className="flex-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted transition-colors hover:bg-foreground/6"
            title="Project settings"
          >
            <Settings size={14} />
            <span className="text-[11px] font-bold uppercase tracking-widest">Settings</span>
          </button>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center border-b border-border px-6 py-4">
          <h1 className="text-3xl font-light tracking-[0.15em] uppercase text-foreground">
            {currentProject?.name ?? 'ToDoozy'}
          </h1>
        </header>
        {currentProject ? (
          <TaskListView projectId={currentProject.id} projectName={currentProject.name} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm font-light text-muted">No project selected.</p>
          </div>
        )}
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
