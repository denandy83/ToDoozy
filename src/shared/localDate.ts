/** A local calendar date, distinct from the UTC date of an instant. */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

/** Civil YYYY-MM-DD values stay civil; timestamp instants use the local day. */
export function calendarDateKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateKey(new Date(value))
}

/** UTC instant boundaries spanning complete local calendar days (DST aware). */
export function localDayBounds(start: Date, end: Date = start): { start: string; end: string } {
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
  return { start: first.toISOString(), end: new Date(last.getTime() - 1).toISOString() }
}
