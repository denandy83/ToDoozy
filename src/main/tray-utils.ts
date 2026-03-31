import type { Task, Status } from '../shared/types'

export type TrayBucket = 'not_started' | 'in_progress' | 'done'

export interface TrayTask {
  id: string
  title: string
  bucket: 'not_started' | 'in_progress'
}

export function getBucketForStatus(status: Status | undefined): TrayBucket {
  if (!status) return 'not_started'
  if (status.is_done === 1) return 'done'
  if (status.is_default === 1) return 'not_started'
  return 'in_progress'
}

export function truncateTitle(title: string, maxLength = 40): string {
  if (title.length <= maxLength) return title
  return title.slice(0, maxLength - 1) + '\u2026'
}

const TRAY_MAX_TASKS = 15

export const STATUS_ICONS: Record<TrayBucket, string> = {
  not_started: '○',
  in_progress: '◑',
  done: '●'
}

export function classifyMyDayTasks(
  tasks: Task[],
  getStatus: (statusId: string) => Status | undefined
): { tasks: TrayTask[]; totalNonDone: number } {
  const notStarted: Task[] = []
  const inProgress: Task[] = []

  for (const task of tasks) {
    if (task.parent_id) continue
    const bucket = getBucketForStatus(getStatus(task.status_id))
    if (bucket === 'done') continue
    if (bucket === 'in_progress') {
      inProgress.push(task)
    } else {
      notStarted.push(task)
    }
  }

  const totalNonDone = notStarted.length + inProgress.length

  // Flat list: not started first, then in progress, up to TRAY_MAX_TASKS
  const ordered = [
    ...notStarted.map((t) => ({ id: t.id, title: t.title, bucket: 'not_started' as const })),
    ...inProgress.map((t) => ({ id: t.id, title: t.title, bucket: 'in_progress' as const }))
  ].slice(0, TRAY_MAX_TASKS)

  return { tasks: ordered, totalNonDone }
}
