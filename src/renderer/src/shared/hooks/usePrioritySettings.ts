import { useSetting } from '../stores/settingsStore'

export interface PrioritySettings {
  colorBar: boolean
  badges: boolean
  backgroundTint: boolean
  fontWeight: boolean
  autoSort: boolean
}

export function usePrioritySettings(): PrioritySettings {
  const colorBar = useSetting('priority_color_bar')
  const badges = useSetting('priority_badges')
  const backgroundTint = useSetting('priority_background_tint')
  const fontWeight = useSetting('priority_font_weight')
  const autoSort = useSetting('priority_auto_sort')

  return {
    colorBar: colorBar === 'true',
    badges: badges === 'true',
    backgroundTint: backgroundTint === 'true',
    fontWeight: fontWeight === 'true',
    autoSort: autoSort === 'true'
  }
}
