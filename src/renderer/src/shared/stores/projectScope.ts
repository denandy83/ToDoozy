let revision = 0
const evictions = new Map<string, number>()
const listeners = new Set<() => void>()

export function invalidateProjectHydration(projectId: string): void {
  evictions.set(projectId, ++revision)
  for (const listener of listeners) listener()
}

export function projectScopeRevision(): number { return revision }

export function subscribeProjectScope(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function captureProjectScope(): (projectId?: string) => boolean {
  const captured = revision
  return (projectId) => projectId === undefined ? revision === captured : (evictions.get(projectId) ?? 0) <= captured
}
