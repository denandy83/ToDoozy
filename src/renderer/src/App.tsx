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
import { useSyncStore } from './shared/stores/syncStore'
import { logEvent } from './shared/stores/logStore'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppLayout } from './AppLayout'
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

        // Sync existing local shared projects + subscribe to Realtime for ALL projects
        const projects = useProjectStore.getState().projects
        for (const p of Object.values(projects)) {
          if (p.is_shared === 1) {
            await syncDown(p.id, currentUser.id).catch((err) => {
              console.warn(`[Startup] Failed to sync shared project ${p.name}:`, err)
              if (String(err).includes('not found')) {
                window.api.projects.update(p.id, { is_shared: 0 })
              }
            })
          }
          // Subscribe to Realtime for shared projects only
          // (personal projects use the WAL polling + fullUpload/Pull flow)
          if (p.is_shared === 1) subProject(p.id)
        }

        // Discover projects we're a member of in Supabase but don't have locally
        // Skip if last check was less than 5 minutes ago
        const lastMemberCheck = await window.api.settings.get(currentUser.id, 'last_member_discovery')
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
        const shouldDiscover = !lastMemberCheck || lastMemberCheck < fiveMinAgo
        const missingIds = shouldDiscover ? await discoverRemoteMemberships(currentUser.id) : []
        if (shouldDiscover) {
          await window.api.settings.set(currentUser.id, 'last_member_discovery', new Date().toISOString())
        }
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

      // Always start online monitoring (even if sync fails)
      const { initSync, startOnlineMonitoring } = await import('./services/PersonalSyncService')
      startOnlineMonitoring()

      // Initialize personal sync (first-time upload or new-device pull)
      try {
        await initSync(currentUser.id)
      } catch (err) {
        console.error('[Startup] Failed to initialize personal sync:', err)
      }

      // Warm the What's New cache so first visit doesn't depend on a live fetch.
      // loadCached() seeds the store from the bundled markdown (offline-safe);
      // sync() fetches the latest from GitHub and updates the cache.
      const { useReleaseNotesStore } = await import('./shared/stores/releaseNotesStore')
      await useReleaseNotesStore.getState().loadCached()
      void useReleaseNotesStore.getState().sync()
    }
    const timeout = setTimeout(syncShared, 2000)
    return () => {
      clearTimeout(timeout)
      import('./services/PersonalSyncService').then(({ stopOnlineMonitoring }) => stopOnlineMonitoring())
    }
  }, [isAuthenticated, currentUser, hydrateProjects])

  // Hydrate statuses and all tasks (regular + my day + archived + templates) when project changes
  useEffect(() => {
    if (!currentProjectId || !currentUser) return
    hydrateStatuses(currentProjectId)
    hydrateLabels(currentProjectId)
    hydrateAllForProject(currentProjectId, currentUser.id)
  }, [currentProjectId, currentUser, hydrateStatuses, hydrateLabels, hydrateAllForProject])

  // Ref so async pull callbacks always read the latest project without re-triggering the effect
  const currentProjectRef = useRef(currentProjectId)
  currentProjectRef.current = currentProjectId

  // Instrumentation only — effect-run counter to detect StrictMode double-mount + dep churn.
  const realtimeEffectRunCount = useRef(0)

  // Supabase Realtime subscriptions + adaptive polling.
  // Keyed on userId (primitive, stable) so we don't re-run on auth-object reshuffles.
  // Hydrate actions called via getState() so they don't need to be in deps.
  const userId = currentUser?.id ?? null
  useEffect(() => {
    if (!userId) return
    realtimeEffectRunCount.current += 1
    logEvent('info', 'realtime', `effect run #${realtimeEffectRunCount.current}`, `user=${userId.slice(0, 8)} online=${navigator.onLine}`)

    const doPull = async (): Promise<void> => {
      if (!navigator.onLine) return
      const { pullNewTasks, pullProjectMetadata, resetRefreshGate, cacheProjectNames } = await import('./services/PersonalSyncService')
      resetRefreshGate()

      const allProjects = await window.api.projects.getProjectsForUser(userId)
      cacheProjectNames(allProjects)
      // Personal-pull is for personal projects only. Shared projects sync via
      // SyncService Realtime — running pullNewTasks on them re-pushes archived
      // rows back to remote (see PersonalSyncService.ts:1128).
      const personalProjects = allProjects.filter((p) => p.is_shared !== 1)
      let anyChanged = false
      for (const project of personalProjects) {
        const metaChanged = await pullProjectMetadata(project.id).catch(() => false)
        if (metaChanged) anyChanged = true
        const pulled = await pullNewTasks(project.id).catch(() => 0)
        if (pulled > 0) anyChanged = true
      }
      if (anyChanged) {
        const pid = currentProjectRef.current
        useProjectStore.getState().hydrateProjects(userId)
        if (pid) {
          useTaskStore.getState().hydrateAllForProject(pid, userId)
        }
      }
    }
    doPull()

    // Adaptive polling: no polling when Realtime is connected, 120s fallback when disconnected
    let pollInterval: ReturnType<typeof setInterval> | null = null
    const startPolling = (): void => {
      if (!pollInterval) pollInterval = setInterval(doPull, 120_000)
    }
    const stopPolling = (): void => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    }
    let prevRealtimeConnected = useSyncStore.getState().realtimeConnected
    const unsubRealtimeState = useSyncStore.subscribe((state) => {
      const connected = state.realtimeConnected
      if (connected !== prevRealtimeConnected) {
        prevRealtimeConnected = connected
        if (connected) {
          stopPolling()
          doPull()
        } else {
          startPolling()
        }
      }
    })
    startPolling()

    // Debounced flush for Realtime events across all subscribed projects
    const pendingProjectIds = new Set<string>()
    let realtimeTimer: ReturnType<typeof setTimeout> | null = null
    let pullInProgress = false

    const flushRealtime = async (): Promise<void> => {
      if (pullInProgress) return
      pullInProgress = true
      try {
        const { pullNewTasks } = await import('./services/PersonalSyncService')
        const projects = [...pendingProjectIds]
        pendingProjectIds.clear()
        // Defensive filter — shared projects sync via SyncService Realtime,
        // not through pullNewTasks (which would re-push archived rows).
        const projectMap = useProjectStore.getState().projects
        const personalIds = projects.filter((pid) => projectMap[pid]?.is_shared !== 1)
        let anyChanged = false
        for (const pid of personalIds) {
          const pulled = await pullNewTasks(pid).catch(() => 0)
          if (pulled > 0) anyChanged = true
        }
        if (anyChanged) {
          const pid = currentProjectRef.current
          useProjectStore.getState().hydrateProjects(userId)
          if (pid) {
            useLabelStore.getState().hydrateLabels(pid)
            useTaskStore.getState().hydrateAllForProject(pid, userId)
            useTaskStore.getState().hydrateAllTaskLabels(pid)
          }
        }
      } finally {
        pullInProgress = false
      }
    }

    const scheduleFlush = (): void => {
      if (realtimeTimer) clearTimeout(realtimeTimer)
      realtimeTimer = setTimeout(flushRealtime, 500)
    }

    const setupRealtime = async (): Promise<void> => {
      if (!navigator.onLine) return
      const { subscribeToPersonalProject, cacheProjectNames: cachePNames } = await import('./services/PersonalSyncService')
      const allProjects = await window.api.projects.getProjectsForUser(userId)
      cachePNames(allProjects)
      // Personal Realtime channels are only for personal projects. Shared projects
      // get their own subscriptions via SyncService.subscribeToProject (started in syncShared).
      const personalProjects = allProjects.filter((p) => p.is_shared !== 1)
      for (const project of personalProjects) {
        await subscribeToPersonalProject(project.id, () => {
          pendingProjectIds.add(project.id)
          scheduleFlush()
        })
      }
    }
    setupRealtime().catch((e) => console.warn('[Sync] Realtime setup failed, relying on polling:', e))

    return () => {
      logEvent('info', 'realtime', `effect cleanup #${realtimeEffectRunCount.current}`, 'tearing down realtime + polling')
      stopPolling()
      unsubRealtimeState()
      if (realtimeTimer) clearTimeout(realtimeTimer)
      import('./services/PersonalSyncService').then(({ unsubscribeAllPersonal }) => unsubscribeAllPersonal())
    }
  }, [userId])

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

  // Re-run My Day auto-add on app resume (sleep/wake) and window refocus
  const currentView = useViewStore((s) => s.currentView)
  useEffect(() => {
    if (!currentUser) return
    const onVisible = (): void => {
      if (!document.hidden) hydrateMyDay(currentUser.id)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [currentUser, hydrateMyDay])

  // Re-run My Day auto-add when navigating to My Day view
  useEffect(() => {
    if (!currentUser || currentView !== 'my-day') return
    hydrateMyDay(currentUser.id)
  }, [currentUser, currentView, hydrateMyDay])

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
    const unsubCookieBreak = window.api.timer.onCookieBreak(() => {
      useTimerStore.getState().startCookieBreak()
    })
    const unsubBackToWork = window.api.timer.onBackToWork(() => {
      useTimerStore.getState().backToWork()
    })
    return () => {
      unsubPause()
      unsubResume()
      unsubStop()
      unsubCookieBreak()
      unsubBackToWork()
    }
  }, [])

  // Auto-archive: periodically check for done tasks past the threshold
  useEffect(() => {
    if (!isAuthenticated) return

    const checkAutoArchive = async (): Promise<void> => {
      const now = Date.now()
      const allTasks = useTaskStore.getState().tasks
      const { updateTask: doUpdate } = useTaskStore.getState()
      const allProjects = useProjectStore.getState().projects

      for (const task of Object.values(allTasks)) {
        if (task.is_archived === 1 || !task.completed_date) continue

        const project = allProjects[task.project_id]
        if (!project) continue
        // Never auto-archive tasks in shared projects
        if (project.is_shared === 1) continue
        // Check per-project setting
        if (!project.auto_archive_enabled) continue

        const value = project.auto_archive_value ?? 3
        const unit = project.auto_archive_unit ?? 'days'
        if (value <= 0) continue

        const thresholdMs = unit === 'hours' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000
        const completedAt = new Date(task.completed_date).getTime()
        if (now - completedAt >= thresholdMs) {
          logEvent(
            'info',
            'sync',
            `Auto-archived "${task.title}"`,
            `task=${task.id} project=${task.project_id} is_shared=${project.is_shared ?? 0} threshold=${value}${unit} completed=${task.completed_date}`
          )
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
