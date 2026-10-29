/** The exit timer is shared and cancellable, so reopening never unmounts a live surface. */
export function scheduleExit(open: boolean, duration: number, onExit: () => void): () => void {
  if (open) return () => {}
  if (duration === 0) { onExit(); return () => {} }
  const timer = setTimeout(onExit, duration)
  return () => clearTimeout(timer)
}
