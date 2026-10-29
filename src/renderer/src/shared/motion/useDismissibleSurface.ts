import { useCallback, useEffect, useState } from 'react'
import { usePresence } from './usePresence'
import type { MotionKind } from './motion'

/** For surfaces whose parent removes the component in its onClose callback. */
export function useDismissibleSurface(onClose: () => void, kind: MotionKind = 'dialog'): {
  props: ReturnType<typeof usePresence>['props']; close: () => void
} {
  const [open, setOpen] = useState(true)
  const presence = usePresence(open, kind)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => { if (!presence.present) onClose() }, [presence.present, onClose])
  return { props: presence.props, close }
}
