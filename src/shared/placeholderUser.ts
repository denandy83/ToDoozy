const PREFIX = 'shared-user+'
const SUFFIX = '@local'

export function placeholderEmail(userId: string): string {
  return `${PREFIX}${userId}${SUFFIX}`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email === 'shared-user' || email.startsWith(PREFIX)
}
