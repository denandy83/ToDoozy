/**
 * Global popup stack for layered Escape handling.
 *
 * Any component that renders an overlay (calendar, custom dropdown, etc.)
 * calls pushPopup() with its close function. The global Escape handler in
 * AppLayout fires first (capture phase on window) and always closes the
 * topmost open popup — nothing lower in the tree needs to inspect whether
 * some sibling popup is open.
 *
 * Usage:
 *   useEffect(() => {
 *     if (!isOpen) return
 *     return pushPopup(() => setIsOpen(false))
 *   }, [isOpen])
 */

type CloseHandler = () => void
const stack: CloseHandler[] = []

/** Register an open popup. Returns an unsubscribe function to call on close. */
export function pushPopup(close: CloseHandler): () => void {
  stack.push(close)
  return () => {
    const i = stack.lastIndexOf(close)
    if (i !== -1) stack.splice(i, 1)
  }
}

/**
 * Close the most recently opened popup.
 * Returns true if something was closed, false if the stack was empty.
 */
export function closeTopPopup(): boolean {
  if (stack.length === 0) return false
  const close = stack.pop()!
  close()
  return true
}
