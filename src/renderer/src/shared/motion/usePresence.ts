import { useEffect, useState } from 'react'
import { immediateMotion, MOTION, subscribeMotionInput, type MotionKind } from './motion'
import { scheduleExit } from './presence'

export function usePresence(open: boolean, kind: MotionKind = 'menu', instant = false): {
  present: boolean
  props: { 'data-state': 'open' | 'closed'; 'data-instant': boolean; 'aria-hidden': boolean | undefined; inert: boolean }
} {
  const [retained, setRetained] = useState(open)
  const immediate = instant || immediateMotion()
  useEffect(subscribeMotionInput, [])
  useEffect(() => {
    if (open) setRetained(true)
    if (!open && !retained) return
    return scheduleExit(open, immediate ? 0 : MOTION[kind].exit, () => setRetained(false))
  }, [open, retained, kind, immediate])
  return { present: open || retained, props: { 'data-state': open ? 'open' : 'closed', 'data-instant': immediate, 'aria-hidden': open ? undefined : true, inert: !open } }
}
