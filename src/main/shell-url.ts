/**
 * Scheme allowlist enforcement for `shell.openExternal`.
 *
 * The renderer can pass ANY string across the `shell:openExternal` IPC boundary,
 * so this validation MUST run in the main process — callers are never trusted to
 * sanitise. Only web/mail schemes are permitted; everything else (file:, smb:,
 * javascript:, custom app schemes) and any malformed URL is rejected.
 */

/** Protocols the main process will hand to `shell.openExternal`. Note the trailing colon. */
export const ALLOWED_EXTERNAL_PROTOCOLS: readonly string[] = ['https:', 'http:', 'mailto:']

/** Result of validating a renderer-supplied external URL. */
export type ExternalUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: string }

/**
 * Pure validator for `shell:openExternal` input. No side effects — safe to unit-test.
 *
 * @param rawUrl the untrusted string supplied by the renderer
 * @returns `{ ok: true }` when the scheme is allowlisted, otherwise `{ ok: false, reason }`
 *          with a human-readable reason for logging. Malformed URLs (the `URL`
 *          constructor throws) are rejected, not thrown.
 */
export function validateExternalUrl(rawUrl: string): ExternalUrlValidation {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: `malformed URL: ${JSON.stringify(rawUrl)}` }
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: `blocked protocol "${parsed.protocol}" for URL ${JSON.stringify(rawUrl)}` }
  }

  return { ok: true, url: rawUrl }
}
