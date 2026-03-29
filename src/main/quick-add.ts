import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let quickAddWindow: BrowserWindow | null = null

function createQuickAddWindow(): BrowserWindow {
  quickAddWindow = new BrowserWindow({
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

  quickAddWindow.on('closed', () => {
    quickAddWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    quickAddWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=quickadd')
  } else {
    quickAddWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      search: 'window=quickadd'
    })
  }

  // Wait for renderer to signal theme is applied before showing
  ipcMain.once('quickadd:ready', () => {
    if (!quickAddWindow || quickAddWindow.isDestroyed()) return
    centerOnActiveDisplay(quickAddWindow)
    quickAddWindow.show()
    quickAddWindow.focus()
    // Destroy on blur (clicking outside, switching apps, etc.)
    quickAddWindow.on('blur', () => {
      if (quickAddWindow && !quickAddWindow.isDestroyed()) {
        quickAddWindow.destroy()
        quickAddWindow = null
      }
    })
  })

  return quickAddWindow
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
