import type { Status, Task } from '../../../../shared/types'

export type BucketKey = 'not_started' | 'in_progress' | 'done'

export interface StatusBucket {
  key: BucketKey
  name: string
  color: string
  icon: 'circle' | 'clock' | 'check-circle'
  order: number
}

export const MY_DAY_BUCKETS: StatusBucket[] = [
  { key: 'not_started', name: 'Not Started', color: '#888888', icon: 'circle', order: 0 },
  { key: 'in_progress', name: 'In Progress', color: '#f59e0b', icon: 'clock', order: 1 },
  { key: 'done', name: 'Done', color: '#22c55e', icon: 'check-circle', order: 2 }
]

/** Classify a status into a bucket based on its flags */
export function getBucketForStatus(status: Status | undefined): BucketKey {
  if (!status) return 'not_started'
  if (status.is_done === 1) return 'done'
  if (status.is_default === 1) return 'not_started'
  return 'in_progress'
}

/** Given a task and the full status map, return its bucket key */
export function getBucketForTask(
  task: Task,
  allStatuses: Record<string, Status>
): BucketKey {
  return getBucketForStatus(allStatuses[task.status_id])
}

/** Find the best status in a project to represent a target bucket */
export function findProjectStatusForBucket(
  projectId: string,
  targetBucket: BucketKey,
  allStatuses: Record<string, Status>
): Status | undefined {
  const projectStatuses = Object.values(allStatuses)
    .filter((s) => s.project_id === projectId)
    .sort((a, b) => a.order_index - b.order_index)

  if (projectStatuses.length === 0) return undefined

  switch (targetBucket) {
    case 'not_started':
      return projectStatuses.find((s) => s.is_default === 1) ?? projectStatuses[0]
    case 'done':
      return projectStatuses.find((s) => s.is_done === 1) ?? projectStatuses[projectStatuses.length - 1]
    case 'in_progress': {
      return projectStatuses.find((s) => s.is_default !== 1 && s.is_done !== 1)
    }
  }
}

/** Create a synthetic Status object for a bucket (used for StatusSection/KanbanView) */
export function createBucketStatus(bucket: StatusBucket): Status {
  return {
    id: `__bucket_${bucket.key}`,
    project_id: '__my_day',
    name: bucket.name,
    color: bucket.color,
    icon: bucket.icon,
    order_index: bucket.order,
    is_default: bucket.key === 'not_started' ? 1 : 0,
    is_done: bucket.key === 'done' ? 1 : 0,
    created_at: '',
    updated_at: '',
    deleted_at: null
  }
}
