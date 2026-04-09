import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

interface UpdateState {
  status: UpdateStatus
  appVersion: string
}

interface UpdateActions {
  setStatus(status: UpdateStatus): void
  setAppVersion(version: string): void
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  dismissUpdate(version: string): Promise<void>
  init(): Promise<() => void>
}

export type UpdateStore = UpdateState & UpdateActions

export const useUpdateStore = createWithEqualityFn<UpdateStore>((set, get) => ({
  status: { state: 'idle' },
  appVersion: '',

  setStatus(status: UpdateStatus): void {
    set({ status })
    // Notify via bell when download finishes
    if (status.state === 'downloaded') {
      import('./notificationStore').then(({ useNotificationStore }) => {
        useNotificationStore.getState().createNotification({
          id: crypto.randomUUID(),
          type: 'update',
          message: `Update v${status.version} is ready to install. Restart to apply.`
        })
      })
    }
  },

  setAppVersion(version: string): void {
    set({ appVersion: version })
  },

  async checkForUpdates(): Promise<void> {
    await window.api.updater.check()
  },

  async downloadUpdate(): Promise<void> {
    await window.api.updater.download()
  },

  async installUpdate(): Promise<void> {
    await window.api.updater.install()
  },

  async dismissUpdate(version: string): Promise<void> {
    await window.api.updater.dismiss(version)
  },

  async init(): Promise<() => void> {
    const version = await window.api.updater.getVersion()
    set({ appVersion: version })

    const status = await window.api.updater.getStatus()
    set({ status })

    const unsub = window.api.updater.onStatus((status) => {
      get().setStatus(status)
    })

    return unsub
  }
}), shallow)
