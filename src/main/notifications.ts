import { Notification, app } from 'electron'
import { execFileSync } from 'child_process'
import { getDatabase } from './database'
import { createRepositories } from './repositories'
import { getMainWindow } from './index'
import { buildDevNotificationCommand } from './notification-command'
import { shouldEvictNotification } from './notification-eviction'
import type { Task } from '../shared/types'

const isDev = !app.isPackaged

// Track sent notifications to avoid duplicates. Key = "taskId:leadKey", value = the
// task's due instant (epoch ms) at the time it fired. The value lets the sweep evict
// entries whose due instant is safely past (see shouldEvictNotification) so the map stays
// bounded across the process lifetime instead of leaking, and a task later rescheduled to
// a reused key can re-notify once its old entry is evicted.
const sentNotifications = new Map<string, number>()

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
    const now = Date.now()

    // Evict dedup entries whose due instant is safely (>24h) in the past. Runs every sweep,
    // before the enabled/lead-time gates, so the map stays bounded even while notifications
    // are disabled. Deleting during Map iteration is well-defined in JS.
    for (const [key, dueTime] of sentNotifications) {
      if (shouldEvictNotification(dueTime, now)) {
        sentNotifications.delete(key)
      }
    }

    const db = getDatabase()
    const repos = createRepositories(db)

    const enabled = repos.settings.get('', 'notifications_enabled')
    if (enabled === 'false') return

    const leadTimeStr = repos.settings.get('', 'notifications_lead_time') ?? '15'
    const leadMinutes = parseInt(leadTimeStr, 10)
    if (isNaN(leadMinutes) || leadMinutes <= 0) return

    // Find tasks due within leadMinutes + 1 minute buffer (to catch the 1-min notification too)
    const maxMinutes = Math.max(leadMinutes, 1) + 1
    const upcomingTasks = repos.tasks.findWithUpcomingDueTimes(maxMinutes)

    for (const task of upcomingTasks) {
      if (!task.due_date || !task.due_date.includes('T')) continue

      const dueTime = new Date(task.due_date).getTime()
      if (isNaN(dueTime)) continue

      const minutesUntilDue = Math.round((dueTime - now) / 60_000)

      // Lead time notification
      if (minutesUntilDue <= leadMinutes && minutesUntilDue > 1) {
        sendNotification(task, minutesUntilDue, leadMinutes, dueTime)
      }

      // 1-minute warning notification
      if (minutesUntilDue <= 1 && minutesUntilDue >= 0) {
        sendNotification(task, minutesUntilDue, 1, dueTime)
      }
    }
  } catch (err) {
    console.error('Notification check failed:', err)
  }
}

function sendNotification(
  task: Task,
  minutesUntilDue: number,
  leadKey: number,
  dueTime: number
): void {
  const key = `${task.id}:${leadKey}`
  if (sentNotifications.has(key)) return
  sentNotifications.set(key, dueTime)

  const body = minutesUntilDue <= 1 ? 'Due in 1 minute' : `Due in ${minutesUntilDue} minutes`

  if (isDev) {
    // In dev mode, Electron notifications are unreliable on macOS — use osascript instead.
    // Title/body are passed via argv (execFileSync spawns osascript directly, no shell), so
    // they reach AppleScript as inert `argv` data and can never inject shell or AppleScript
    // code — even for a hostile title from a synced shared project or MCP write. See
    // buildDevNotificationCommand + notification-command.test.ts.
    const { command, args } = buildDevNotificationCommand(task.title, body)
    try {
      execFileSync(command, args)
    } catch (err) {
      // osascript can legitimately fail (e.g. notifications disabled at the OS level); log,
      // never crash the checker. An empty catch would violate the project's error-handling rule.
      console.error('Dev osascript notification failed:', err)
    }
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
