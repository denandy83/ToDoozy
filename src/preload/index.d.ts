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
  UpdateProjectTemplateInput
} from '../shared/types'

export interface TasksAPI {
  findById(id: string): Promise<Task | null>
  findByProjectId(projectId: string): Promise<Task[]>
  findByStatusId(statusId: string): Promise<Task[]>
  findMyDay(userId: string): Promise<Task[]>
  findArchived(projectId: string): Promise<Task[]>
  findTemplates(projectId: string): Promise<Task[]>
  findSubtasks(parentId: string): Promise<Task[]>
  getSubtaskCount(parentId: string): Promise<{ total: number; done: number }>
  create(input: CreateTaskInput): Promise<Task>
  update(id: string, input: UpdateTaskInput): Promise<Task | null>
  delete(id: string): Promise<boolean>
  reorder(taskIds: string[]): Promise<void>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  getLabels(taskId: string): Promise<TaskLabel[]>
  duplicate(id: string, newId: string): Promise<Task | null>
  findAllTemplates(): Promise<Task[]>
  saveAsTemplate(id: string, newId: string): Promise<Task | null>
}

export interface LabelsAPI {
  findById(id: string): Promise<Label | null>
  findByProjectId(projectId: string): Promise<Label[]>
  create(input: CreateLabelInput): Promise<Label>
  update(id: string, input: UpdateLabelInput): Promise<Label | null>
  delete(id: string): Promise<boolean>
  findByTaskId(taskId: string): Promise<Label[]>
  findTaskLabelsByProject(projectId: string): Promise<TaskLabelMapping[]>
  reorder(labelIds: string[]): Promise<void>
}

export interface ProjectsAPI {
  findById(id: string): Promise<Project | null>
  findByOwnerId(ownerId: string): Promise<Project[]>
  findDefault(ownerId: string): Promise<Project | null>
  create(input: CreateProjectInput): Promise<Project>
  update(id: string, input: UpdateProjectInput): Promise<Project | null>
  delete(id: string): Promise<boolean>
  list(): Promise<Project[]>
  addMember(projectId: string, userId: string, role: string, invitedBy?: string): Promise<void>
  removeMember(projectId: string, userId: string): Promise<boolean>
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
  getRecent(limit: number): Promise<ActivityLogEntry[]>
}

export interface SettingsAPI {
  get(key: string): Promise<string | null>
  set(key: string, value: string | null): Promise<void>
  getAll(): Promise<Setting[]>
  getMultiple(keys: string[]): Promise<Setting[]>
  setMultiple(settings: Setting[]): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface ThemesAPI {
  findById(id: string): Promise<Theme | null>
  list(): Promise<Theme[]>
  listByMode(mode: string): Promise<Theme[]>
  create(input: CreateThemeInput): Promise<Theme>
  update(id: string, input: UpdateThemeInput): Promise<Theme | null>
  delete(id: string): Promise<boolean>
  getConfig(id: string): Promise<ThemeConfig | null>
}

export interface ProjectTemplatesAPI {
  findById(id: string): Promise<ProjectTemplate | null>
  findByOwnerId(ownerId: string): Promise<ProjectTemplate[]>
  findAll(): Promise<ProjectTemplate[]>
  create(input: CreateProjectTemplateInput): Promise<ProjectTemplate>
  update(id: string, input: UpdateProjectTemplateInput): Promise<ProjectTemplate | null>
  delete(id: string): Promise<boolean>
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
}

export interface ShortcutUpdateResult {
  success: boolean
  error?: string
  reservedBy?: string
}

export interface QuickAddAPI {
  hide(): Promise<void>
  notifyTaskCreated(): Promise<void>
  updateShortcut(accelerator: string): Promise<ShortcutUpdateResult>
  onFocus(callback: () => void): () => void
}

export interface TrayAPI {
  setUserId(userId: string): Promise<void>
  refresh(): Promise<void>
  onNavigateToTask(callback: (taskId: string) => void): () => void
  onNavigateToMyDay(callback: () => void): () => void
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
  auth: AuthAPI
  quickadd: QuickAddAPI
  tray: TrayAPI
  onTasksChanged(callback: () => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TodoozyAPI
  }
}
