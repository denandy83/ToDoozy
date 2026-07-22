import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Label } from '../../../../../shared/types'

export function LabelOverflowBadge({ labels }: { labels: Label[] }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const handleMouseEnter = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos({ top: rect.top, left: rect.left + rect.width / 2 })
    }
    setHovered(true)
  }, [])

  return (
    <>
      <span
        ref={ref}
        className="text-[9px] font-bold tabular-nums text-muted cursor-default"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
      >
        +{labels.length}
      </span>
      {hovered && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 shadow-xl"
          style={{ top: pos.top - 8, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          {labels.map((l) => (
            <span key={l.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-foreground">{l.name}</span>
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
