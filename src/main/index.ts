import { join } from 'path'
import { existsSync } from 'fs'
import { app, shell, BrowserWindow, globalShortcut } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, getDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { showQuickAddWindow } from './quick-add'
import { createTray, destroyTray } from './tray'
import { SettingsRepository } from './repositories/SettingsRepository'
import { startNotificationChecker, stopNotificationChecker } from './notifications'
import { DEFAULT_QUICK_ADD_SHORTCUT, DEFAULT_APP_TOGGLE_SHORTCUT } from '../shared/shortcut-utils'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let currentShortcut: string | null = null
let currentAppToggleShortcut: string | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // macOS: hide window instead of closing (keep app alive for global shortcut)
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function hasAuthSession(): boolean {
  const tokenPath = join(app.getPath('userData'), '.auth-session')
  return existsSync(tokenPath)
}

export function registerQuickAddShortcut(accelerator?: string): { success: boolean; error?: string } {
  // Unregister the current shortcut if one is set
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
    currentShortcut = null
  }

  const shortcut = accelerator ?? DEFAULT_QUICK_ADD_SHORTCUT

  try {
    const registered = globalShortcut.register(shortcut, () => {
      if (!hasAuthSession()) return
      showQuickAddWindow()
    })

    if (registered) {
      currentShortcut = shortcut
      return { success: true }
    }
    return {
      success: false,
      error: `Shortcut "${shortcut}" is already in use by another application. Would you like to override it?`
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to register shortcut'
    }
  }
}

function loadAndRegisterShortcut(): void {
  try {
    const db = getDatabase()
    const settingsRepo = new SettingsRepository(db)
    const savedShortcut = settingsRepo.get('', 'quick_add_shortcut')
    registerQuickAddShortcut(savedShortcut ?? undefined)
  } catch (err) {
    console.error('Failed to load quick-add shortcut setting:', err)
    registerQuickAddShortcut()
  }
}

export function registerAppToggleShortcut(accelerator?: string): { success: boolean; error?: string } {
  if (currentAppToggleShortcut) {
    globalShortcut.unregister(currentAppToggleShortcut)
    currentAppToggleShortcut = null
  }

  const shortcut = accelerator ?? DEFAULT_APP_TOGGLE_SHORTCUT

  try {
    const registered = globalShortcut.register(shortcut, () => {
      if (!hasAuthSession()) return
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
        }
      }
    })

    if (registered) {
      currentAppToggleShortcut = shortcut
      return { success: true }
    }
    return {
      success: false,
      error: `Shortcut "${shortcut}" is already in use by another application.`
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to register shortcut'
    }
  }
}

function loadAndRegisterAppToggleShortcut(): void {
  try {
    const db = getDatabase()
    const settingsRepo = new SettingsRepository(db)
    const savedShortcut = settingsRepo.get('', 'app_toggle_shortcut')
    registerAppToggleShortcut(savedShortcut ?? undefined)
  } catch (err) {
    console.error('Failed to load app-toggle shortcut setting:', err)
    registerAppToggleShortcut()
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.todoozy')

  initDatabase()
  registerIpcHandlers()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()
  loadAndRegisterShortcut()
  loadAndRegisterAppToggleShortcut()
  startNotificationChecker()

  // Poll for external database changes (e.g., MCP server writing tasks)
  // fs.watch is unreliable on macOS for WAL files, so we poll the modified time instead
  const baseDbPath = process.env.TODOOZY_DEV_DB || join(app.getPath('userData'), 'todoozy.db')
  const dbPath = baseDbPath + '-wal'
  let lastMtime = 0
  try {
    const { statSync } = require('fs') as typeof import('fs')
    lastMtime = statSync(dbPath).mtimeMs
  } catch { /* WAL file may not exist yet */ }

  setInterval(() => {
    try {
      const { statSync } = require('fs') as typeof import('fs')
      const mtime = statSync(dbPath).mtimeMs
      if (mtime > lastMtime) {
        lastMtime = mtime
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('tasks-changed')
          }
        }
      }
    } catch { /* ignore if file doesn't exist */ }
  }, 1000)

  // macOS: re-show main window when dock icon is clicked
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    } else {
      createWindow()
    }
  })
})

// macOS: set quitting flag before quit so the close handler lets the window close
app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopNotificationChecker()
  destroyTray()
  closeDatabase()
})
