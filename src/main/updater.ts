import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let currentStatus: UpdateStatus = { state: 'idle' }
let checkInProgress = false
let dismissedVersion: string | null = null
let periodicTimer: ReturnType<typeof setInterval> | null = null
// Track whether the current check was triggered manually (vs periodic/launch)
let manualCheck = false

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

function broadcastStatus(status: UpdateStatus): void {
  currentStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', status)
    }
  }
}

function extractReleaseNotes(info: UpdateInfo): string {
  if (!info.releaseNotes) return ''
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  // Array of { version, note } objects
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n\n')
  }
  return ''
}

export function initUpdater(): void {
  // Configure — don't auto-download, let user choose
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcastStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    checkInProgress = false
    const version = info.version
    const releaseNotes = extractReleaseNotes(info)

    // If user dismissed this version on a periodic check, don't show again
    // (only remind on launch or manual check)
    if (dismissedVersion === version && !manualCheck) {
      broadcastStatus({ state: 'idle' })
      return
    }

    broadcastStatus({ state: 'available', version, releaseNotes })
  })

  autoUpdater.on('update-not-available', () => {
    checkInProgress = false
    broadcastStatus({ state: 'not-available' })
    // Auto-reset to idle after 3 seconds so the UI doesn't stick on "up to date"
    setTimeout(() => {
      if (currentStatus.state === 'not-available') {
        broadcastStatus({ state: 'idle' })
      }
    }, 3000)
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    broadcastStatus({
      state: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcastStatus({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    checkInProgress = false
    broadcastStatus({ state: 'error', message: err.message })
  })

  // Register IPC handlers
  ipcMain.handle('updater:check', () => {
    manualCheck = true
    return checkForUpdates()
  })

  ipcMain.handle('updater:download', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:dismiss', (_e, version: string) => {
    dismissedVersion = version
    broadcastStatus({ state: 'idle' })
  })

  ipcMain.handle('updater:getStatus', () => {
    return currentStatus
  })

  ipcMain.handle('updater:getVersion', () => {
    const { app } = require('electron') as typeof import('electron')
    return app.getVersion()
  })

  // Check on launch (background, non-blocking)
  setTimeout(() => {
    manualCheck = false
    checkForUpdates()
  }, 5000)

  // Check every 4 hours
  periodicTimer = setInterval(() => {
    manualCheck = false
    checkForUpdates()
  }, FOUR_HOURS_MS)
}

function checkForUpdates(): void {
  if (checkInProgress) return
  checkInProgress = true
  autoUpdater.checkForUpdates().catch((err: Error) => {
    checkInProgress = false
    broadcastStatus({ state: 'error', message: err.message })
  })
}

export function stopUpdater(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
}
