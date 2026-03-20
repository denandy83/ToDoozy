export { useTaskStore } from './taskStore'
export type { TaskStore } from './taskStore'
export {
  selectTasksByProject,
  selectTasksByStatus,
  selectMyDayTasks,
  selectArchivedTasks,
  selectSubtasks,
  selectTopLevelTasks,
  selectExpandedTaskIds,
  selectIsExpanded,
  selectChildCount,
  selectHasChildren,
  selectCurrentTaskId,
  selectCurrentTask,
  selectSelectedTaskIds,
  selectTaskLabels,
  useTasksByProject,
  useSubtasks,
  useChildCount,
  useTaskLabelsHook
} from './taskStore'

export { useViewStore } from './viewStore'
export type { ViewStore, ViewId, DetailPanelPosition } from './viewStore'
export {
  selectCurrentView,
  selectSidebarPinned,
  selectSidebarExpanded,
  selectSidebarWidth,
  selectDetailPanelPosition,
  selectDetailPanelSize
} from './viewStore'

export { useLabelStore } from './labelStore'
export type { LabelStore, LabelFilterMode } from './labelStore'
export {
  selectLabelsByProject,
  selectLabelById,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode,
  useLabelsByProject
} from './labelStore'

export { useStatusStore } from './statusStore'
export type { StatusStore } from './statusStore'
export {
  useStatusesByProject,
  useDefaultStatus,
  useDoneStatus,
  useStatusById,
  selectStatusesByProject,
  selectDefaultStatus,
  selectDoneStatus,
  selectStatusById
} from './statusStore'

export { useProjectStore } from './projectStore'
export type { ProjectStore } from './projectStore'
export {
  selectAllProjects,
  selectCurrentProject,
  selectDefaultProject,
  selectProjectMembers
} from './projectStore'

export { useSettingsStore } from './settingsStore'
export type { SettingsStore } from './settingsStore'
export { selectThemesByMode, selectCurrentTheme, selectSetting, useThemesByMode, useSetting } from './settingsStore'

export { useAuthStore } from './authStore'
export type { AuthStore } from './authStore'
export { selectCurrentUser, selectIsAuthenticated, selectUserId } from './authStore'

export { useContextMenuStore } from './contextMenuStore'
export type { ContextMenuStore } from './contextMenuStore'
