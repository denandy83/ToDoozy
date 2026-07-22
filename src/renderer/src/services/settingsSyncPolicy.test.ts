import { describe, it, expect } from 'vitest'
import { isSettingSyncExcluded, SYNC_EXCLUDED_SETTING_KEYS } from './settingsSyncPolicy'

describe('settingsSyncPolicy', () => {
  it('excludes the bearer secret api_key from cloud sync', () => {
    expect(isSettingSyncExcluded('api_key')).toBe(true)
  })

  it('allows ordinary integration settings to sync', () => {
    for (const key of [
      'telegram_user_id',
      'telegram_allowed_ids',
      'telegram_default_project',
      'ios_shortcut_default_project',
      'theme_id',
      'last_sync_at'
    ]) {
      expect(isSettingSyncExcluded(key)).toBe(false)
    }
  })

  it('exposes api_key in the excluded set', () => {
    expect(SYNC_EXCLUDED_SETTING_KEYS.has('api_key')).toBe(true)
  })
})
