import { useSettingsStore, selectSetting } from '../stores/settingsStore'

export interface PrioritySettings {
  colorBar: boolean
  badges: boolean
  backgroundTint: boolean
  fontWeight: boolean
  autoSort: boolean
}

export function usePrioritySettings(): PrioritySettings {
  const colorBar = useSettingsStore(selectSetting('priority_color_bar'))
  const badges = useSettingsStore(selectSetting('priority_badges'))
  const backgroundTint = useSettingsStore(selectSetting('priority_background_tint'))
  const fontWeight = useSettingsStore(selectSetting('priority_font_weight'))
  const autoSort = useSettingsStore(selectSetting('priority_auto_sort'))

  return {
    colorBar: colorBar === 'true',
    badges: badges === 'true',
    backgroundTint: backgroundTint === 'true',
    fontWeight: fontWeight === 'true',
    autoSort: autoSort === 'true'
  }
}
