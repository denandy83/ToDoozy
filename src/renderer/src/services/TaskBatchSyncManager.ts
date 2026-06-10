/**
 * Batches Supabase pushes for the task open in the Detail panel (story #92).
 * Local SQLite writes stay instant; the network push happens only at clear
 * boundaries — task switch, panel close, app blur, quit — or a 30s per-task
 * safety timer. taskStore.updateTask routes through markPending() while the
 * edited task is open in the panel; flush() re-reads the task and pushes via
 * the same syncIfShared routing (shared vs personal) as an immediate push.
 *
 * The taskStore module is imported dynamically inside flush() so this module
 * stays statically import-free of the store (taskStore statically imports
 * this one — a static back-edge would be a cycle).
 */

const SAFETY_FLUSH_MS = 30_000

const pendingTaskIds = new Set<string>()
const safetyTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Resolve the store module once and share the promise — concurrent flushes
// (flushAll) must all see the same module instance.
let storeModule: Promise<typeof import('../shared/stores/taskStore')> | null = null
function getStoreModule(): Promise<typeof import('../shared/stores/taskStore')> {
  if (!storeModule) storeModule = import('../shared/stores/taskStore')
  return storeModule
}

export function isPending(taskId: string): boolean {
  return pendingTaskIds.has(taskId)
}

export function pendingCount(): number {
  return pendingTaskIds.size
}

/** Buffer a push for the task and (re)arm its 30s safety timer. */
export function markPending(taskId: string): void {
  pendingTaskIds.add(taskId)
  const existing = safetyTimers.get(taskId)
  if (existing) clearTimeout(existing)
  safetyTimers.set(
    taskId,
    setTimeout(() => {
      void flush(taskId)
    }, SAFETY_FLUSH_MS)
  )
}

/**
 * Drop a pending mark without pushing. Used when an immediate op (archive,
 * completion, My Day) just pushed the full task row — the buffered edits rode
 * along with it, so a later flush would be a redundant duplicate push.
 */
export function cancelPending(taskId: string): void {
  pendingTaskIds.delete(taskId)
  const timer = safetyTimers.get(taskId)
  if (timer) {
    clearTimeout(timer)
    safetyTimers.delete(taskId)
  }
}

/**
 * Push the task's current state via syncIfShared. No-op when the task isn't
 * pending (double-flush safe) or was deleted while buffered (the delete
 * already pushed its own tombstone).
 */
export async function flush(taskId: string): Promise<void> {
  if (!pendingTaskIds.has(taskId)) return
  cancelPending(taskId)
  const { useTaskStore, syncIfShared } = await getStoreModule()
  const task = useTaskStore.getState().tasks[taskId]
  if (!task) return
  await syncIfShared(task, 'UPDATE')
}

/** Flush every pending task — panel close, app blur, and quit boundaries. */
export async function flushAll(): Promise<void> {
  await Promise.all([...pendingTaskIds].map((id) => flush(id)))
}
