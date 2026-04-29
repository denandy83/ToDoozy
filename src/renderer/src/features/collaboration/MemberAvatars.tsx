/**
 * Overlapping avatar circles for shared project members.
 * Shows all members including current user. Clicking a member
 * toggles an assignee filter (multiselect, blur/hide follows label filter mode).
 */
import { useState } from 'react'
import { useMemberDisplay } from '../../shared/hooks/useMemberDisplay'
import { useLabelStore, selectAssigneeFilters } from '../../shared/stores/labelStore'
import { getAvatarInitials } from '../../../../shared/avatarUtils'
import { isPlaceholderEmail } from '../../../../shared/placeholderUser'

function resolvedDisplayName(displayName: string | null): string | null {
  if (!displayName || displayName === 'Shared User') return null
  return displayName
}

function resolvedEmail(email: string): string | null {
  if (!email || isPlaceholderEmail(email) || email === 'unknown') return null
  return email
}

interface MemberInfo {
  user_id: string
  email: string
  display_name: string | null
  role: string
}

function MemberCircle({
  member,
  projectId,
  zIndex,
  isActive,
  onClick
}: {
  member: MemberInfo
  projectId: string
  zIndex: number
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const display = useMemberDisplay(projectId, member.user_id)

  const name = resolvedDisplayName(member.display_name)
  const email = resolvedEmail(member.email)
  // Use cache initials only when the cache has loaded real data; fall back to props
  const isCacheStale = display.email === 'unknown' || isPlaceholderEmail(display.email)
  const initials = isCacheStale
    ? getAvatarInitials(name, email ?? member.user_id.slice(0, 8))
    : display.initials
  const label = name
    ? email ? `${name} (${email})` : name
    : (email ?? 'Unknown')

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className="flex h-7 w-7 items-center justify-center rounded-full border text-[9px] font-bold uppercase tracking-wider text-white transition-all"
        style={{
          backgroundColor: display.color,
          zIndex: hovered ? 20 : zIndex,
          borderColor: isActive ? 'var(--color-accent)' : hovered ? 'var(--color-foreground)' : 'var(--color-background)',
          boxShadow: isActive ? '0 0 0 1px var(--color-accent)' : 'none',
          transform: hovered ? 'scale(1.15)' : 'scale(1)'
        }}
        onClick={onClick}
        aria-label={`Filter by ${label}`}
      >
        {initials}
      </button>
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted shadow-md ring-1 ring-border">
          {label}
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
}

export function MemberAvatars({
  members,
  currentUserId,
  projectId,
  maxVisible = 5
}: MemberAvatarsProps): React.JSX.Element | null {
  if (members.length <= 1) return null

  const assigneeFilters = useLabelStore(selectAssigneeFilters)
  const toggleAssigneeFilter = useLabelStore((s) => s.toggleAssigneeFilter)

  // Sort: current user first, then others
  const sorted = [...members].sort((a, b) => {
    if (a.user_id === currentUserId) return -1
    if (b.user_id === currentUserId) return 1
    return 0
  })

  const visible = sorted.slice(0, maxVisible)
  const overflow = sorted.length - maxVisible

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((member, index) => (
        <MemberCircle
          key={member.user_id}
          member={member}
          projectId={projectId}
          zIndex={maxVisible - index}
          isActive={assigneeFilters.has(member.user_id)}
          onClick={() => toggleAssigneeFilter(member.user_id)}
        />
      ))}
      {overflow > 0 && (
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-bold text-foreground"
          style={{ zIndex: 0 }}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}
