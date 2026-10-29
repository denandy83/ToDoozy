import { cloneElement, useRef, type ReactElement } from 'react'
import { usePresence } from './usePresence'
import type { MotionKind } from './motion'

/** Use at the conditional boundary. The DOM surface stays mounted for its exit. */
export function MotionPresence({ open, children, kind = 'menu', origin = 'top left', instant = false }: {
  open: boolean
  children: ReactElement | (() => ReactElement | null)
  kind?: MotionKind
  origin?: string
  instant?: boolean
}): React.JSX.Element | null {
  const presence = usePresence(open, kind, instant)
  const retained = useRef<ReactElement | null>(null)
  if (open) retained.current = typeof children === 'function' ? children() : children
  if (!presence.present || !retained.current) return null
  const child = retained.current as ReactElement<{ className?: string; style?: React.CSSProperties }>
  return cloneElement(child, { ...presence.props, className: `ui-surface ui-${kind} ${child.props.className ?? ''}`, style: { ...child.props.style, transformOrigin: origin } } as typeof child.props)
}
