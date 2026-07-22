import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Project } from '../../../../../shared/types'

interface MyDayProjectSelectorProps {
  projects: Project[]
  selectedProjectId: string
  onSelect: (projectId: string) => void
}

export function MyDayProjectSelector({
  projects,
  selectedProjectId,
  onSelect
}: MyDayProjectSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = projects.find((p) => p.id === selectedProjectId)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0 pl-4 pr-1 py-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-foreground/6"
        title="Select project for new task"
      >
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: selected?.color ?? '#888' }}
        />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted max-w-[80px] truncate">
          {selected?.name ?? 'Project'}
        </span>
        <ChevronDown size={10} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100">
          <div className="max-h-48 overflow-y-auto py-1">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onSelect(p.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-foreground/6 ${
                  p.id === selectedProjectId ? 'bg-accent/12' : ''
                }`}
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-[11px] font-light text-foreground truncate">
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
