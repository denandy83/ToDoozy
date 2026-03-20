import { BrowserWindow, app, screen } from 'electron'
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

  quickAddWindow.once('ready-to-show', () => {
    if (quickAddWindow) centerOnActiveDisplay(quickAddWindow)
    quickAddWindow?.show()
    quickAddWindow?.focus()
    // Delay blur handler so it doesn't fire during the show/focus sequence
    setTimeout(() => {
      quickAddWindow?.on('blur', () => {
        quickAddWindow?.hide()
      })
    }, 200)
  })

  // Also hide when the app loses focus entirely (e.g. clicking desktop or another app)
  app.on('browser-window-blur', (_event, window) => {
    if (window === quickAddWindow && quickAddWindow?.isVisible()) {
      quickAddWindow.hide()
    }
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
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    centerOnActiveDisplay(quickAddWindow)
    quickAddWindow.show()
    setTimeout(() => {
      quickAddWindow?.focus()
      quickAddWindow?.webContents.send('quickadd:focus')
    }, 50)
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
