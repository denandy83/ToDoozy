import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from './shared/stores/authStore'
import { useProjectStore } from './shared/stores/projectStore'
import { useStatusStore } from './shared/stores/statusStore'
import { useLabelStore } from './shared/stores/labelStore'
import { useTaskStore } from './shared/stores/taskStore'
import { useSettingsStore } from './shared/stores/settingsStore'
import { useTemplateStore } from './shared/stores/templateStore'
import { useTimerStore } from './shared/stores/timerStore'
import { useUpdateStore } from './shared/stores/updateStore'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppLayout } from './AppLayout'
import { UpdateDialog } from './shared/components/UpdateDialog'
import { InviteDialog } from './features/collaboration/InviteDialog'
import { validateInviteToken, acceptInvite, declineInvite, subscribeToProject, checkPendingInvites, subscribeToInvites } from './services/SyncService'
import { useViewStore } from './shared/stores/viewStore'

function App(): React.JSX.Element {
  const { isAuthenticated, loading, currentUser, initAuth } = useAuthStore()
  const { hydrateProjects, currentProjectId } = useProjectStore()
  const { hydrateStatuses } = useStatusStore()
  const { hydrateLabels } = useLabelStore()
  const { hydrateAllForProject } = useTaskStore()
  const { setUserId: setSettingsUserId, hydrateSettings, hydrateThemes } = useSettingsStore()
  const { hydrateProjectTemplates } = useTemplateStore()

  useEffect(() => {
    initAuth()
  }, [initAuth])

  // Initialize updater (app-level, not per-user)
  useEffect(() => {
    const initUpdate = useUpdateStore.getState().init()
    return () => {
      initUpdate.then((unsub) => unsub())
    }
  }, [])

  // Hydrate settings, themes, projects when authenticated
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      setSettingsUserId(currentUser.id)
      hydrateSettings()
      hydrateThemes()
      hydrateProjects(currentUser.id)
      hydrateProjectTemplates(currentUser.id)
      window.api.tray.setUserId(currentUser.id)
    }
  }, [isAuthenticated, currentUser, setSettingsUserId, hydrateSettings, hydrateThemes, hydrateProjects, hydrateProjectTemplates])

  // On startup, sync all shared projects from Supabase + discover missing ones
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return
    const syncShared = async (): Promise<void> => {
      try {
        const { syncProjectDown: syncDown, subscribeToProject: subProject, discoverRemoteMemberships } = await import('./services/SyncService')

        // Sync existing local shared projects
        const projects = useProjectStore.getState().projects
        for (const p of Object.values(projects)) {
          if (p.is_shared === 1) {
            await syncDown(p.id, currentUser.id).catch((err) => {
              console.warn(`[Startup] Failed to sync shared project ${p.name}:`, err)
              if (String(err).includes('not found')) {
                window.api.projects.update(p.id, { is_shared: 0 })
              }
            })
            subProject(p.id)
          }
        }

        // Discover projects we're a member of in Supabase but don't have locally
        const missingIds = await discoverRemoteMemberships(currentUser.id)
        if (missingIds.length > 0) {
          for (const pid of missingIds) {
            await syncDown(pid, currentUser.id).catch((err) =>
              console.warn(`[Startup] Failed to sync discovered project ${pid}:`, err)
            )
            subProject(pid)
          }
          // Rehydrate projects to show newly discovered ones
          await hydrateProjects(currentUser.id)
        }
      } catch (err) {
        console.error('[Startup] Failed to sync shared projects:', err)
      }
    }
    const timeout = setTimeout(syncShared, 2000)
    return () => clearTimeout(timeout)
  }, [isAuthenticated, currentUser, hydrateProjects])

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
      hydrateSettings()
    })
    return unsub
  }, [currentProjectId, currentUser, hydrateProjects, hydrateStatuses, hydrateLabels, hydrateAllForProject, hydrateAllTaskLabels, hydrateMyDay, hydrateSettings])

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

  // ── Invite deep link handling ─────────────────────────────────────
  const [inviteState, setInviteState] = useState<{
    token: string
    projectName: string
    ownerName: string
    expired: boolean
  } | null>(null)

  const inviteShowingRef = useRef(false)

  // Queue for multiple pending invites
  const [pendingInviteQueue, setPendingInviteQueue] = useState<Array<{
    token: string
    projectName: string
    ownerName: string
  }>>([])

  useEffect(() => {
    if (!isAuthenticated || !currentUser) return
    const unsub = window.api.onInviteReceived(async (token) => {
      try {
        const result = await validateInviteToken(token)
        if (!result) {
          setInviteState({ token, projectName: '', ownerName: '', expired: true })
          return
        }
        setInviteState({
          token,
          projectName: result.projectName,
          ownerName: result.ownerName,
          expired: !result.valid
        })
      } catch (err) {
        console.error('Failed to validate invite:', err)
      }
    })
    return unsub
  }, [isAuthenticated, currentUser])

  // Check for pending email-based invites on login + subscribe to new ones in real-time
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.email) return

    const handleNewInvite = async (token: string, projectName: string, ownerEmail: string): Promise<void> => {
      inviteShowingRef.current = true
      setInviteState({
        token,
        projectName,
        ownerName: ownerEmail,
        expired: false
      })
    }

    // Check existing pending invites on login
    const check = async (): Promise<void> => {
      try {
        const invites = await checkPendingInvites(currentUser.email)
        if (invites.length > 0) {
          const [first, ...rest] = invites
          handleNewInvite(first.token, first.projectName, first.ownerEmail)
          setPendingInviteQueue(rest.map((i) => ({
            token: i.token,
            projectName: i.projectName,
            ownerName: i.ownerEmail
          })))
        }
      } catch (err) {
        console.error('Failed to check pending invites:', err)
      }
    }
    check()

    // Subscribe to real-time invite notifications (retries on failure)
    let unsubscribe: (() => void) | undefined
    subscribeToInvites(currentUser.email, async (invite) => {
      const result = await validateInviteToken(invite.token)
      if (result && result.valid) {
        handleNewInvite(invite.token, result.projectName, result.ownerName)
      }
    }).then((unsub) => {
      unsubscribe = unsub
    })

    return () => {
      unsubscribe?.()
    }
  }, [isAuthenticated, currentUser?.email])

  const showNextInvite = (): void => {
    if (pendingInviteQueue.length > 0) {
      const [next, ...rest] = pendingInviteQueue
      setInviteState({ ...next, expired: false })
      setPendingInviteQueue(rest)
    } else {
      setInviteState(null)
      inviteShowingRef.current = false
    }
  }

  const handleDeclineInvite = async (): Promise<void> => {
    if (inviteState) {
      await declineInvite(inviteState.token).catch((err) =>
        console.error('Failed to decline invite:', err)
      )
    }
    showNextInvite()
  }

  const handleAcceptInvite = async (): Promise<void> => {
    if (!inviteState || !currentUser) return
    try {
      console.log('[Invite] Accepting invite:', inviteState.token)
      const projectId = await acceptInvite(inviteState.token, currentUser.id)
      console.log('[Invite] Accepted, project ID:', projectId)
      await hydrateProjects(currentUser.id)
      console.log('[Invite] Projects hydrated')
      await subscribeToProject(projectId)
      // Navigate to the newly joined project
      useViewStore.setState({ currentView: 'project', selectedProjectId: projectId })
      showNextInvite()
    } catch (err) {
      console.error('Failed to accept invite:', err)
      // Show error — don't silently dismiss
      setInviteState((prev) => prev ? { ...prev, expired: false } : null)
      alert(`Failed to join project: ${err instanceof Error ? err.message : 'Unknown error'}. Try logging out and back in.`)
      showNextInvite()
    }
  }

  if (loading) {
    return <SplashScreen />
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  return (
    <>
      <AppLayout />
      <UpdateDialog />
      {inviteState && (
        <InviteDialog
          projectName={inviteState.projectName}
          ownerName={inviteState.ownerName}
          expired={inviteState.expired}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      )}
    </>
  )
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
