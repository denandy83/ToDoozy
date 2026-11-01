import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getDatabaseUserId } from './database'
import { assertTrustedSender, guardRendererNavigation } from './navigation-security'

let quickAddWindow: BrowserWindow | null = null

function createQuickAddWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 500,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: 'panel',
    hasShadow: false,
    backgroundColor: '#00000000',
    vibrancy: undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  quickAddWindow = win
  guardRendererNavigation(win.webContents)
  const ready = (event: Electron.IpcMainEvent): void => {
    if (quickAddWindow !== win || win.isDestroyed() || event.sender !== win.webContents) return
    try { assertTrustedSender(event) } catch { return }
    ipcMain.removeListener('quickadd:ready', ready)
    centerOnActiveDisplay(win)
    win.show()
    win.focus()
  }
  ipcMain.on('quickadd:ready', ready)
  win.on('closed', () => {
    ipcMain.removeListener('quickadd:ready', ready)
    if (quickAddWindow === win) quickAddWindow = null
  })
  win.on('blur', () => {
    if (!win.isDestroyed()) win.destroy()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=quickadd')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      search: 'window=quickadd'
    })
  }

  return win
}

function centerOnActiveDisplay(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const [winWidth, winHeight] = win.getSize()
  win.setPosition(
    Math.round(x + (width - winWidth) / 2),
    Math.round(y + (height - winHeight) / 3) // Upper third looks better than dead center
  )
}

export function showQuickAddWindow(): void {
  if (!getDatabaseUserId()) return
  // Always create fresh — ensures theme, projects, and settings are current
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    quickAddWindow.destroy()
    quickAddWindow = null
  }
  createQuickAddWindow()
}

export function hideQuickAddWindow(): void {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    quickAddWindow.destroy()
    quickAddWindow = null
  }
}

export function getQuickAddWindow(): BrowserWindow | null {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    return quickAddWindow
  }
  return null
}
