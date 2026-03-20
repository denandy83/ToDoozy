import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let quickAddWindow: BrowserWindow | null = null

function createQuickAddWindow(): BrowserWindow {
  quickAddWindow = new BrowserWindow({
    width: 500,
    height: 160,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: 'panel',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  quickAddWindow.on('blur', () => {
    quickAddWindow?.hide()
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

  quickAddWindow.once('ready-to-show', () => {
    quickAddWindow?.showInactive()
    quickAddWindow?.focus()
  })

  return quickAddWindow
}

export function showQuickAddWindow(): void {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    quickAddWindow.show()
    quickAddWindow.focus()
    quickAddWindow.webContents.send('quickadd:focus')
  } else {
    createQuickAddWindow()
  }
}

export function hideQuickAddWindow(): void {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    quickAddWindow.hide()
  }
}

export function getQuickAddWindow(): BrowserWindow | null {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    return quickAddWindow
  }
  return null
}
