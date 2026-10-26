/** Preserve explicit schemes; only bare domains receive an HTTPS prefix. */
export function ensureProtocol(url: string): string {
  const trimmed = url.trim()
  const bareHostPort = /^[^/:\s]+:\d+(?:[/?#]|$)/.test(trimmed)
  return !bareHostPort && /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed) && (!trimmed.includes('.') || /\s/.test(trimmed))) return false
  try {
    const url = new URL(ensureProtocol(trimmed))
    return ['http:', 'https:', 'mailto:', 'file:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function displayUrl(url: string): string {
  try {
    const parsed = new URL(ensureProtocol(url))
    const display = parsed.protocol === 'file:' ? decodeURI(parsed.pathname)
      : parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
    return display.length > 50 ? display.slice(0, 47) + '...' : display
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '...' : url
  }
}
