# Story #114 — Stop syncing the plaintext API key to Supabase user_settings

**Risk class**: security-migration
**Verification tier**: full
**Demo statement**: Generate a new API key in Settings → Integrations, then inspect the Supabase `user_settings` rows for your user — the raw key must NOT appear in any `value`; MCP auth and quick-add still work.

## Implementation guide

Found during #98 verification: #98 hashed the `api_keys` table, but the raw key still leaks to the cloud by a second path. `handleGenerateApiKey` (src/renderer/src/features/settings/IntegrationsSettingsContent.tsx) calls `setSetting('api_key', key)` with the PLAINTEXT key, and `pushSetting` in `src/renderer/src/services/PersonalSyncService.ts` has NO exclusion for `api_key`, so the plaintext key is upserted into `user_settings.value` on Supabase (5s debounce). The UI comment claiming the plaintext "is never persisted server-side" is therefore false. There is also a legacy `quick_add_task` RPC path that historically read a plaintext `api_key` from `user_settings` as a fallback.

1. Read the current state of these files first (they changed under #98):
   - `src/renderer/src/features/settings/IntegrationsSettingsContent.tsx` — `handleGenerateApiKey`
   - `src/renderer/src/services/PersonalSyncService.ts` — `pushSetting` (and how `whats_new` is already kept device-local under `user_id=''`)
   - the `quick_add_task` RPC (see `supabase/migrations/20260722000000_hash_api_keys.sql` from #98 — it now matches on `key_hash`).
2. Ensure the plaintext key is never written to a synced setting:
   - Either stop calling `setSetting('api_key', …)` with the raw key, or store it device-local ONLY (the same `user_id=''` device-local convention `whats_new` uses so it never enters personal sync).
   - Add `api_key` to `pushSetting`'s exclusion list as defense-in-depth, so even a stray write never syncs.
3. Purge any already-synced plaintext: on next launch / key generation, delete the `api_key` row from Supabase `user_settings` for the user (one-time cleanup), so previously-leaked keys don't linger in the cloud.
4. Confirm `quick_add_task` no longer depends on a plaintext `user_settings.api_key`: after #98 it authenticates via `key_hash` on `api_keys`. If any fallback still reads the plaintext user_settings value, remove/close it (hash-based only). Do NOT break iOS Shortcut / Telegram quick-add — verify the RPC path still authenticates by hash.
5. Fix the misleading UI comment to state accurately where the key lives (device-local, hashed server-side in api_keys).
6. Keep pure logic testable with Vitest; add a regression test asserting `pushSetting` never emits `api_key` (and/or that generate-key does not write a synced setting).

Human step note (put in commit body): if the quick_add_task change requires a migration it must be human-applied with the #98 rollout; do not apply or deploy from the loop.

## Acceptance criteria

- Generating an API key never results in the raw key being written to any synced `user_settings` row (verified by test on `pushSetting` and by tracing `handleGenerateApiKey`).
- `pushSetting` explicitly excludes `api_key` from sync.
- Any previously-synced plaintext `api_key` in Supabase `user_settings` is purged on next run/key-gen (one-time cleanup path exists).
- quick-add (iOS Shortcut / Telegram) still authenticates — via `key_hash`, not a plaintext user_settings fallback.
- The misleading "never persisted server-side" comment is corrected to match reality.
- npm run typecheck passes with zero errors.
- npm run test passes (all existing and new tests).

## References

- src/renderer/src/features/settings/IntegrationsSettingsContent.tsx
- src/renderer/src/services/PersonalSyncService.ts
- supabase/migrations/20260722000000_hash_api_keys.sql
- AUDIT_CONTEXT.md
