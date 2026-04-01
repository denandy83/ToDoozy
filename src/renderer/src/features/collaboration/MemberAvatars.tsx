/**
 * Asana-style overlapping avatar circles for shared project members.
 * Shows in the project header area for shared projects.
 */
import { useState } from 'react'
import { useMemberDisplay } from '../../shared/hooks/useMemberDisplay'

interface MemberInfo {
  user_id: string
  email: string
  display_name: string | null
  role: string
}

// Wrapper to use the hook per-member inside the list
function MemberCircle({ member, projectId, zIndex }: { member: MemberInfo; projectId: string; zIndex: number }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const display = useMemberDisplay(projectId, member.user_id)
  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[9px] font-bold uppercase tracking-wider text-white"
        style={{ backgroundColor: display.color, zIndex }}
      >
        {display.initials}
      </div>
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted shadow-md ring-1 ring-border">
          {member.email}
        </div>
      )}
    </div>
  )
}

interface MemberAvatarsProps {
  members: MemberInfo[]
  currentUserId: string
  projectId: string
  maxVisible?: number
  onClickAvatars?: () => void
}

export function MemberAvatars({
  members,
  currentUserId,
  projectId,
  maxVisible = 4,
  onClickAvatars
}: MemberAvatarsProps): React.JSX.Element | null {
  // Filter out current user
  const otherMembers = members.filter((m) => m.user_id !== currentUserId)
  if (otherMembers.length === 0) return null

  const visible = otherMembers.slice(0, maxVisible)
  const overflow = otherMembers.length - maxVisible

  return (
    <button
      className="flex items-center -space-x-2 transition-opacity hover:opacity-80"
      onClick={onClickAvatars}
      title="View project members"
      aria-label={`${otherMembers.length} project member${otherMembers.length !== 1 ? 's' : ''}`}
    >
      {visible.map((member, index) => (
        <MemberCircle key={member.user_id} member={member} projectId={projectId} zIndex={maxVisible - index} />
      ))}
      {overflow > 0 && (
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-bold text-foreground"
          style={{ zIndex: 0 }}
        >
          +{overflow}
        </div>
      )}
    </button>
  )
}
