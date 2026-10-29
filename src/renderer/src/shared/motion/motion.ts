export const MOTION = {
  menu: { enter: 160, exit: 100 },
  dialog: { enter: 220, exit: 140 },
  panel: { enter: 240, exit: 160 },
  toast: { enter: 180, exit: 120 },
  tooltip: { enter: 125, exit: 90 }
} as const
export type MotionKind = keyof typeof MOTION
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
export const REORDER_DURATION = 160
let modality: 'pointer' | 'keyboard' = 'pointer'
let subscribers = 0
let layoutUntil = 0

function pointer(): void { modality = 'pointer'; document.documentElement.dataset.inputModality = modality }
function keyboard(event: KeyboardEvent): void {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
  modality = 'keyboard'; document.documentElement.dataset.inputModality = modality
}
export function subscribeMotionInput(): () => void {
  if (subscribers++ === 0) {
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('pointermove', pointer, true)
    window.addEventListener('keydown', keyboard, true)
  }
  return () => {
    if (--subscribers === 0) {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('pointermove', pointer, true)
      window.removeEventListener('keydown', keyboard, true)
    }
  }
}
export function reducedMotion(): boolean { return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) }
export function immediateMotion(): boolean { return modality === 'keyboard' || reducedMotion() }
export function markPointerReorder(): void { layoutUntil = immediateMotion() ? 0 : Date.now() + 2000 }
export function canAnimateReorder(): boolean { return !immediateMotion() && Date.now() < layoutUntil }
