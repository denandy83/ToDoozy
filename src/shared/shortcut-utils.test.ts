import { describe, it, expect } from 'vitest'
import {
  getReservedShortcutName,
  keyEventToAccelerator,
  DEFAULT_QUICK_ADD_SHORTCUT
} from './shortcut-utils'

describe('getReservedShortcutName', () => {
  it('returns feature name for Spotlight', () => {
    expect(getReservedShortcutName('CommandOrControl+Space')).toBe('Spotlight')
    expect(getReservedShortcutName('Command+Space')).toBe('Spotlight')
  })

  it('returns feature name for Screenshot shortcuts', () => {
    expect(getReservedShortcutName('Command+Shift+3')).toBe('Screenshot (Full Screen)')
    expect(getReservedShortcutName('Command+Shift+4')).toBe('Screenshot (Selection)')
    expect(getReservedShortcutName('CommandOrControl+Shift+5')).toBe('Screenshot (Options)')
  })

  it('returns feature name for App Switcher', () => {
    expect(getReservedShortcutName('Command+Tab')).toBe('App Switcher')
  })

  it('returns feature name for Force Quit', () => {
    expect(getReservedShortcutName('Command+Option+Escape')).toBe('Force Quit')
    expect(getReservedShortcutName('CommandOrControl+Alt+Escape')).toBe('Force Quit')
  })

  it('returns null for non-reserved shortcuts', () => {
    expect(getReservedShortcutName('CommandOrControl+Shift+Space')).toBeNull()
    expect(getReservedShortcutName('CommandOrControl+K')).toBeNull()
    expect(getReservedShortcutName('Alt+Shift+A')).toBeNull()
  })
})

describe('keyEventToAccelerator', () => {
  function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      key: '',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...overrides
    } as KeyboardEvent
  }

  it('converts Cmd+Shift+Space', () => {
    const result = keyEventToAccelerator(
      makeEvent({ metaKey: true, shiftKey: true, key: ' ' })
    )
    expect(result).toBe('CommandOrControl+Shift+Space')
  })

  it('converts Cmd+K', () => {
    const result = keyEventToAccelerator(
      makeEvent({ metaKey: true, key: 'k' })
    )
    expect(result).toBe('CommandOrControl+K')
  })

  it('converts Ctrl+Alt+N', () => {
    const result = keyEventToAccelerator(
      makeEvent({ ctrlKey: true, altKey: true, key: 'n' })
    )
    expect(result).toBe('CommandOrControl+Alt+N')
  })

  it('handles arrow keys', () => {
    const result = keyEventToAccelerator(
      makeEvent({ metaKey: true, key: 'ArrowUp' })
    )
    expect(result).toBe('CommandOrControl+Up')
  })

  it('returns null for modifier-only presses', () => {
    expect(keyEventToAccelerator(makeEvent({ metaKey: true, key: 'Meta' }))).toBeNull()
    expect(keyEventToAccelerator(makeEvent({ shiftKey: true, key: 'Shift' }))).toBeNull()
  })

  it('returns null for keys without modifiers', () => {
    expect(keyEventToAccelerator(makeEvent({ key: 'a' }))).toBeNull()
    expect(keyEventToAccelerator(makeEvent({ key: ' ' }))).toBeNull()
  })

  it('handles Escape key with modifier', () => {
    const result = keyEventToAccelerator(
      makeEvent({ metaKey: true, altKey: true, key: 'Escape' })
    )
    expect(result).toBe('CommandOrControl+Alt+Escape')
  })
})

describe('DEFAULT_QUICK_ADD_SHORTCUT', () => {
  it('is CommandOrControl+Shift+Space', () => {
    expect(DEFAULT_QUICK_ADD_SHORTCUT).toBe('CommandOrControl+Shift+Space')
  })

  it('is not a reserved shortcut', () => {
    expect(getReservedShortcutName(DEFAULT_QUICK_ADD_SHORTCUT)).toBeNull()
  })
})
