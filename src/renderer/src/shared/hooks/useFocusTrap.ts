import { useEffect, useRef } from 'react'

/**
 * Traps Tab/Shift+Tab focus within a container element.
 * Focus cycles between the first and last focusable elements inside the container.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active = true): void {
  const isActiveRef = useRef(active)
  isActiveRef.current = active

  useEffect(() => {
    if (!active) return

    const container = containerRef.current
    if (!container) return

    const getFocusableElements = (): HTMLElement[] => {
      const elements = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      return Array.from(elements).filter(
        (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
      )
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !isActiveRef.current) return

      const focusable = getFocusableElements()
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last || !container.contains(document.activeElement)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [containerRef, active])
}
