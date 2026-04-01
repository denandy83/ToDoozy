/**
 * Asana-style overlapping avatar circles for shared project members.
 * Shows in the project header area for shared projects.
 */
import { useState } from 'react'

interface MemberInfo {
  user_id: string
  email: string
  display_name: string | null
  role: string
}

interface MemberAvatarsProps {
  members: MemberInfo[]
  currentUserId: string
  maxVisible?: number
  onClickAvatars?: () => void
}

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#a855f7', '#e11d48'
]

function getInitials(displayName: string | null, email: string): string {
  if (displayName) {
    const parts = displayName.split(' ').filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return parts[0]?.slice(0, 2).toUpperCase() ?? '?'
  }
  return email.slice(0, 2).toUpperCase()
}

function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

export function MemberAvatars({
  members,
  currentUserId,
  maxVisible = 4,
  onClickAvatars
}: MemberAvatarsProps): React.JSX.Element | null {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

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
        <div
          key={member.user_id}
          className="relative"
          onMouseEnter={() => setHoveredId(member.user_id)}
          onMouseLeave={() => setHoveredId(null)}
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[9px] font-bold uppercase tracking-wider text-white"
            style={{ backgroundColor: getAvatarColor(index), zIndex: maxVisible - index }}
          >
            {getInitials(member.display_name, member.email)}
          </div>
          {hoveredId === member.user_id && (
            <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted shadow-md ring-1 ring-border">
              {member.email}
            </div>
          )}
        </div>
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
