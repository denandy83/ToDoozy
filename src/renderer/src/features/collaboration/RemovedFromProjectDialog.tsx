import { useCallback, useEffect, useRef, useState } from 'react'
import { captureSyncProducer } from '../../services/syncContext'
import { recoverProject } from '../../services/projectRecovery'
import { useDatabaseScope } from '../../shared/hooks/useDatabaseScope'
import { useAuthStore } from '../../shared/stores/authStore'
import { useDismissibleSurface } from '../../shared/motion/useDismissibleSurface'
import { useToast } from '../../shared/components/Toast'
import type { User } from '../../../../shared/types'
import type { RemovedFromProject } from './useSharedProjectRealtime'

interface RemovedFromProjectDialogProps {
  removedFromProject: RemovedFromProject
  currentUser: User | null
  onClose: () => void
}

/**
 * Dialog shown when the current user is removed from (or unshared out of) a
 * shared project via Realtime. Recovery-copy semantics belong to recoverProject.
 */
export function RemovedFromProjectDialog({
  removedFromProject,
  currentUser,
  onClose: finishClose
}: RemovedFromProjectDialogProps): React.JSX.Element | null {
  const scope = useDatabaseScope()
  const initialScope = useRef(scope).current
  const active = useRef(true)
  const busy = useRef(false)
  const [working, setWorking] = useState(false)
  const removedRef = useRef(removedFromProject)
  removedRef.current = removedFromProject
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const closing = useRef<() => boolean>(() => false)
  const surface = useDismissibleSurface(() => { if (closing.current()) finishClose() })
  const closeSurface = surface.close
  const onClose = useCallback(() => {
    const closingId = removedFromProject.id
    const ownerId = currentUser?.id
    closing.current = () => active.current && removedRef.current.id === closingId && window.api.sync.currentContext() === initialScope && useAuthStore.getState().currentUser?.id === ownerId
    closeSurface()
  }, [closeSurface, removedFromProject, currentUser?.id, initialScope])

  const { addToast } = useToast()

  if (scope !== initialScope || useAuthStore.getState().currentUser?.id !== currentUser?.id) return null
  return (
    <div {...surface.props} className="ui-surface ui-dialog ui-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="ui-modal-content w-80 rounded-lg border border-border bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-light text-foreground">
          You were removed from <span className="font-medium">{removedFromProject.name}</span>
        </h3>
        <p className="mt-2 text-[11px] text-muted">
          The owner unshared the project or removed you. Would you like to keep a local copy?
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={async () => {
              if (busy.current || scope !== initialScope || !currentUser || useAuthStore.getState().currentUser?.id !== currentUser.id) return
              busy.current = true
              setWorking(true)
              const origin = captureSyncProducer()
              const uiCurrent = (): boolean => active.current && removedRef.current.id === removedFromProject.id && window.api.sync.currentContext() === initialScope && useAuthStore.getState().currentUser?.id === currentUser.id
              try {
                if (!await recoverProject(removedFromProject.id, true, origin)) return
                if (!uiCurrent()) return
                onClose()
                addToast({ message: 'A local copy has been kept.' })
              } catch {
                if (await origin.isCurrent() && uiCurrent()) addToast({ message: 'Failed to keep project copy', variant: 'danger' })
              } finally {
                busy.current = false
                if (uiCurrent()) setWorking(false)
              }
            }}
            disabled={working}
            className="flex-1 rounded-md border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6"
          >
            Keep Copy
          </button>
          <button
            onClick={async () => {
              if (busy.current || scope !== initialScope || !currentUser || useAuthStore.getState().currentUser?.id !== currentUser.id) return
              busy.current = true
              setWorking(true)
              const origin = captureSyncProducer()
              const uiCurrent = (): boolean => active.current && removedRef.current.id === removedFromProject.id && window.api.sync.currentContext() === initialScope && useAuthStore.getState().currentUser?.id === currentUser.id
              try {
                if (!await recoverProject(removedFromProject.id, false, origin)) return
                if (!uiCurrent()) return
                onClose()
                addToast({ message: 'Project deleted.' })
              } catch {
                if (await origin.isCurrent() && uiCurrent()) addToast({ message: 'Failed to delete project', variant: 'danger' })
              } finally {
                busy.current = false
                if (uiCurrent()) setWorking(false)
              }
            }}
            disabled={working}
            className="flex-1 rounded-md bg-danger px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-danger/90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
