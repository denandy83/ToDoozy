import { logEvent } from '../shared/stores/logStore'

let suspended = false
let initialized = false

export function isSuspended(): boolean {
  return suspended
}

export function initPowerListener(): void {
  if (initialized) return
  initialized = true

  window.api.power.onSuspend(() => {
    suspended = true
    logEvent('info', 'realtime', 'Power: suspend — pausing reconnect timers')
    void import('./PersonalSyncService').then(({ pauseReconnectsForSuspend }) => {
      pauseReconnectsForSuspend()
    })
    void import('./SyncService').then(({ pauseSharedReconnectsForSuspend }) => {
      pauseSharedReconnectsForSuspend()
    })
  })

  window.api.power.onResume(() => {
    suspended = false
    logEvent('info', 'realtime', 'Power: resume — forcing reconnect')
    void import('./PersonalSyncService').then(({ forceReconnectAllPersonal }) => {
      forceReconnectAllPersonal().catch(() => {})
    })
    void import('./SyncService').then(({ forceReconnectAllShared }) => {
      forceReconnectAllShared().catch(() => {})
    })
  })
}
