import { describe, expect, it } from 'vitest'
import type { Theme } from '../../../../shared/types'
import { findThemeCounterpart, findThemeForMode, groupThemeChoices, hasThemeFamily } from './themeChoices'

function theme(id: string, overrides: Partial<Theme> = {}): Theme {
  return { id, name: 'Standard Dark', mode: 'dark', config: '{}', is_builtin: 0,
    owner_id: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null, ...overrides }
}

describe('theme choices with legacy same-name variants', () => {
  it('uses catalog names for builtins without introducing preset numbering', () => {
    expect(groupThemeChoices([
      theme('builtin-a', { is_builtin: 1, owner_id: null }),
      theme('builtin-b', { is_builtin: 1, owner_id: null })
    ])).toEqual([{ label: 'Built-in themes', options: [
      { id: 'builtin-a', label: 'Standard Dark' }, { id: 'builtin-b', label: 'Standard Dark' }
    ] }])
  })

  it('keeps every ID/config and gives built-in/custom variants distinct, stable labels', () => {
    const builtin = theme('builtin', { is_builtin: 1, owner_id: null })
    const a = theme('custom-a', { config: '{"bg":"#000000"}' })
    const b = theme('custom-b', { config: '{"bg":"#eeeeee"}' })
    const input = [b, builtin, a]
    const before = JSON.stringify(input)
    const groups = groupThemeChoices(input)
    expect(groups).toEqual([
      { label: 'Built-in themes', options: [{ id: 'builtin', label: 'Standard Dark' }] },
      { label: 'My themes', options: [
        { id: 'custom-a', label: 'Standard Dark (Custom 1)' },
        { id: 'custom-b', label: 'Standard Dark (Custom 2)' }
      ] }
    ])
    expect(groupThemeChoices([a, b, builtin])).toEqual(groups)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('separates unique custom themes and excludes tombstones', () => {
    expect(groupThemeChoices([theme('custom'), theme('deleted', { deleted_at: '2026-01-02' })])).toEqual([
      { label: 'My themes', options: [{ id: 'custom', label: 'Standard Dark (Custom)' }] }
    ])
  })

  it('pairs built-ins only with built-ins, regardless of same-named custom variants', () => {
    const dark = theme('builtin-dark', { is_builtin: 1, owner_id: null })
    const light = theme('builtin-light', { name: 'Standard Light', mode: 'light', is_builtin: 1, owner_id: null })
    const custom = theme('custom-light', { name: 'Standard Light', mode: 'light' })
    expect(findThemeCounterpart(dark, [custom, light, dark])).toBe(light)
    expect(findThemeCounterpart(custom, [dark, light, custom])).toBeUndefined()
  })

  it('pairs a unique custom family but refuses ambiguous pairings in either direction', () => {
    const dark = theme('dark')
    const light = theme('light', { name: 'Standard Light', mode: 'light' })
    const secondDark = theme('dark-2')
    const secondLight = theme('light-2', { name: 'Standard Light', mode: 'light' })
    expect(findThemeCounterpart(dark, [dark, light])).toBe(light)
    expect(findThemeCounterpart(dark, [dark, light, secondLight])).toBeUndefined()
    expect(findThemeCounterpart(dark, [dark, secondDark, light])).toBeUndefined()
    expect(findThemeCounterpart(light, [dark, secondDark, light])).toBeUndefined()
  })

  it('excludes other owners and deleted counterparts', () => {
    const dark = theme('dark')
    const other = theme('other', { name: 'Standard Light', mode: 'light', owner_id: 'user-2' })
    const deleted = theme('deleted', { name: 'Standard Light', mode: 'light', deleted_at: '2026-01-02' })
    expect(findThemeCounterpart(dark, [dark, other, deleted])).toBeUndefined()
  })

  it('mode switching uses an unambiguous custom pair or the family preset instead of another variant', () => {
    const dark = theme('dark')
    const secondDark = theme('dark-2')
    const light = theme('light', { name: 'Standard Light', mode: 'light' })
    const preset = theme('preset', { name: 'Standard Light', mode: 'light', is_builtin: 1, owner_id: null })
    expect(findThemeForMode(dark, [dark, secondDark, light, preset], 'dark')).toBe(dark)
    expect(findThemeForMode(dark, [dark, light, preset], 'light')).toBe(light)
    expect(findThemeForMode(dark, [light, secondDark, dark, preset], 'light')).toBe(preset)
    expect(findThemeForMode(dark, [dark, secondDark, light], 'light')).toBeUndefined()
  })

  it('reserves existing family names across case and mode, while allowing new names', () => {
    const themes = [theme('a'), theme('b', { name: 'Forest Light', mode: 'light' })]
    expect(hasThemeFamily(' standard ', themes)).toBe(true)
    expect(hasThemeFamily('forest', themes)).toBe(true)
    expect(hasThemeFamily('My Lavender', themes)).toBe(false)
    expect(hasThemeFamily('Standard', [theme('deleted', { deleted_at: '2026-01-02' })])).toBe(false)
  })
})
