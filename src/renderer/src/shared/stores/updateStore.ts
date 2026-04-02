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
  dialogOpen: boolean
}

interface UpdateActions {
  setStatus(status: UpdateStatus): void
  setAppVersion(version: string): void
  openDialog(): void
  closeDialog(): void
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
  dialogOpen: false,

  setStatus(status: UpdateStatus): void {
    set({ status })
    // Auto-open dialog when update is available
    if (status.state === 'available') {
      set({ dialogOpen: true })
    }
  },

  setAppVersion(version: string): void {
    set({ appVersion: version })
  },

  openDialog(): void {
    set({ dialogOpen: true })
  },

  closeDialog(): void {
    set({ dialogOpen: false })
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
    set({ dialogOpen: false })
  },

  async init(): Promise<() => void> {
    // Get current app version
    const version = await window.api.updater.getVersion()
    set({ appVersion: version })

    // Get initial status
    const status = await window.api.updater.getStatus()
    set({ status })

    // Listen for status updates from main process
    const unsub = window.api.updater.onStatus((status) => {
      get().setStatus(status)
    })

    return unsub
  }
}), shallow)
