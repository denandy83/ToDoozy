import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { canAnimateReorder, EASE_OUT, REORDER_DURATION } from './motion'

function layoutRects(container: HTMLElement | null): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  container?.querySelectorAll<HTMLElement>('[data-layout-task]').forEach((element) => {
    rects.set(element.dataset.layoutTask!, element.getBoundingClientRect())
  })
  return rects
}

/** FLIP only after an explicit pointer drop; data refreshes and keyboard actions remain instant. */
export function useLayoutMotion(container: RefObject<HTMLElement | null>, revision: unknown): () => void {
  const previous = useRef(new Map<string, DOMRect>())
  const animations = useRef<Animation[]>([])
  useLayoutEffect(() => {
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    const next = layoutRects(container.current)
    container.current?.querySelectorAll<HTMLElement>('[data-layout-task]').forEach((element) => {
      const id = element.dataset.layoutTask!
      const rect = next.get(id)!
      const old = previous.current.get(id)
      if (!old || !canAnimateReorder() || document.documentElement.classList.contains('is-dragging')) return
      const x = old.left - rect.left, y = old.top - rect.top
      if (Math.abs(x) + Math.abs(y) < 1) return
      animations.current.push(element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: REORDER_DURATION, easing: EASE_OUT }))
    })
    previous.current = next
    return () => { animations.current.forEach((animation) => animation.cancel()) }
  }, [container, revision])
  return useCallback(() => {
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    previous.current = layoutRects(container.current)
  }, [container])
}
