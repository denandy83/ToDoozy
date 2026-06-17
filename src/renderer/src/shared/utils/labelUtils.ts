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
 * Given the tasks currently visible in a view, return the deduplicated set of
 * labels actually present on those tasks — for inline "labels in view" filter
 * chips (My Day, Saved Views).
 *
 * Filtering happens against the RAW label set (not a pre-deduplicated one) so a
 * label whose canonical row was dropped during cross-project name-dedup is still
 * surfaced (see debug-learnings.md: foreign-user same-name label duplicates).
 * Dedup is applied last so the chip row never shows two same-name labels.
 */
export function getLabelsInUse(
  taskIds: string[],
  taskLabels: Record<string, Label[]>,
  allLabels: Label[],
  currentUserId: string
): Label[] {
  const usedIds = new Set<string>()
  for (const taskId of taskIds) {
    for (const label of taskLabels[taskId] ?? []) usedIds.add(label.id)
  }
  const used = allLabels.filter((l) => usedIds.has(l.id))
  return deduplicateLabelsByName(used, currentUserId)
}

/**
 * From a list of task ids, keep only those whose labels satisfy a saved
 * label-include filter, expressed as lowercased label NAME keys plus any/all
 * logic (matching how the filter store keys labels). Used to scope a saved
 * view's inline "labels in view" chip palette to the view's own tasks: a view
 * defined by "Label: bug" should offer the labels carried by its bug tasks, not
 * every label in the workspace. An empty key set is a no-op (returns all ids).
 */
export function filterTaskIdsByLabelKeys(
  taskIds: string[],
  taskLabels: Record<string, Label[]>,
  labelKeys: string[],
  logic: 'any' | 'all'
): string[] {
  if (labelKeys.length === 0) return taskIds
  return taskIds.filter((taskId) => {
    const names = new Set((taskLabels[taskId] ?? []).map((l) => l.name.toLowerCase()))
    return logic === 'all'
      ? labelKeys.every((k) => names.has(k))
      : labelKeys.some((k) => names.has(k))
  })
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
