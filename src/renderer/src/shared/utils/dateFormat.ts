import { useSettingsStore } from '../stores/settingsStore'

export type DateFormatType = 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'yyyy/mm/dd'

/**
 * Format an ISO date string (YYYY-MM-DD) according to the user's date format setting.
 */
export function formatDate(isoDate: string, format?: DateFormatType, options?: { omitCurrentYear?: boolean }): string {
  const fmt = format ?? (useSettingsStore.getState().settings['date_format'] as DateFormatType | null) ?? 'dd/mm/yyyy'
  const parts = isoDate.split('T')[0].split('-')
  if (parts.length < 3) return isoDate
  const [y, m, d] = parts

  const showYear = !(options?.omitCurrentYear && y === String(new Date().getFullYear()))

  switch (fmt) {
    case 'dd/mm/yyyy':
      return showYear ? `${d}/${m}/${y}` : `${d}/${m}`
    case 'mm/dd/yyyy':
      return showYear ? `${m}/${d}/${y}` : `${m}/${d}`
    case 'yyyy/mm/dd':
      return showYear ? `${y}/${m}/${d}` : `${m}/${d}`
    default:
      return showYear ? `${d}/${m}/${y}` : `${d}/${m}`
  }
}

/**
 * React hook to get the current date format setting.
 */
export function useDateFormat(): DateFormatType {
  const fmt = useSettingsStore((s) => s.settings['date_format'])
  return (fmt as DateFormatType) ?? 'dd/mm/yyyy'
}
