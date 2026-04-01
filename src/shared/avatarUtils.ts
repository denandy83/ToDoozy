export const AVATAR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#a855f7', '#e11d48'
]

/** Stable color derived from a user ID */
export function getAvatarColor(userId: string, override?: string | null): string {
  if (override) return override
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

/** Auto-generate initials from display name or email */
export function getAvatarInitials(displayName: string | null, email: string, override?: string | null): string {
  if (override) return override.toUpperCase()
  if (displayName) {
    const parts = displayName.split(' ').filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return parts[0]?.slice(0, 2).toUpperCase() ?? '?'
  }
  return email.slice(0, 2).toUpperCase()
}
