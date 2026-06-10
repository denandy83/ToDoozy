/**
 * Clamp a raw auto-archive input value to the valid range [1, 999].
 *
 * The Settings → Projects → Archive numeric input is driven by transient local
 * state so the user can clear the field while typing. On commit (blur) the raw
 * string is run through this helper:
 *   - empty / non-numeric / below the minimum  → 1 (the minimum)
 *   - above the maximum                          → 999 (the maximum)
 *   - otherwise the parsed integer
 */
export function clampAutoArchiveValue(raw: string | number): number {
  const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10)
  if (isNaN(parsed) || parsed < 1) return 1
  return Math.min(parsed, 999)
}
