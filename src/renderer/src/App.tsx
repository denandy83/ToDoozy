import { useEffect } from 'react'
import { useAuthStore } from './shared/stores/authStore'
import { useProjectStore } from './shared/stores/projectStore'
import { useStatusStore } from './shared/stores/statusStore'
import { useLabelStore } from './shared/stores/labelStore'
import { useTaskStore } from './shared/stores/taskStore'
import { useSettingsStore } from './shared/stores/settingsStore'
import { useTemplateStore } from './shared/stores/templateStore'
import { useTimerStore } from './shared/stores/timerStore'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppLayout } from './AppLayout'

function App(): React.JSX.Element {
  const { isAuthenticated, loading, currentUser, initAuth } = useAuthStore()
  const { hydrateProjects, currentProjectId } = useProjectStore()
  const { hydrateStatuses } = useStatusStore()
  const { hydrateLabels } = useLabelStore()
  const { hydrateAllForProject } = useTaskStore()
  const { hydrateSettings, hydrateThemes } = useSettingsStore()
  const { hydrateProjectTemplates } = useTemplateStore()

  useEffect(() => {
    initAuth()
  }, [initAuth])

  // Hydrate settings and themes on mount
  useEffect(() => {
    hydrateSettings()
    hydrateThemes()
  }, [hydrateSettings, hydrateThemes])

  // Hydrate projects when authenticated + set tray user ID
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      hydrateProjects(currentUser.id)
      hydrateProjectTemplates()
      window.api.tray.setUserId(currentUser.id)
    }
  }, [isAuthenticated, currentUser, hydrateProjects, hydrateProjectTemplates])

  // Hydrate statuses and all tasks (regular + my day + archived + templates) when project changes
  useEffect(() => {
    if (currentProjectId && currentUser) {
      hydrateStatuses(currentProjectId)
      hydrateLabels(currentProjectId)
      hydrateAllForProject(currentProjectId, currentUser.id)
    }
  }, [currentProjectId, currentUser, hydrateStatuses, hydrateLabels, hydrateAllForProject])

  // Listen for data-changed from other processes (e.g. MCP server, quick-add)
  const hydrateMyDay = useTaskStore((s) => s.hydrateMyDay)
  const hydrateAllTaskLabels = useTaskStore((s) => s.hydrateAllTaskLabels)
  useEffect(() => {
    if (!currentProjectId || !currentUser) return
    const unsub = window.api.onTasksChanged(() => {
      hydrateProjects(currentUser.id)
      hydrateStatuses(currentProjectId)
      hydrateLabels(currentProjectId)
      hydrateAllForProject(currentProjectId, currentUser.id)
      hydrateAllTaskLabels(currentProjectId)
      hydrateMyDay(currentUser.id)
    })
    return unsub
  }, [currentProjectId, currentUser, hydrateProjects, hydrateStatuses, hydrateLabels, hydrateAllForProject, hydrateAllTaskLabels, hydrateMyDay])

  // Refresh tray badge when tasks change
  useEffect(() => {
    const unsub = useTaskStore.subscribe(() => {
      window.api.tray.refresh()
    })
    return unsub
  }, [])

  // Listen for timer controls from tray
  useEffect(() => {
    const unsubPause = window.api.timer.onPause(() => {
      useTimerStore.getState().pause()
    })
    const unsubResume = window.api.timer.onResume(() => {
      useTimerStore.getState().resume()
    })
    const unsubStop = window.api.timer.onStop(() => {
      useTimerStore.getState().stop()
    })
    return () => {
      unsubPause()
      unsubResume()
      unsubStop()
    }
  }, [])

  // Auto-archive: periodically check for done tasks past the threshold
  useEffect(() => {
    if (!isAuthenticated) return

    const checkAutoArchive = async (): Promise<void> => {
      const settings = useSettingsStore.getState().settings
      if (settings['auto_archive_enabled'] !== 'true') return

      const value = parseInt(settings['auto_archive_value'] ?? '3', 10)
      const unit = settings['auto_archive_unit'] ?? 'days'
      if (!value || value <= 0) return

      const thresholdMs = unit === 'hours' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000
      const now = Date.now()
      const allTasks = useTaskStore.getState().tasks
      const { updateTask: doUpdate } = useTaskStore.getState()

      for (const task of Object.values(allTasks)) {
        if (task.is_archived === 1 || !task.completed_date) continue
        const completedAt = new Date(task.completed_date).getTime()
        if (now - completedAt >= thresholdMs) {
          await doUpdate(task.id, { is_archived: 1 })
        }
      }
    }

    // Check on mount and every 5 minutes
    checkAutoArchive()
    const interval = setInterval(checkAutoArchive, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [isAuthenticated])

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
