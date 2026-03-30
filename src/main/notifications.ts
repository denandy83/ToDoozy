import { Notification, app } from 'electron'
import { execSync } from 'child_process'
import { getDatabase } from './database'
import { createRepositories } from './repositories'
import { getMainWindow } from './index'
import type { Task } from '../shared/types'

const isDev = !app.isPackaged

// Track sent notifications to avoid duplicates: "taskId:leadMinutes"
const sentNotifications = new Set<string>()

let checkInterval: ReturnType<typeof setInterval> | null = null

export function startNotificationChecker(): void {
  if (checkInterval) return

  // Check every 60 seconds
  checkInterval = setInterval(() => {
    checkAndSendNotifications()
  }, 60_000)

  // Also run immediately
  checkAndSendNotifications()
}

export function stopNotificationChecker(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

function checkAndSendNotifications(): void {
  try {
    const db = getDatabase()
    const repos = createRepositories(db)

    const enabled = repos.settings.get('notifications_enabled')
    if (enabled === 'false') return

    const leadTimeStr = repos.settings.get('notifications_lead_time') ?? '15'
    const leadMinutes = parseInt(leadTimeStr, 10)
    if (isNaN(leadMinutes) || leadMinutes <= 0) return

    // Find tasks due within leadMinutes + 1 minute buffer (to catch the 1-min notification too)
    const maxMinutes = Math.max(leadMinutes, 1) + 1
    const upcomingTasks = repos.tasks.findWithUpcomingDueTimes(maxMinutes)

    const now = Date.now()

    for (const task of upcomingTasks) {
      if (!task.due_date || !task.due_date.includes('T')) continue

      const dueTime = new Date(task.due_date).getTime()
      if (isNaN(dueTime)) continue

      const minutesUntilDue = Math.round((dueTime - now) / 60_000)

      // Lead time notification
      if (minutesUntilDue <= leadMinutes && minutesUntilDue > 1) {
        sendNotification(task, minutesUntilDue, leadMinutes)
      }

      // 1-minute warning notification
      if (minutesUntilDue <= 1 && minutesUntilDue >= 0) {
        sendNotification(task, minutesUntilDue, 1)
      }
    }
  } catch (err) {
    console.error('Notification check failed:', err)
  }
}

function sendNotification(task: Task, minutesUntilDue: number, leadKey: number): void {
  const key = `${task.id}:${leadKey}`
  if (sentNotifications.has(key)) return
  sentNotifications.add(key)

  const body = minutesUntilDue <= 1 ? 'Due in 1 minute' : `Due in ${minutesUntilDue} minutes`

  if (isDev) {
    // In dev mode, Electron notifications are unreliable on macOS — use osascript instead
    const escapedTitle = task.title.replace(/'/g, "'\\''")
    const escapedBody = body.replace(/'/g, "'\\''")
    try {
      execSync(`osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"'`)
    } catch { /* ignore osascript failures */ }
    // Still handle click-to-navigate for when the app is focused
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('notification:navigate-to-task', task.id, task.project_id)
    }
  } else {
    const notification = new Notification({
      title: task.title,
      body,
      silent: false
    })

    notification.on('click', () => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.show()
        win.focus()
        win.webContents.send('notification:navigate-to-task', task.id, task.project_id)
      }
    })

    notification.show()
  }
}

export function clearSentNotifications(): void {
  sentNotifications.clear()
}
