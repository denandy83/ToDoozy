import { useRef, type ReactNode } from 'react'
import { usePresence } from '../motion/usePresence'

/** react-datepicker keeps popperContainer mounted when its popper becomes null. */
export function CalendarMotion({ children }: { children?: ReactNode }): React.JSX.Element | null {
  const open = Boolean(children)
  const presence = usePresence(open)
  const retained = useRef(children)
  if (open) retained.current = children
  if (!presence.present) return null
  return <div {...presence.props} className="ui-calendar-motion">{retained.current}</div>
}
