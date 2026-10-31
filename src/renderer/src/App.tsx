import { captureSyncContext } from './services/syncContext'
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
import { useSavedViewStore } from './shared/stores/savedViewStore'
import { logEvent } from './shared/stores/logStore'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppLayout } from './AppLayout'
import { InviteDialog } from './features/collaboration/InviteDialog'
import { validateInviteToken, acceptInvite, declineInvite, subscribeToProject, checkPendingInvites, subscribeToInvites } from './services/SyncService'
import { initPowerListener, isSuspended } from './services/powerState'
import { useViewStore } from './shared/stores/viewStore'
import { flushAll as flushBatchedTaskEdits } from './services/TaskBatchSyncManager'
import { useToast } from './shared/components/Toast'
import { startDiagnostics } from './services/diagnostics'

function App(): React.JSX.Element {
  useEffect(startDiagnostics, [])
  const { isAuthenticated, loading, currentUser, initAuth, isOffline } = useAuthStore()
  const { hydrateProjects, currentProjectId } = useProjectStore()
  const { hydrateStatuses } = useStatusStore()
  const { hydrateLabels } = useLabelStore()
  const { hydrateAllForProject, hydrateAllForUser } = useTaskStore()
  const { setUserId: setSettingsUserId, hydrateSettings, hydrateThemes } = useSettingsStore()
  const { hydrateProjectTemplates } = useTemplateStore()
  const { addToast } = useToast()

  useEffect(() => {
    initAuth()
    initPowerListener()
  }, [initAuth])

  // Warn once when the OS keychain is unavailable and the session won't persist.
  useEffect(() => {
    return window.api.onSessionNotPersisted(() => {
      addToast({
        message:
          "Session won't persist across restarts — the OS keychain is unavailable, so you'll need to sign in again next launch.",
        variant: 'danger',
        duration: 10000
      })
    })
  }, [addToast])

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
      hydrateAllForUser(currentUser.id)
      hydrateProjectTemplates(currentUser.id)
      window.api.tray.setUserId(currentUser.id)
    }
  }, [isAuthenticated, currentUser, setSettingsUserId, hydrateSettings, hydrateThemes, hydrateProjects, hydrateAllForUser, hydrateProjectTemplates])

  const startupUserId = currentUser?.id ?? null
  useEffect(() => {
    if (!isAuthenticated || !startupUserId || isOffline) return
    const startBackground = async (): Promise<void> => {
      const { startOnlineMonitoring } = await import('./services/PersonalSyncService')
      startOnlineMonitoring()

      // Warm the What's New cache so first visit doesn't depend on a live fetch.
      // loadCached() seeds the store from the bundled markdown (offline-safe);
      // sync() fetches the latest from GitHub and updates the cache.
      const { useReleaseNotesStore } = await import('./shared/stores/releaseNotesStore')
      await useReleaseNotesStore.getState().loadCached()
      void useReleaseNotesStore.getState().sync()
    }
    const timeout = setTimeout(startBackground, 2000)
    return () => {
      clearTimeout(timeout)
      import('./services/PersonalSyncService').then(({ stopOnlineMonitoring }) => stopOnlineMonitoring())
    }
  }, [isAuthenticated, startupUserId, isOffline])

  // Hydrate statuses and all tasks (regular + my day + archived + templates) when project changes
  useEffect(() => {
    if (!currentProjectId || !currentUser) return
    hydrateStatuses(currentProjectId)
    hydrateLabels(currentProjectId)
    // Also load all of the current user's labels into the store. The
    // chip-remap path needs to know about the viewer's same-name labels
    // even when they aren't linked to the active project; without this,
    // shared-project task chips fall back to other users' colors when the
    // viewer hasn't tagged anything in the active project yet.
    useLabelStore.getState().hydrateAllLabels()
    hydrateAllForProject(currentProjectId)
  }, [currentProjectId, currentUser, hydrateStatuses, hydrateLabels, hydrateAllForProject])

  // Instrumentation only — effect-run counter to detect StrictMode double-mount + dep churn.
  const realtimeEffectRunCount = useRef(0)

  // Supabase Realtime subscriptions + adaptive polling.
  // Keyed on userId (primitive, stable) so we don't re-run on auth-object reshuffles.
  // Hydrate actions called via getState() so they don't need to be in deps.
  // Skipped in offline-fallback mode — there's no session, so subscriptions
  // and pulls would all bail anyway. When the session recovers (30s timer or
  // the SessionBanner's manual retry), isOffline flips false and the effect
  // re-runs: full pull + Realtime subscriptions with the live flush handlers.
  const userId = currentUser?.id ?? null
  useEffect(() => {
    if (!userId || isOffline) return
    realtimeEffectRunCount.current += 1
    logEvent('info', 'realtime', `effect run #${realtimeEffectRunCount.current}`, `user=${userId.slice(0, 8)} online=${navigator.onLine}`)

    let disposed = false
    let needsInitialization = true
    const doPull = async (): Promise<void> => {
      if (disposed || !navigator.onLine || isSuspended() || useAuthStore.getState().currentUser?.id !== userId) return
      try {
        const context = await captureSyncContext(() => !disposed && navigator.onLine && !isSuspended())
        const { requestSyncCatchUp } = await import('./services/PersonalSyncService')
        await requestSyncCatchUp(context, needsInitialization)
        needsInitialization = false
      } catch (error) {
        if (!disposed) logEvent('error', 'sync', 'Background catch-up failed', String(error))
      }
    }
    void doPull()

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
          // Channel recovery schedules its own serialized catch-up.
        } else {
          startPolling()
        }
      }
    })
    if (!prevRealtimeConnected) startPolling()

    const setupRealtime = async (): Promise<void> => {
      if (!navigator.onLine || disposed) return
      const { subscribeToUserChannel } = await import('./services/UserChannelService')
      if (disposed || useAuthStore.getState().currentUser?.id !== userId) return
      await subscribeToUserChannel(userId)
    }
    setupRealtime().catch((e) => console.warn('[Sync] Realtime setup failed, relying on polling:', e))

    return () => {
      disposed = true
      logEvent('info', 'realtime', `effect cleanup #${realtimeEffectRunCount.current}`, 'tearing down realtime + polling')
      stopPolling()
      unsubRealtimeState()
      import('./services/PersonalSyncService').then(({ unsubscribeAllPersonal }) => unsubscribeAllPersonal())
      import('./services/UserChannelService').then(({ unsubscribeUserChannel }) => unsubscribeUserChannel())
      import('./services/SyncService').then(({ unsubscribeAll }) => unsubscribeAll())
    }
  }, [userId, isOffline])

  // Listen for data-changed from other processes (e.g. MCP server, quick-add)
  const hydrateMyDay = useTaskStore((s) => s.hydrateMyDay)
  const hydrateAllTaskLabels = useTaskStore((s) => s.hydrateAllTaskLabels)
  useEffect(() => {
    if (!currentProjectId || !currentUser) return
    const unsub = window.api.onTasksChanged(() => {
      hydrateProjects(currentUser.id)
      hydrateStatuses(currentProjectId)
      hydrateLabels(currentProjectId)
      hydrateAllForUser(currentUser.id)
      hydrateAllTaskLabels(currentProjectId)
      hydrateMyDay(currentUser.id)
      hydrateSettings()
      // Local MCP / quick-add writes can change saved-view membership too.
      useSavedViewStore.getState().scheduleRecount(currentUser.id)
    })
    return unsub
  }, [currentProjectId, currentUser, hydrateProjects, hydrateStatuses, hydrateLabels, hydrateAllForUser, hydrateAllTaskLabels, hydrateMyDay, hydrateSettings])

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

  // Flush batched detail-panel edits at the app-level boundaries (story #92):
  // window blur, and quit (main intercepts the first quit attempt, waits for
  // the renderer's ack, then quits for real).
  useEffect(() => {
    const onBlur = (): void => {
      void flushBatchedTaskEdits()
    }
    window.addEventListener('blur', onBlur)
    const unsubQuitFlush = window.api.app.onBeforeQuitFlush(() => {
      void flushBatchedTaskEdits().finally(() => window.api.app.beforeQuitFlushDone())
    })
    return () => {
      window.removeEventListener('blur', onBlur)
      unsubQuitFlush()
    }
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
  const cancelLoading = useAuthStore((s) => s.cancelLoading)
  // Reveal the Cancel link only if loading runs longer than 5s. Stops it from
  // flickering on a healthy fast sign-in while still giving an escape hatch
  // when an auth call is hung.
  const [showCancel, setShowCancel] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowCancel(true), 5_000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15">
        <span className="text-2xl font-bold tracking-tight text-accent">TD</span>
      </div>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-border">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      </div>
      {showCancel && (
        <button
          onClick={() => cancelLoading()}
          className="mt-4 text-[10px] font-bold uppercase tracking-[0.3em] text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

export default App
