/**
 * Assignee picker dropdown for shared projects.
 * Shows project members with avatar circles and emails.
 */
import { useState, useEffect, useRef } from 'react'
import { UserCircle, X } from 'lucide-react'
import { useMemberDisplay, useProjectMemberDisplays } from '../../shared/hooks/useMemberDisplay'

interface AssigneePickerProps {
  projectId: string
  currentAssignee: string | null
  onAssign: (userId: string | null) => void
}

export function AssigneePicker({
  projectId,
  currentAssignee,
  onAssign
}: AssigneePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open])

  const assignedDisplay = useMemberDisplay(projectId, currentAssignee ?? '')
  const allDisplays = useProjectMemberDisplays(projectId)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        title={currentAssignee ? `Assigned to ${assignedDisplay.display_name ?? assignedDisplay.email}` : 'Assign to member'}
      >
        {currentAssignee ? (
          <>
            <div
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold uppercase text-white"
              style={{ backgroundColor: assignedDisplay.color }}
            >
              {assignedDisplay.initials}
            </div>
            <span className="text-[12px] font-light text-foreground">
              {assignedDisplay.display_name ?? assignedDisplay.email}
            </span>
          </>
        ) : (
          <>
            <UserCircle size={14} />
            <span className="text-[12px] font-light">Unassigned</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-background shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
              Assign to
            </h4>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {currentAssignee && (
              <button
                onClick={() => { onAssign(null); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/6"
              >
                <X size={14} className="text-muted" />
                <span className="text-[13px] font-light text-muted">Unassign</span>
              </button>
            )}
            {Array.from(allDisplays.entries()).map(([userId, d]) => (
              <button
                key={userId}
                onClick={() => { onAssign(userId); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/6 ${
                  userId === currentAssignee ? 'bg-accent/8' : ''
                }`}
              >
                <div
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold uppercase text-white"
                  style={{ backgroundColor: d.color }}
                >
                  {d.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-light text-foreground">
                    {d.display_name ?? d.email}
                  </p>
                  {d.display_name && (
                    <p className="truncate text-[10px] text-muted">{d.email}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
