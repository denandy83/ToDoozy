import type { Project } from '../../../../shared/types'

/** Number of projects shown in the sidebar before the "More" toggle is needed. */
export const MAX_VISIBLE_PROJECTS = 5

/**
 * Decides whether the sidebar project list should auto-expand to reveal the
 * currently-selected project.
 *
 * Returns true only when the user is viewing a project whose position in the
 * sidebar order is beyond the visible cutoff AND the list is currently collapsed.
 *
 * This is the *navigation* trigger only — it must never be re-evaluated in
 * response to the user manually toggling the list (clicking "Less"), otherwise
 * collapsing a list that contains the selected hidden project would immediately
 * re-expand it. The caller enforces that by reading the current expanded state
 * via a ref so the effect does not depend on it.
 */
export function shouldAutoExpandProjects(
  currentView: string,
  selectedProjectId: string | null,
  projects: Project[],
  alreadyExpanded: boolean,
  maxVisible: number = MAX_VISIBLE_PROJECTS
): boolean {
  if (currentView !== 'project' || !selectedProjectId) return false
  if (alreadyExpanded) return false
  const idx = projects.findIndex((p) => p.id === selectedProjectId)
  return idx >= maxVisible
}
