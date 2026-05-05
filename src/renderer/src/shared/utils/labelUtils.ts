import type { Label } from '../../../../shared/types'

export function deduplicateLabelsByName(labels: Label[], currentUserId: string): Label[] {
  const seen = new Map<string, Label>()
  for (const label of labels) {
    if (label.user_id === currentUserId) seen.set(label.name.toLowerCase(), label)
  }
  for (const label of labels) {
    const key = label.name.toLowerCase()
    if (!seen.has(key)) seen.set(key, label)
  }
  return Array.from(seen.values()).sort((a, b) => a.order_index - b.order_index)
}

/**
 * Remap each label in `labels` to the viewer's own same-name label when one
 * exists, then deduplicate. Used for task chips: if User A tagged a task
 * with their red "testlabel" and User B (the viewer) has a yellow "testLABEL"
 * of their own, the chip on User B's screen should render as User B's yellow
 * version — same name, their styling. When the viewer doesn't have a
 * same-name label, the original (other user's) label is preserved so the
 * chip still surfaces.
 */
export function remapLabelsToCurrentUser(
  labels: Label[],
  allLabels: Record<string, Label>,
  currentUserId: string
): Label[] {
  if (labels.length === 0) return labels
  if (!currentUserId) return deduplicateLabelsByName(labels, '')
  const mineByName = new Map<string, Label>()
  for (const l of Object.values(allLabels)) {
    if (l.user_id === currentUserId) mineByName.set(l.name.toLowerCase(), l)
  }
  const remapped = labels.map(
    (l) => mineByName.get(l.name.toLowerCase()) ?? l
  )
  return deduplicateLabelsByName(remapped, currentUserId)
}
