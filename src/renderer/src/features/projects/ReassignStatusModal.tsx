import { useState } from 'react'
import { Modal } from '../../shared/components/Modal'
import type { Status } from '../../../../shared/types'

interface ReassignStatusModalProps {
  open: boolean
  onClose: () => void
  statusToDelete: Status
  availableStatuses: Status[]
  onReassignAndDelete: (targetStatusId: string) => Promise<void>
  onDirectDelete: () => Promise<void>
}

export function ReassignStatusModal({
  open,
  onClose,
  statusToDelete,
  availableStatuses,
  onReassignAndDelete,
  onDirectDelete
}: ReassignStatusModalProps): React.JSX.Element {
  const [targetId, setTargetId] = useState(availableStatuses[0]?.id ?? '')
  const [loading, setLoading] = useState(false)

  const handleReassign = async (): Promise<void> => {
    setLoading(true)
    try {
      await onReassignAndDelete(targetId)
    } finally {
      setLoading(false)
    }
  }

  const handleDirectDelete = async (): Promise<void> => {
    setLoading(true)
    try {
      await onDirectDelete()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete Status">
      <div className="flex flex-col gap-4">
        <p className="text-sm font-light text-foreground">
          Delete <strong className="font-medium">&ldquo;{statusToDelete.name}&rdquo;</strong>?
          Any tasks with this status will need to be reassigned.
        </p>

        <div>
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            Reassign tasks to
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          >
            {availableStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:bg-foreground/6"
          >
            Cancel
          </button>
          <button
            onClick={handleDirectDelete}
            disabled={loading}
            className="rounded-lg border border-danger/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            Delete Without Reassigning
          </button>
          <button
            onClick={handleReassign}
            disabled={loading || !targetId}
            className="rounded-lg bg-danger px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-danger/80 disabled:opacity-50"
          >
            {loading ? 'Deleting...' : 'Reassign & Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
