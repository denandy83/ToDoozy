import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { getDatabase } from './database'
import { TaskRepository } from './repositories/TaskRepository'
import { StatusRepository } from './repositories/StatusRepository'
import { showQuickAddWindow } from './quick-add'
import { getMainWindow } from './index'
import type { Status } from '../shared/types'
import { classifyMyDayTasks, truncateTitle, type TrayTask } from './tray-utils'

let tray: Tray | null = null
let currentUserId: string | null = null

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
    const menu = buildLeftClickMenu()
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
  const { totalNonDone } = getMyDayTrayData()
  tray.setTitle(totalNonDone > 0 ? String(totalNonDone) : '')
}

export function setTrayUserId(userId: string): void {
  currentUserId = userId
  updateTrayBadge()
}

export function refreshTray(): void {
  updateTrayBadge()
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
