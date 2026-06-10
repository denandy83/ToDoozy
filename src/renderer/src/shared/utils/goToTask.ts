import type { ViewId } from '../stores/viewStore'

/**
 * Whether the "Go to Task" context-menu action should be shown for the current view.
 *
 * It navigates to a task's home project, so it's only meaningful in cross-project
 * contexts (My Day, Saved Views) and requires the task to actually belong to a project.
 * It's redundant inside a project view (you're already there).
 */
export function shouldShowGoToTask(currentView: ViewId, projectId: string | null | undefined): boolean {
  if (!projectId) return false
  return currentView === 'my-day' || currentView === 'saved-view'
}
