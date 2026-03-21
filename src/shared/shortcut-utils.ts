// Known macOS reserved shortcuts that cannot be overridden by the app.
// Keys are Electron accelerator strings; values are the macOS feature name.
export const RESERVED_MACOS_SHORTCUTS: Record<string, string> = {
  // macOS system shortcuts
  'CommandOrControl+Space': 'Spotlight',
  'Command+Space': 'Spotlight',
  'CommandOrControl+Shift+3': 'Screenshot (Full Screen)',
  'Command+Shift+3': 'Screenshot (Full Screen)',
  'CommandOrControl+Shift+4': 'Screenshot (Selection)',
  'Command+Shift+4': 'Screenshot (Selection)',
  'CommandOrControl+Shift+5': 'Screenshot (Options)',
  'Command+Shift+5': 'Screenshot (Options)',
  'Command+Tab': 'App Switcher',
  'CommandOrControl+Tab': 'App Switcher',
  'Command+Option+Escape': 'Force Quit',
  'CommandOrControl+Alt+Escape': 'Force Quit',
  // Essential app/system shortcuts
  'CommandOrControl+C': 'Copy',
  'CommandOrControl+V': 'Paste',
  'CommandOrControl+X': 'Cut',
  'CommandOrControl+Z': 'Undo',
  'CommandOrControl+Shift+Z': 'Redo',
  'CommandOrControl+A': 'Select All',
  'CommandOrControl+Q': 'Quit',
  'CommandOrControl+W': 'Close Window',
  'CommandOrControl+H': 'Hide App',
  'CommandOrControl+M': 'Minimize',
  'CommandOrControl+N': 'New Window',
  'CommandOrControl+K': 'Command Palette',
  'CommandOrControl+L': 'Toggle Layout',
  'CommandOrControl+1': 'My Day',
  'CommandOrControl+2': 'Projects',
  'CommandOrControl+3': 'Archive',
  'CommandOrControl+4': 'Templates'
}

/**
 * Check if an accelerator string matches a reserved macOS shortcut.
 * Returns the feature name if reserved, null otherwise.
 */
export function getReservedShortcutName(accelerator: string): string | null {
  return RESERVED_MACOS_SHORTCUTS[accelerator] ?? null
}

export const DEFAULT_QUICK_ADD_SHORTCUT = 'CommandOrControl+Shift+Space'
export const DEFAULT_APP_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+B'

/**
 * Convert a KeyboardEvent into an Electron accelerator string.
 * Example output: "CommandOrControl+Shift+Space"
 */
export function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []

  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  // Ignore modifier-only presses
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null

  // Map special keys to Electron names
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab'
  }

  const mappedKey = keyMap[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  parts.push(mappedKey)

  // Must have at least one modifier
  if (parts.length < 2) return null

  return parts.join('+')
}
