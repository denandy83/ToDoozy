import { useState, useRef, useEffect } from 'react'
import { UserCircle } from 'lucide-react'
import { useMemberDisplay, useProjectMemberDisplays } from '../../../shared/hooks/useMemberDisplay'
import { useTaskStore } from '../../../shared/stores'

export function InlineAssignee({ taskId, assignedTo, projectId }: { taskId: string; assignedTo: string | null; projectId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const assignedDisplay = useMemberDisplay(projectId, assignedTo ?? '')
  const allDisplays = useProjectMemberDisplays(projectId)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open])

  const handleAssign = (userId: string | null): void => {
    useTaskStore.getState().updateTask(taskId, { assigned_to: userId })
    setOpen(false)
  }

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex h-4 w-4 items-center justify-center rounded-full transition-opacity hover:opacity-80"
        title={assignedTo ? `Assigned to ${assignedDisplay.display_name ?? assignedDisplay.email}` : 'Assign'}
      >
        {assignedTo ? (
          <div
            className="flex h-4 w-4 items-center justify-center rounded-full text-[7px] font-bold uppercase text-white"
            style={{ backgroundColor: assignedDisplay.color }}
          >
            {assignedDisplay.initials}
          </div>
        ) : (
          <div className="flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-muted/20 group-hover:border-muted/40">
            <UserCircle size={8} className="text-muted/0 group-hover:text-muted/40" />
          </div>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-surface py-1 shadow-xl">
          {assignedTo && (
            <button
              onClick={(e) => { e.stopPropagation(); handleAssign(null) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-light text-muted transition-colors hover:bg-foreground/6"
            >
              Unassign
            </button>
          )}
          {Array.from(allDisplays.entries()).map(([userId, d]) => (
            <button
              key={userId}
              onClick={(e) => { e.stopPropagation(); handleAssign(userId) }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-foreground/6 ${userId === assignedTo ? 'bg-accent/8' : ''}`}
            >
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full text-[7px] font-bold uppercase text-white"
                style={{ backgroundColor: d.color }}
              >
                {d.initials}
              </div>
              <span className="truncate text-[12px] font-light text-foreground">{d.display_name ?? d.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
