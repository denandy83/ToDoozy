/**
 * settingsSyncPolicy — the single source of truth for which `settings` keys are
 * allowed to leave this device.
 *
 * `api_key` is a bearer secret. The plaintext is kept DEVICE-LOCAL only (stored
 * under `user_id=''`, the same convention `whats_new` uses) and only its
 * SHA-256 hash is persisted server-side in the `api_keys` table (stories
 * #98/#114). It must therefore never be written to the cloud `user_settings`
 * table by ANY sync path — the debounced push, the first-time full upload, or
 * the incremental reconcile. Excluding it here is defense-in-depth: even a stray
 * `setSetting('api_key', …)` can never leak the plaintext to Supabase.
 *
 * Kept in its own tiny module so both PersonalSyncService (push paths) and
 * syncTables (reconcile localList) can import it without a circular dependency.
 */
export const SYNC_EXCLUDED_SETTING_KEYS: ReadonlySet<string> = new Set<string>(['api_key'])

/** True when `key` must never be pushed to the cloud `user_settings` table. */
export function isSettingSyncExcluded(key: string): boolean {
  return SYNC_EXCLUDED_SETTING_KEYS.has(key)
}
