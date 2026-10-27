export function remoteTaskOrder<T extends { id: string; parent_id?: string | null }>(tasks: T[]): T[] {
  const remaining = new Map(tasks.map((task) => [task.id, task]))
  const ordered: T[] = []
  const visiting = new Set<string>()
  const visit = (id: string): void => {
    const task = remaining.get(id)
    if (!task || visiting.has(id)) return
    visiting.add(id)
    if (task.parent_id) visit(task.parent_id)
    remaining.delete(id)
    ordered.push(task)
  }
  for (const id of remaining.keys()) visit(id)
  return ordered
}
