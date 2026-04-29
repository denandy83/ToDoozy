import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskLabel,
  Label,
  TaskLabelMapping,
  CreateLabelInput,
  UpdateLabelInput,
  LabelUsageInfo,
  Project,
  ProjectMember,
  CreateProjectInput,
  UpdateProjectInput,
  Status,
  CreateStatusInput,
  UpdateStatusInput,
  User,
  CreateUserInput,
  UpdateUserInput,
  ActivityLogEntry,
  CreateActivityLogInput,
  Setting,
  Theme,
  ThemeConfig,
  CreateThemeInput,
  UpdateThemeInput,
  ProjectTemplate,
  CreateProjectTemplateInput,
  UpdateProjectTemplateInput,
  Attachment,
  Notification,
  CreateNotificationInput,
  SyncQueueEntry,
  SyncOperation,
  SavedView,
  CreateSavedViewInput,
  UpdateSavedViewInput,
  ProjectArea,
  CreateProjectAreaInput,
  UpdateProjectAreaInput
} from '../shared/types'

export interface TasksAPI {
  findById(id: string): Promise<Task | null>
  findByProjectId(projectId: string): Promise<Task[]>
  findByStatusId(statusId: string): Promise<Task[]>
  findMyDay(userId: string): Promise<Task[]>
  autoAddMyDay(userId: string, mode: string): Promise<string[]>
  findArchived(projectId: string): Promise<Task[]>
  findTemplates(projectId: string): Promise<Task[]>
  findSubtasks(parentId: string): Promise<Task[]>
  getSubtaskCount(parentId: string): Promise<{ total: number; done: number }>
  create(input: CreateTaskInput): Promise<Task>
  applyRemote(task: Task): Promise<Task>
  update(id: string, input: UpdateTaskInput): Promise<Task | null>
  delete(id: string): Promise<boolean>
  hardDelete(id: string): Promise<boolean>
  findAllByProject(
    projectId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<Task[]>
  findMaxUpdatedAt(projectId: string): Promise<string | null>
  reorder(taskIds: string[]): Promise<void>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  getLabels(taskId: string): Promise<TaskLabel[]>
  getTaskLabelsForUser(userId: string): Promise<TaskLabel[]>
  getTaskLabelsForSharedProjects(): Promise<TaskLabel[]>
  duplicate(id: string, newId: string): Promise<Task | null>
  findAllTemplates(userId: string): Promise<Task[]>
  saveAsTemplate(id: string, newId: string): Promise<Task | null>
  completeRecurring(taskId: string): Promise<{ id: string; dueDate: string } | null>
}

export interface LabelsAPI {
  findById(id: string): Promise<Label | null>
  findByIds(ids: string[]): Promise<Label[]>
  findAll(userId: string): Promise<Label[]>
  findByProjectId(projectId: string): Promise<Label[]>
  findByName(userId: string, name: string): Promise<Label | null>
  create(input: CreateLabelInput): Promise<Label>
  update(id: string, input: UpdateLabelInput): Promise<Label | null>
  delete(id: string): Promise<boolean>
  hardDelete(id: string): Promise<boolean>
  findAllByUser(
    userId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<Label[]>
  findMaxUpdatedAt(userId: string): Promise<string | null>
  applyRemote(label: Label): Promise<Label>
  consolidate(fromId: string, toId: string): Promise<{ taskRemaps: number; projectRemaps: number }>
  removeFromProject(projectId: string, labelId: string): Promise<boolean>
  addToProject(projectId: string, labelId: string): Promise<void>
  getProjectLabelsForOwner(userId: string): Promise<
    Array<{
      project_id: string
      label_id: string
      created_at: string
      deleted_at: string | null
    }>
  >
  getProjectLabelsForSharedProjects(): Promise<
    Array<{
      project_id: string
      label_id: string
      created_at: string
      deleted_at: string | null
    }>
  >
  applyRemoteProjectLabel(remote: {
    project_id: string
    label_id: string
    created_at: string | null
    deleted_at: string | null
  }): Promise<void>
  findByTaskId(taskId: string): Promise<Label[]>
  findTaskLabelsByProject(projectId: string): Promise<TaskLabelMapping[]>
  reorder(labelIds: string[]): Promise<void>
  findAllWithUsage(userId: string): Promise<LabelUsageInfo[]>
  findProjectsUsingLabel(userId: string, labelId: string): Promise<Array<{ project_id: string; project_name: string; task_count: number }>>
  findActiveLabelsForProject(projectId: string): Promise<Label[]>
}

export interface ProjectsAPI {
  findById(id: string): Promise<Project | null>
  findByOwnerId(ownerId: string): Promise<Project[]>
  findDefault(ownerId: string): Promise<Project | null>
  create(input: CreateProjectInput): Promise<Project>
  update(id: string, input: UpdateProjectInput): Promise<Project | null>
  delete(id: string): Promise<boolean>
  hardDelete(id: string): Promise<boolean>
  findAllByOwner(
    ownerId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<Project[]>
  findMaxUpdatedAt(ownerId: string): Promise<string | null>
  applyRemote(project: Project): Promise<Project>
  list(userId: string): Promise<Project[]>
  addMember(projectId: string, userId: string, role: string, invitedBy?: string): Promise<void>
  removeMember(projectId: string, userId: string): Promise<boolean>
  updateMember(projectId: string, userId: string, updates: { display_color?: string | null; display_initials?: string | null }): Promise<void>
  getMembers(projectId: string): Promise<ProjectMember[]>
  getProjectsForUser(userId: string): Promise<Project[]>
  updateSidebarOrder(updates: Array<{ id: string; sidebar_order: number }>): Promise<void>
}

export interface StatusesAPI {
  findById(id: string): Promise<Status | null>
  findByProjectId(projectId: string): Promise<Status[]>
  findDefault(projectId: string): Promise<Status | null>
  findDone(projectId: string): Promise<Status | null>
  create(input: CreateStatusInput): Promise<Status>
  update(id: string, input: UpdateStatusInput): Promise<Status | null>
  delete(id: string): Promise<boolean>
  hardDelete(id: string): Promise<boolean>
  findAllByProject(
    projectId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<Status[]>
  findMaxUpdatedAt(projectId: string): Promise<string | null>
  applyRemote(status: Status): Promise<Status>
  reassignAndDelete(statusId: string, targetStatusId: string): Promise<boolean>
}

export interface UsersAPI {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  create(input: CreateUserInput): Promise<User>
  update(id: string, input: UpdateUserInput): Promise<User | null>
  delete(id: string): Promise<boolean>
  list(): Promise<User[]>
}

export interface ActivityLogAPI {
  findById(id: string): Promise<ActivityLogEntry | null>
  findByTaskId(taskId: string): Promise<ActivityLogEntry[]>
  findByUserId(userId: string): Promise<ActivityLogEntry[]>
  create(input: CreateActivityLogInput): Promise<ActivityLogEntry>
  deleteByTaskId(taskId: string): Promise<number>
  getRecent(userId: string, limit: number): Promise<ActivityLogEntry[]>
}

export interface SettingsAPI {
  get(userId: string, key: string): Promise<string | null>
  set(userId: string, key: string, value: string | null): Promise<void>
  getAll(userId: string): Promise<Setting[]>
  getMultiple(userId: string, keys: string[]): Promise<Setting[]>
  setMultiple(userId: string, settings: Setting[]): Promise<void>
  delete(userId: string, key: string): Promise<boolean>
  hardDelete(userId: string, key: string): Promise<boolean>
  findAllByUser(
    userId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<Setting[]>
  findMaxUpdatedAt(userId: string): Promise<string | null>
  applyRemote(setting: Setting): Promise<Setting>
  findRaw(userId: string, key: string): Promise<Setting | null>
}

export interface ThemesAPI {
  findById(id: string): Promise<Theme | null>
  list(userId: string): Promise<Theme[]>
  listByMode(mode: string, userId: string): Promise<Theme[]>
  create(input: CreateThemeInput & { owner_id?: string }): Promise<Theme>
  update(id: string, input: UpdateThemeInput): Promise<Theme | null>
  delete(id: string): Promise<boolean>
  hardDelete(id: string): Promise<boolean>
  findAllByOwner(
    ownerId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<Theme[]>
  findMaxUpdatedAt(ownerId: string): Promise<string | null>
  applyRemote(theme: Theme): Promise<Theme>
  getConfig(id: string): Promise<ThemeConfig | null>
}

export interface ProjectTemplatesAPI {
  findById(id: string): Promise<ProjectTemplate | null>
  findByOwnerId(ownerId: string): Promise<ProjectTemplate[]>
  findAll(userId: string): Promise<ProjectTemplate[]>
  create(input: CreateProjectTemplateInput): Promise<ProjectTemplate>
  update(id: string, input: UpdateProjectTemplateInput): Promise<ProjectTemplate | null>
  delete(id: string): Promise<boolean>
  hardDelete(id: string): Promise<boolean>
  findAllByOwner(
    ownerId: string,
    options?: { includeTombstones?: boolean }
  ): Promise<ProjectTemplate[]>
  findMaxUpdatedAt(ownerId: string): Promise<string | null>
  applyRemote(template: ProjectTemplate): Promise<ProjectTemplate>
}

export interface AttachmentsAPI {
  findByTaskId(taskId: string): Promise<Attachment[]>
  createFromFile(taskId: string, filePath: string): Promise<Attachment>
  open(id: string): Promise<void>
  delete(id: string): Promise<boolean>
}

export interface FsOpenDialogOptions {
  filters?: Array<{ name: string; extensions: string[] }>
  title?: string
  multiSelections?: boolean
}

export interface FsAPI {
  showOpenDialog(options?: FsOpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>
  showSaveDialog(options: { defaultPath?: string; contents: string }): Promise<{ canceled: boolean; filePath?: string; error?: string }>
  readFile(filePath: string): Promise<{ ok: boolean; contents?: string; error?: string }>
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface AuthAPI {
  storeSession(sessionJson: string): Promise<void>
  getSession(): Promise<string | null>
  clearSession(): Promise<void>
  getSupabaseConfig(): Promise<SupabaseConfig>
  openOAuthWindow(url: string): Promise<string | null>
  switchDatabase(userId: string, email?: string): Promise<void>
}

export interface ShortcutUpdateResult {
  success: boolean
  error?: string
  reservedBy?: string
}

export interface QuickAddAPI {
  signalReady(): void
  hide(): Promise<void>
  notifyTaskCreated(): Promise<void>
  updateShortcut(accelerator: string): Promise<ShortcutUpdateResult>
  onFocus(callback: () => void): () => void
}

export interface AppToggleAPI {
  updateShortcut(accelerator: string): Promise<ShortcutUpdateResult>
}

export interface TimerTrayState {
  remainingSeconds: number
  isPaused: boolean
  phase: 'work' | 'break'
  currentRep: number
  totalReps: number
  isPerpetual: boolean
  taskTitle: string
  isFlowtime: boolean
  elapsedSeconds: number
  isLongBreak: boolean
  sessionsCompleted: number
  totalFocusSecondsToday: number
  isCookieBreakPhase: boolean
  cookiePoolSeconds: number
}

export interface TimerAPI {
  updateTimer(state: TimerTrayState): Promise<void>
  clearTimer(): Promise<void>
  minimizeToTray(): Promise<void>
  navigateToTask(taskId: string): Promise<void>
  onPause(callback: () => void): () => void
  onResume(callback: () => void): () => void
  onStop(callback: () => void): () => void
  onCookieBreak(callback: () => void): () => void
  onBackToWork(callback: () => void): () => void
}

export interface TrayAPI {
  setUserId(userId: string): Promise<void>
  refresh(): Promise<void>
  onNavigateToTask(callback: (taskId: string) => void): () => void
  onNavigateToMyDay(callback: () => void): () => void
}

export interface NotificationsAPI {
  onNavigateToTask(callback: (taskId: string, projectId: string) => void): () => void
  findAll(limit?: number): Promise<Notification[]>
  findUnread(): Promise<Notification[]>
  getUnreadCount(): Promise<number>
  create(input: CreateNotificationInput): Promise<Notification>
  markAsRead(id: string): Promise<boolean>
  markAllAsRead(): Promise<number>
  deleteNotification(id: string): Promise<boolean>
  deleteAll(): Promise<number>
}

export interface SyncAPI {
  getQueue(): Promise<SyncQueueEntry[]>
  enqueue(tableName: string, rowId: string, operation: SyncOperation, payload: string): Promise<SyncQueueEntry>
  dequeue(id: string): Promise<boolean>
  clear(): Promise<number>
  count(): Promise<number>
}

export type SyncTableName =
  | 'tasks'
  | 'statuses'
  | 'projects'
  | 'labels'
  | 'themes'
  | 'settings'
  | 'saved_views'
  | 'project_areas'
  | 'task_labels'
  | 'project_labels'
  | 'project_templates'

export interface SyncMetaAPI {
  getHighWater(
    userId: string,
    scopeId: string,
    tableName: SyncTableName
  ): Promise<string | null>
  setHighWater(
    userId: string,
    scopeId: string,
    tableName: SyncTableName,
    isoTs: string
  ): Promise<void>
  getLastReconciledAt(
    userId: string,
    scopeId: string,
    tableName: SyncTableName
  ): Promise<string | null>
  setLastReconciledAt(
    userId: string,
    scopeId: string,
    tableName: SyncTableName,
    isoTs: string
  ): Promise<void>
  clearAll(userId: string): Promise<number>
}

export interface ShellAPI {
  openExternal(url: string): Promise<void>
}

export interface AppAPI {
  getLoginItemSettings(): Promise<{ openAtLogin: boolean }>
  setLoginItemSettings(openAtLogin: boolean): Promise<void>
  getChangelog(): Promise<string>
  getDatabasePath(): Promise<string>
}

export interface ReleaseNotesSyncResult {
  ok: boolean
  count: number
  cached: number
  error?: string
}

export interface ReleaseNotesAPI {
  sync(): Promise<ReleaseNotesSyncResult>
  fetchVersion(version: string): Promise<string | null>
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface UpdaterAPI {
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  dismiss(version: string): Promise<void>
  getStatus(): Promise<UpdateStatus>
  getVersion(): Promise<string>
  onStatus(callback: (status: UpdateStatus) => void): () => void
}

export interface ProjectAreasAPI {
  findByUserId(userId: string): Promise<ProjectArea[]>
  create(input: CreateProjectAreaInput): Promise<ProjectArea>
  update(id: string, input: UpdateProjectAreaInput): Promise<ProjectArea | null>
  delete(id: string): Promise<boolean>
  reorder(areaIds: string[]): Promise<void>
  assignProject(projectId: string, areaId: string | null): Promise<void>
  hardDelete(id: string): Promise<boolean>
  findAllByUser(
    userId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<ProjectArea[]>
  findMaxUpdatedAt(userId: string): Promise<string | null>
  applyRemote(remote: ProjectArea): Promise<ProjectArea>
}

export interface StatsAPI {
  completions(userId: string, projectIds: string[] | null, startDate: string, endDate: string): Promise<Array<{ date: string; count: number }>>
  streaks(userId: string): Promise<{ current: number; best: number }>
  focus(userId: string, projectIds: string[] | null, startDate: string, endDate: string): Promise<Array<{ date: string; minutes: number }>>
  heatmap(userId: string, startDate: string, endDate: string): Promise<Array<{ date: string; count: number; created: number; completed: number; updated: number }>>
  summary(userId: string, projectIds: string[] | null): Promise<{ total: number; open: number; overdue: number; completed: number; avgCompletionDays: number }>
  priorityBreakdown(userId: string, projectIds: string[] | null): Promise<Array<{ priority: number; count: number }>>
  completionsByDayOfWeek(userId: string, projectIds: string[] | null, startDate: string, endDate: string): Promise<Array<{ dayOfWeek: number; count: number }>>
  projectBreakdown(userId: string): Promise<Array<{ projectId: string; projectName: string; open: number; completed: number }>>
  taskList(userId: string, filter: string, projectIds: string[] | null, startDate?: string, endDate?: string): Promise<Array<{ id: string; projectId: string; title: string; projectName: string; completedDate: string | null; dueDate: string | null; priority: number }>>
  focusTaskList(userId: string, startDate: string, endDate: string, projectIds: string[] | null): Promise<Array<{ id: string; projectId: string; title: string; projectName: string; completedDate: string | null; dueDate: string | null; priority: number; focusMinutes: number }>>
  cookieBalance(userId: string, startDate: string, endDate: string): Promise<{ earnedSeconds: number; spentSeconds: number }>
}

export interface SavedViewsAPI {
  findById(id: string): Promise<SavedView | null>
  findByUserId(userId: string): Promise<SavedView[]>
  create(input: CreateSavedViewInput): Promise<SavedView>
  update(id: string, input: UpdateSavedViewInput): Promise<SavedView | null>
  delete(id: string): Promise<boolean>
  reorder(viewIds: string[]): Promise<void>
  countMatching(filterConfig: string, userId: string): Promise<number>
  hardDelete(id: string): Promise<boolean>
  findAllByUser(
    userId: string,
    options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
  ): Promise<SavedView[]>
  findMaxUpdatedAt(userId: string): Promise<string | null>
  applyRemote(remote: SavedView): Promise<SavedView>
}

export interface TodoozyAPI {
  tasks: TasksAPI
  labels: LabelsAPI
  projects: ProjectsAPI
  statuses: StatusesAPI
  users: UsersAPI
  activityLog: ActivityLogAPI
  settings: SettingsAPI
  themes: ThemesAPI
  projectTemplates: ProjectTemplatesAPI
  attachments: AttachmentsAPI
  fs: FsAPI
  auth: AuthAPI
  quickadd: QuickAddAPI
  appToggle: AppToggleAPI
  tray: TrayAPI
  timer: TimerAPI
  notifications: NotificationsAPI
  sync: SyncAPI
  syncMeta: SyncMetaAPI
  shell: ShellAPI
  app: AppAPI
  projectAreas: ProjectAreasAPI
  stats: StatsAPI
  savedViews: SavedViewsAPI
  releaseNotes: ReleaseNotesAPI
  updater: UpdaterAPI
  onTasksChanged(callback: () => void): () => void
  onInviteReceived(callback: (token: string) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TodoozyAPI
  }
}
