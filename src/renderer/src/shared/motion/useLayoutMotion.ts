import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { immediateMotion, EASE_OUT, REORDER_DURATION } from './motion'

function layoutRects(container: HTMLElement | null): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  container?.querySelectorAll<HTMLElement>('[data-layout-task]').forEach((element) => {
    rects.set(element.dataset.layoutTask!, element.getBoundingClientRect())
  })
  return rects
}

/** FLIP only after an explicit pointer drop; data refreshes and keyboard actions remain instant. */
export function useLayoutMotion(container: RefObject<HTMLElement | null>): (drop: () => Promise<boolean>) => Promise<void> {
  const animations = useRef<Animation[]>([])
  useEffect(() => () => { animations.current.forEach((animation) => animation.cancel()) }, [])
  return useCallback(async (drop: () => Promise<boolean>) => {
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    const before = immediateMotion() ? null : layoutRects(container.current)
    let valid = true
    const invalidate = (): void => { valid = false }
    window.addEventListener('scroll', invalidate, true)
    window.addEventListener('resize', invalidate)
    window.addEventListener('pointerdown', invalidate, true)
    window.addEventListener('keydown', invalidate, true)
    try {
      if (!await drop() || !before) return
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (!valid || immediateMotion()) return
      container.current?.querySelectorAll<HTMLElement>('[data-layout-task]').forEach((element) => {
        const old = before.get(element.dataset.layoutTask!)
        if (!old) return
        const rect = element.getBoundingClientRect()
        const x = old.left - rect.left, y = old.top - rect.top
        if (Math.abs(x) + Math.abs(y) < 1) return
        animations.current.push(element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: REORDER_DURATION, easing: EASE_OUT }))
      })
    } finally {
      window.removeEventListener('scroll', invalidate, true)
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('pointerdown', invalidate, true)
      window.removeEventListener('keydown', invalidate, true)
    }
  }, [container])
}
