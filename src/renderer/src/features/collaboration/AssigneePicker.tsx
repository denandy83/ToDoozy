/**
 * Assignee picker dropdown for shared projects.
 * Shows project members with avatar circles and emails.
 */
import { useState, useEffect, useRef } from 'react'
import { UserCircle, X } from 'lucide-react'
import type { ProjectMember } from '../../../../shared/types'

interface AssigneePickerProps {
  projectId: string
  currentAssignee: string | null
  onAssign: (userId: string | null) => void
}

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6'
]

function getInitials(displayName: string | null, email: string): string {
  if (displayName) {
    const parts = displayName.split(' ').filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return parts[0]?.slice(0, 2).toUpperCase() ?? '?'
  }
  return email.slice(0, 2).toUpperCase()
}

interface MemberWithProfile extends ProjectMember {
  email: string
  display_name: string | null
}

export function AssigneePicker({
  projectId,
  currentAssignee,
  onAssign
}: AssigneePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
      const rawMembers = await window.api.projects.getMembers(projectId)
      // Enrich with user info
      const enriched: MemberWithProfile[] = []
      for (const m of rawMembers) {
        const user = await window.api.users.findById(m.user_id)
        enriched.push({
          ...m,
          email: user?.email ?? 'unknown',
          display_name: user?.display_name ?? null
        })
      }
      setMembers(enriched)
    }
    if (open) load()
  }, [projectId, open])

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

  const assignedMember = members.find((m) => m.user_id === currentAssignee)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        title={currentAssignee ? `Assigned to ${assignedMember?.display_name ?? assignedMember?.email ?? 'someone'}` : 'Assign'}
      >
        <UserCircle size={14} />
        {currentAssignee && assignedMember && (
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {getInitials(assignedMember.display_name, assignedMember.email)}
          </span>
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
            {/* Unassign option */}
            {currentAssignee && (
              <button
                onClick={() => { onAssign(null); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/6"
              >
                <X size={14} className="text-muted" />
                <span className="text-[13px] font-light text-muted">Unassign</span>
              </button>
            )}
            {members.map((member, index) => (
              <button
                key={member.user_id}
                onClick={() => { onAssign(member.user_id); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/6 ${
                  member.user_id === currentAssignee ? 'bg-accent/8' : ''
                }`}
              >
                <div
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold uppercase text-white"
                  style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                >
                  {getInitials(member.display_name, member.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-light text-foreground">
                    {member.display_name ?? member.email}
                  </p>
                  {member.display_name && (
                    <p className="truncate text-[10px] text-muted">{member.email}</p>
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
