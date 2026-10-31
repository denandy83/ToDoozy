let revision = 0
const evictions = new Map<string, number>()

export function invalidateProjectHydration(projectId: string): void {
  evictions.set(projectId, ++revision)
}

export function captureProjectScope(): (projectId?: string) => boolean {
  const captured = revision
  return (projectId) => projectId === undefined ? revision === captured : (evictions.get(projectId) ?? 0) <= captured
}
