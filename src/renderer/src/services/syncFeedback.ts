import type { SyncProducer } from './syncContext'
import type { SyncOperation } from '../../../shared/types'
import { useSyncStore } from '../shared/stores/syncStore'
import { logEvent } from '../shared/stores/logStore'

export async function markSynced(origin: SyncProducer): Promise<void> {
  if (await origin.isCurrent()) useSyncStore.getState().setLastSynced()
}

export async function refreshProducerPending(origin: SyncProducer): Promise<void> {
  const pendingCount = await origin.api.sync.count()
  if (await origin.isCurrent()) useSyncStore.setState({ pendingCount })
}

export async function reportPushFailure(
  origin: SyncProducer,
  context: string,
  error: { message?: string; code?: string; details?: string } | unknown,
  table: string,
  rowId: string,
  payload: string,
  operation: SyncOperation = 'UPDATE'
): Promise<void> {
  if (!await origin.isCurrent()) return
  const err = error as { message?: string; code?: string; details?: string }
  const msg = err?.message ?? (typeof error === 'string' ? error : 'unknown error')
  const code = err?.code ?? ''
  const details = err?.details ?? ''
  console.error(`[PersonalSync] ${context} error:`, msg, code, details, `id=${rowId}`)
  logEvent('error', 'sync', `${context} failed: ${msg}`, `table=${table} id=${rowId} code=${code} details=${details}`)
  try {
    await origin.api.sync.enqueue(table, rowId, operation, payload)
  } catch (e) {
    console.error('[PersonalSync] Failed to enqueue after push error:', e)
  }
  if (!await origin.isCurrent()) return
  useSyncStore.getState().setError(msg || `${context} failed`)
  await refreshProducerPending(origin)
}
