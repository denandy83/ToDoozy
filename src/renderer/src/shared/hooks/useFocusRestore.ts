import { useEffect, useRef } from 'react'

/**
 * Saves the currently focused element on mount and restores focus to it on unmount.
 * Used by overlays/modals to return focus to the trigger element when closed.
 */
export function useFocusRestore(active = true, containerRef?: React.RefObject<HTMLElement | null>): void {
  const savedRef = useRef<HTMLElement | null>(null)
  const wasActive = useRef(false)
  if (active && !wasActive.current) savedRef.current = document.activeElement as HTMLElement | null
  wasActive.current = active

  useEffect(() => {
    if (!active) return
    const container = containerRef?.current

    return () => {
      const el = savedRef.current
      const focused = document.activeElement
      const focusMovedElsewhere = container && focused !== document.body && focused && !container.contains(focused)
      if (!focusMovedElsewhere && el && typeof el.focus === 'function' && document.body.contains(el)) {
        requestAnimationFrame(() => {
          const current = document.activeElement
          if (!container || current === document.body || current === el || (current && container.contains(current))) el.focus()
        })
      }
    }
  }, [active, containerRef])
}
