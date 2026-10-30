import { localDateKey } from '../../../../shared/localDate'
/** Add local calendar days, preserving an existing timestamp's time portion. */
export function addDaysPreservingTime(baseDueDate: string | null | undefined, days: number): string {
  const target = new Date()
  target.setDate(target.getDate() + days)
  if (baseDueDate && baseDueDate.includes('T')) {
    const parsed = new Date(baseDueDate)
    target.setHours(parsed.getHours(), parsed.getMinutes(), parsed.getSeconds(), parsed.getMilliseconds())
    return target.toISOString()
  }
  return localDateKey(target)
}

/** Snooze to 3 hours from now */
export function getLaterToday(): string {
  const d = new Date()
  d.setHours(d.getHours() + 3)
  return d.toISOString()
}

/** Build snooze presets for a given due date */
export function getSnoozePresets(currentDueDate: string | null | undefined): Array<{ label: string; getDate: () => string }> {
  return [
    { label: 'Later Today', getDate: getLaterToday },
    { label: 'Tomorrow', getDate: () => addDaysPreservingTime(currentDueDate, 1) },
    { label: 'In 3 Days', getDate: () => addDaysPreservingTime(currentDueDate, 3) },
    { label: 'Next Week', getDate: () => addDaysPreservingTime(currentDueDate, 7) }
  ]
}
