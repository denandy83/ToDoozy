import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { join } from 'path'
import { getDatabase } from './database'
import { TaskRepository } from './repositories/TaskRepository'
import { StatusRepository } from './repositories/StatusRepository'
import { showQuickAddWindow } from './quick-add'
import { getMainWindow } from './index'
import type { Status } from '../shared/types'
import type { TimerTrayState } from '../preload/index.d'
import { classifyMyDayTasks, truncateTitle, STATUS_ICONS, type TrayTask } from './tray-utils'


let tray: Tray | null = null
let currentUserId: string | null = null
let timerState: TimerTrayState | null = null

function getMyDayTrayData(): { tasks: TrayTask[]; totalNonDone: number } {
  if (!currentUserId) return { tasks: [], totalNonDone: 0 }

  const db = getDatabase()
  const taskRepo = new TaskRepository(db)
  const statusRepo = new StatusRepository(db)

  const allMyDayTasks = taskRepo.findMyDay(currentUserId)

  const statusCache: Record<string, Status> = {}
  const getStatus = (statusId: string): Status | undefined => {
    if (!statusCache[statusId]) {
      const s = statusRepo.findById(statusId)
      if (s) statusCache[statusId] = s
    }
    return statusCache[statusId]
  }

  return classifyMyDayTasks(allMyDayTasks, getStatus)
}

function showMainWindow(): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function navigateToTask(taskId: string): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('tray:navigate-to-task', taskId)
  }
}

function formatTimerDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatCookieDisplay(seconds: number): string {
  const abs = Math.abs(Math.floor(seconds))
  const m = Math.floor(abs / 60)
  const s = abs % 60
  const prefix = seconds < 0 ? '-' : ''
  return `${prefix}${m}:${s.toString().padStart(2, '0')}`
}

function sendToRenderer(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel)
    }
  }
}

function buildTimerMenu(): Menu {
  if (!timerState) return buildLeftClickMenu()

  const menuItems: Electron.MenuItemConstructorOptions[] = []

  menuItems.push({
    label: truncateTitle(timerState.taskTitle),
    enabled: false
  })

  menuItems.push({ type: 'separator' })

  if (timerState.isPaused) {
    menuItems.push({
      label: 'Resume',
      click: (): void => { sendToRenderer('timer:resume') }
    })
  } else {
    menuItems.push({
      label: 'Pause',
      click: (): void => { sendToRenderer('timer:pause') }
    })
  }

  menuItems.push({
    label: 'Stop',
    click: (): void => { sendToRenderer('timer:stop') }
  })

  return Menu.buildFromTemplate(menuItems)
}

function buildLeftClickMenu(): Menu {
  const { tasks, totalNonDone } = getMyDayTrayData()
  const menuItems: Electron.MenuItemConstructorOptions[] = []

  menuItems.push({
    label: 'Quick Add Task',
    click: (): void => {
      showQuickAddWindow()
    }
  })

  menuItems.push({ type: 'separator' })

  if (tasks.length === 0) {
    menuItems.push({
      label: 'No tasks for today',
      enabled: false
    })
  } else {
    if (totalNonDone > tasks.length) {
      menuItems.push({
        label: `Tasks: [${tasks.length}/${totalNonDone}]`,
        enabled: false
      })
    }

    let prevBucket: string | null = null
    for (const task of tasks) {
      if (prevBucket && prevBucket !== task.bucket) {
        menuItems.push({ type: 'separator' })
      }
      prevBucket = task.bucket
      const icon = STATUS_ICONS[task.bucket]
      menuItems.push({
        label: `${icon} ${truncateTitle(task.title)}`,
        click: (): void => navigateToTask(task.id)
      })
    }

    menuItems.push({ type: 'separator' })
    menuItems.push({
      label: 'Open My Day',
      click: (): void => {
        showMainWindow()
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tray:navigate-to-myday')
        }
      }
    })
  }

  return Menu.buildFromTemplate(menuItems)
}

function buildRightClickMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open ToDoozy',
      click: (): void => showMainWindow()
    },
    {
      label: 'Add Task',
      click: (): void => showQuickAddWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit ToDoozy',
      click: (): void => {
        app.quit()
      }
    }
  ])
}

function getResourcePath(filename: string): string {
  if (app.isPackaged) {
    // extraResources copies files to Contents/Resources/
    return join(process.resourcesPath, filename)
  }
  // In dev, __dirname is out/main/, resources is at project root
  return join(__dirname, '../../resources', filename)
}

export function createTray(): void {
  const iconPath = getResourcePath('iconTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('ToDoozy')

  // Delay single-click menu so double-click can cancel it and open the window instead
  let clickTimer: ReturnType<typeof setTimeout> | null = null

  tray.on('click', () => {
    if (clickTimer) return // ignore — already waiting for potential double-click
    clickTimer = setTimeout(() => {
      clickTimer = null
      if (!tray) return
      const menu = timerState ? buildTimerMenu() : buildLeftClickMenu()
      tray.popUpContextMenu(menu)
    }, 150)
  })

  tray.on('double-click', () => {
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
    }
    showMainWindow()
  })

  tray.on('right-click', () => {
    if (!tray) return
    const menu = buildRightClickMenu()
    tray.popUpContextMenu(menu)
  })

  updateTrayBadge()
}

export function updateTrayBadge(): void {
  if (!tray) return

  if (timerState) {
    // Show countdown in menu bar with phase indicator
    let displaySeconds: number
    let phaseIcon: string
    if (timerState.isCookieBreakPhase) {
      // Cookie break: show pool countdown (can be negative)
      displaySeconds = timerState.cookiePoolSeconds
      phaseIcon = '\ud83c\udf6a' // 🍪
    } else if (timerState.isFlowtime && timerState.phase === 'work') {
      displaySeconds = timerState.elapsedSeconds
      phaseIcon = '\ud83c\udf0a' // 🌊
    } else if (timerState.phase === 'break') {
      displaySeconds = timerState.remainingSeconds
      phaseIcon = timerState.isLongBreak ? '\ud83e\uddd8' : '\u2615'
    } else {
      displaySeconds = timerState.remainingSeconds
      phaseIcon = '\u23f1' // ⏱
    }
    const timeStr = timerState.isCookieBreakPhase
      ? formatCookieDisplay(displaySeconds)
      : formatTimerDisplay(displaySeconds)
    const repStr = timerState.isPerpetual
      ? ` ${timerState.currentRep}`
      : timerState.totalReps > 1
        ? ` ${timerState.currentRep}/${timerState.totalReps}`
        : ''
    tray.setTitle(`${phaseIcon} ${timeStr}${repStr}`)
  } else {
    try {
      const { totalNonDone } = getMyDayTrayData()
      tray.setTitle(totalNonDone > 0 ? `[${totalNonDone}]` : '')
    } catch {
      // DB may be locked during startup — skip this refresh
    }
  }
}

export function setTrayUserId(userId: string): void {
  currentUserId = userId
  updateTrayBadge()
}

export function refreshTray(): void {
  updateTrayBadge()
}

export function setTimerState(state: TimerTrayState): void {
  timerState = state
  updateTrayBadge()
}

export function clearTimerState(): void {
  timerState = null
  updateTrayBadge()
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
