import { useSettingsStore } from '../stores/settingsStore'

/**
 * Check if shift+delete is enabled and shift is held.
 * Returns true if the item should be deleted without confirmation.
 */
export function shouldForceDelete(e: React.MouseEvent | KeyboardEvent): boolean {
  if (!e.shiftKey) return false
  const enabled = useSettingsStore.getState().settings['shift_delete_enabled']
  return enabled === 'true'
}
