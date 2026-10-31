import { useTaskStore } from './taskStore'
import { useStatusStore } from './statusStore'
import { useLabelStore } from './labelStore'
import { useViewStore } from './viewStore'
import { useAuthStore } from './authStore'

export function evictProjectData(projectId: string): void {
  const removedLabels = new Set(useLabelStore.getState().projectLabels[projectId] ?? [])
  const initial = useTaskStore.getState()
  for (const task of Object.values(initial.tasks)) if (task.project_id === projectId) {
    for (const label of initial.taskLabels[task.id] ?? []) removedLabels.add(label.id)
  }
  useTaskStore.setState(state => {
    const removed = new Set(Object.values(state.tasks).filter(task => task.project_id === projectId).map(task => task.id))
    const keep = (id: string | null): string | null => id && removed.has(id) ? null : id
    const selectedTaskIds = new Set([...state.selectedTaskIds].filter(id => !removed.has(id)))
    return {
      tasks: Object.fromEntries(Object.entries(state.tasks).filter(([id]) => !removed.has(id))),
      taskLabels: Object.fromEntries(Object.entries(state.taskLabels).filter(([id]) => !removed.has(id))),
      activityRefresh: Object.fromEntries(Object.entries(state.activityRefresh).filter(([id]) => !removed.has(id))),
      expandedTaskIds: new Set([...state.expandedTaskIds].filter(id => !removed.has(id))),
      selectedTaskIds,
      lastSelectedTaskId: keep(state.lastSelectedTaskId),
      showDetailPanel: state.showDetailPanel && (!state.lastSelectedTaskId || !removed.has(state.lastSelectedTaskId)),
      pendingSubtaskParentId: keep(state.pendingSubtaskParentId),
      pendingDeleteTaskId: keep(state.pendingDeleteTaskId),
      pendingBulkDeleteTaskIds: state.pendingBulkDeleteTaskIds?.filter(id => !removed.has(id)) ?? null,
      movingTaskId: keep(state.movingTaskId),
      pendingScrollTaskId: keep(state.pendingScrollTaskId),
      lastRecurringClone: state.lastRecurringClone?.projectId === projectId ? null : state.lastRecurringClone
    }
  })
  useStatusStore.setState(state => ({ statuses: Object.fromEntries(Object.entries(state.statuses).filter(([, status]) => status.project_id !== projectId)) }))
  useLabelStore.setState(state => {
    const projectLabels = Object.fromEntries(Object.entries(state.projectLabels).filter(([id]) => id !== projectId))
    const retained = new Set(Object.values(projectLabels).flatMap(ids => [...ids]))
    for (const labels of Object.values(useTaskStore.getState().taskLabels)) for (const label of labels) retained.add(label.id)
    const userId = useAuthStore.getState().currentUser?.id
    const labels = Object.fromEntries(Object.entries(state.labels).filter(([id, label]) =>
      !removedLabels.has(id) || !label.user_id || label.user_id === userId || retained.has(id)))
    return { projectLabels, labels }
  })
  if (useViewStore.getState().selectedProjectId === projectId) useViewStore.setState({ selectedProjectId: null, currentView: 'my-day' })
}
