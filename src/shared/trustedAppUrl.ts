/** Only the application's exact document is privileged; query/hash are routing. */
export function isTrustedAppUrl(candidate: string, appUrl: string): boolean {
  try {
    const value = new URL(candidate), trusted = new URL(appUrl)
    return value.protocol === trusted.protocol && value.host === trusted.host
      && value.pathname === trusted.pathname && value.username === '' && value.password === ''
  } catch { return false }
}
