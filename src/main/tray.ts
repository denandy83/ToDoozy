import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { join } from 'path'
import { getDatabase } from './database'
import { TaskRepository } from './repositories/TaskRepository'
import { StatusRepository } from './repositories/StatusRepository'
import { showQuickAddWindow } from './quick-add'
import { getMainWindow } from './index'
import type { Status } from '../shared/types'
import type { TimerTrayState } from '../preload/index.d'
import { classifyMyDayTasks, truncateTitle, type TrayTask } from './tray-utils'

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
  const timeStr = formatTimerDisplay(timerState.remainingSeconds)
  const phaseLabel = timerState.phase === 'break' ? 'Break' : 'Focus'
  const repLabel = timerState.isPerpetual
    ? `Rep ${timerState.currentRep}`
    : timerState.totalReps > 1
      ? `${timerState.currentRep}/${timerState.totalReps}`
      : ''

  menuItems.push({
    label: `${phaseLabel}: ${timeStr}${repLabel ? `  ${repLabel}` : ''}`,
    enabled: false
  })

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
    const inProgressTasks = tasks.filter((t) => t.bucket === 'in_progress')
    const openTasks = tasks.filter((t) => t.bucket === 'not_started')

    if (inProgressTasks.length > 0) {
      menuItems.push({
        label: 'In Progress',
        enabled: false
      })
      for (const task of inProgressTasks) {
        menuItems.push({
          label: `  ${truncateTitle(task.title)}`,
          click: (): void => navigateToTask(task.id)
        })
      }
    }

    if (openTasks.length > 0) {
      if (inProgressTasks.length > 0) {
        menuItems.push({ type: 'separator' })
      }
      menuItems.push({
        label: 'Open',
        enabled: false
      })
      for (const task of openTasks) {
        menuItems.push({
          label: `  ${truncateTitle(task.title)}`,
          click: (): void => navigateToTask(task.id)
        })
      }
    }

    const shownCount = inProgressTasks.length + openTasks.length
    if (totalNonDone > shownCount) {
      menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'View all in My Day...',
        click: (): void => {
          showMainWindow()
          const mainWindow = getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tray:navigate-to-myday')
          }
        }
      })
    }
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

export function createTray(): void {
  const iconPath = join(__dirname, '../../resources/iconTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('ToDoozy')

  tray.on('click', () => {
    if (!tray) return
    const menu = timerState ? buildTimerMenu() : buildLeftClickMenu()
    tray.popUpContextMenu(menu)
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
    // Show countdown in menu bar
    const timeStr = formatTimerDisplay(timerState.remainingSeconds)
    const repStr = timerState.isPerpetual
      ? ` ${timerState.currentRep}`
      : timerState.totalReps > 1
        ? ` ${timerState.currentRep}/${timerState.totalReps}`
        : ''
    tray.setTitle(`${timeStr}${repStr}`)
  } else {
    const { totalNonDone } = getMyDayTrayData()
    tray.setTitle(totalNonDone > 0 ? String(totalNonDone) : '')
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
