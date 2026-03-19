import { useSetting } from '../stores/settingsStore'

export interface PrioritySettings {
  colorBar: boolean
  badges: boolean
  badgeIcons: boolean
  badgeLabels: boolean
  backgroundTint: boolean
  fontWeight: boolean
  autoSort: boolean
}

export function usePrioritySettings(): PrioritySettings {
  const colorBar = useSetting('priority_color_bar')
  const badgeIcons = useSetting('priority_badge_icons')
  const badgeLabels = useSetting('priority_badge_labels')
  const backgroundTint = useSetting('priority_background_tint')
  const fontWeight = useSetting('priority_font_weight')
  const autoSort = useSetting('priority_auto_sort')

  return {
    colorBar: colorBar === 'true',
    badges: badgeIcons === 'true' || badgeLabels === 'true',
    badgeIcons: badgeIcons === 'true',
    badgeLabels: badgeLabels === 'true',
    backgroundTint: backgroundTint === 'true',
    fontWeight: fontWeight === 'true',
    autoSort: autoSort === 'true'
  }
}
