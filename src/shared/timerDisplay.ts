export function formatTimerSeconds(seconds: number, signed = false): string {
  const whole = Number.isFinite(seconds) ? Math.floor(signed ? seconds : Math.max(0, seconds)) : 0
  const absolute = Math.abs(whole)
  return `${signed && whole < 0 ? '-' : ''}${Math.floor(absolute / 60)}:${(absolute % 60).toString().padStart(2, '0')}`
}
