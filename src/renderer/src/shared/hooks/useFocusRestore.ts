import { useEffect, useRef } from 'react'

/**
 * Saves the currently focused element on mount and restores focus to it on unmount.
 * Used by overlays/modals to return focus to the trigger element when closed.
 */
export function useFocusRestore(): void {
  const savedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    savedRef.current = document.activeElement as HTMLElement | null

    return () => {
      const el = savedRef.current
      if (el && typeof el.focus === 'function' && document.body.contains(el)) {
        requestAnimationFrame(() => el.focus())
      }
    }
  }, [])
}
