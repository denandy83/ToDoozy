import { useEffect, useRef, useState } from 'react'

interface UseTaskRowLabelOverflowResult {
  rowRef: React.RefObject<HTMLDivElement | null>
  titleRef: React.RefObject<HTMLSpanElement | null>
  maxVisibleLabels: number
}

/**
 * Dynamically adjusts the number of visible label chips on a TaskRow based on
 * row width. When the title is truncated, progressively hide labels; reset to
 * show all when the row resizes wider (e.g. fullscreen). Extracted verbatim
 * from TaskRow (Story #107) — the ResizeObserver logic and effect deps are
 * unchanged.
 */
export function useTaskRowLabelOverflow(
  taskLabelsLength: number,
  taskTitle: string
): UseTaskRowLabelOverflowResult {
  const [maxVisibleLabels, setMaxVisibleLabels] = useState(Infinity)
  const titleRef = useRef<HTMLSpanElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const lastRowWidth = useRef(0)

  useEffect(() => {
    const row = rowRef.current
    const el = titleRef.current
    if (!row || !el || taskLabelsLength === 0) {
      setMaxVisibleLabels(Infinity)
      return
    }
    let settling = false
    const observer = new ResizeObserver(() => {
      if (settling) return
      const currentWidth = row.clientWidth
      const grewWider = currentWidth > lastRowWidth.current + 20
      lastRowWidth.current = currentWidth

      if (grewWider) {
        // Row got wider — try showing all labels again
        setMaxVisibleLabels(Infinity)
        return
      }

      const isTruncated = el.scrollWidth > el.clientWidth + 2
      if (isTruncated) {
        settling = true
        setMaxVisibleLabels((prev) => {
          const next = Math.max(0, (prev === Infinity ? taskLabelsLength : prev) - 1)
          // Let the layout settle before observing again
          requestAnimationFrame(() => { settling = false })
          return next
        })
      }
    })
    observer.observe(row)
    lastRowWidth.current = row.clientWidth
    // Initial check
    const isTruncated = el.scrollWidth > el.clientWidth + 2
    if (isTruncated) {
      setMaxVisibleLabels(Math.min(3, taskLabelsLength))
    } else {
      setMaxVisibleLabels(Infinity)
    }
    return () => observer.disconnect()
  }, [taskLabelsLength, taskTitle])

  return { rowRef, titleRef, maxVisibleLabels }
}
