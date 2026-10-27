import type { Task } from '../../../../shared/types'

/** Keep the ancestor path to a matching child so nested matches can render. */
export function visibleTaskIdsWithAncestors(tasks: Task[], matches: (task: Task) => boolean): {
  visibleIds: Set<string>
  forcedExpandIds: Set<string>
} {
  const byId = new Map(tasks.filter((t) => !t.is_archived && !t.deleted_at).map((t) => [t.id, t]))
  const visibleIds = new Set<string>()
  const forcedExpandIds = new Set<string>()
  for (const task of byId.values()) {
    if (!matches(task)) continue
    visibleIds.add(task.id)
    const visited = new Set([task.id])
    let parentId = task.parent_id
    while (parentId && !visited.has(parentId)) {
      const parent = byId.get(parentId)
      if (!parent) break
      visited.add(parentId)
      visibleIds.add(parentId)
      forcedExpandIds.add(parentId)
      parentId = parent.parent_id
    }
  }
  return { visibleIds, forcedExpandIds }
}
