import { useEffect } from 'react'
import { useAuthStore } from './shared/stores/authStore'
import { useProjectStore } from './shared/stores/projectStore'
import { useStatusStore } from './shared/stores/statusStore'
import { useLabelStore } from './shared/stores/labelStore'
import { useTaskStore } from './shared/stores/taskStore'
import { useSettingsStore } from './shared/stores/settingsStore'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppLayout } from './AppLayout'

function App(): React.JSX.Element {
  const { isAuthenticated, loading, currentUser, initAuth } = useAuthStore()
  const { hydrateProjects, currentProjectId } = useProjectStore()
  const { hydrateStatuses } = useStatusStore()
  const { hydrateLabels } = useLabelStore()
  const { hydrateAllForProject } = useTaskStore()
  const { hydrateSettings, hydrateThemes } = useSettingsStore()

  useEffect(() => {
    initAuth()
  }, [initAuth])

  // Hydrate settings and themes on mount
  useEffect(() => {
    hydrateSettings()
    hydrateThemes()
  }, [hydrateSettings, hydrateThemes])

  // Hydrate projects when authenticated
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      hydrateProjects(currentUser.id)
    }
  }, [isAuthenticated, currentUser, hydrateProjects])

  // Hydrate statuses and all tasks (regular + my day + archived + templates) when project changes
  useEffect(() => {
    if (currentProjectId && currentUser) {
      hydrateStatuses(currentProjectId)
      hydrateLabels(currentProjectId)
      hydrateAllForProject(currentProjectId, currentUser.id)
    }
  }, [currentProjectId, currentUser, hydrateStatuses, hydrateLabels, hydrateAllForProject])

  // Listen for tasks-changed from other windows (e.g. quick-add)
  useEffect(() => {
    if (!currentProjectId || !currentUser) return
    const unsub = window.api.onTasksChanged(() => {
      hydrateAllForProject(currentProjectId, currentUser.id)
    })
    return unsub
  }, [currentProjectId, currentUser, hydrateAllForProject])

  if (loading) {
    return <SplashScreen />
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  return <AppLayout />
}

function SplashScreen(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15">
        <span className="text-2xl font-bold tracking-tight text-accent">TD</span>
      </div>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-border">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      </div>
    </div>
  )
}

export default App
