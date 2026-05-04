// Domain types shared across main, preload, and renderer processes.
// All primary keys are UUIDs (TEXT). All timestamps are ISO 8601 UTC strings.

export interface User {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  owner_id: string
  is_default: number
  is_shared: number
  sidebar_order: number
  area_id: string | null
  auto_archive_enabled: number
  auto_archive_value: number
  auto_archive_unit: string
  is_archived: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ProjectMember {
  project_id: string
  user_id: string
  role: string
  invited_by: string | null
  joined_at: string
  display_color: string | null
  display_initials: string | null
}

export interface Status {
  id: string
  project_id: string
  name: string
  color: string
  icon: string
  order_index: number
  is_done: number
  is_default: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Task {
  id: string
  project_id: string
  owner_id: string
  assigned_to: string | null
  title: string
  description: string | null
  status_id: string
  priority: number
  due_date: string | null
  parent_id: string | null
  order_index: number
  is_in_my_day: number
  is_template: number
  is_archived: number
  completed_date: string | null
  recurrence_rule: string | null
  reference_url: string | null
  my_day_dismissed_date: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Label {
  id: string
  user_id: string | null
  name: string
  color: string
  order_index: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ProjectLabel {
  project_id: string
  label_id: string
  created_at: string
  deleted_at: string | null
}

export interface TaskLabel {
  task_id: string
  label_id: string
  deleted_at: string | null
}

export interface TaskLabelMapping extends Label {
  task_id: string
}

export interface Theme {
  id: string
  name: string
  mode: string
  config: string // JSON string of ThemeConfig
  is_builtin: number
  owner_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ThemeConfig {
  bg: string
  fg: string
  fgSecondary: string
  fgMuted: string
  muted: string
  accent: string
  accentFg: string
  border: string
  sidebar: string
}

export interface Setting {
  user_id: string
  key: string
  value: string | null
  updated_at: string
  deleted_at: string | null
}

export interface ActivityLogEntry {
  id: string
  task_id: string
  user_id: string
  action: string
  old_value: string | null
  new_value: string | null
  created_at: string
}

// Input types for create/update operations

export interface CreateUserInput {
  id: string
  email: string
  display_name?: string | null
  avatar_url?: string | null
}

export interface UpdateUserInput {
  email?: string
  display_name?: string | null
  avatar_url?: string | null
}

export interface CreateProjectInput {
  id: string
  name: string
  owner_id: string
  description?: string | null
  color?: string
  icon?: string
  is_default?: number
  sidebar_order?: number
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  color?: string
  icon?: string
  sidebar_order?: number
  is_default?: number
  is_shared?: number
  auto_archive_enabled?: number
  auto_archive_value?: number
  auto_archive_unit?: string
  is_archived?: number
}

export interface CreateStatusInput {
  id: string
  project_id: string
  name: string
  color?: string
  icon?: string
  order_index?: number
  is_done?: number
  is_default?: number
}

export interface UpdateStatusInput {
  name?: string
  color?: string
  icon?: string
  order_index?: number
  is_done?: number
  is_default?: number
}

export interface CreateTaskInput {
  id: string
  project_id: string
  owner_id: string
  title: string
  status_id: string
  assigned_to?: string | null
  description?: string | null
  priority?: number
  due_date?: string | null
  parent_id?: string | null
  order_index?: number
  is_in_my_day?: number
  is_template?: number
  is_archived?: number
  completed_date?: string | null
  recurrence_rule?: string | null
  reference_url?: string | null
  my_day_dismissed_date?: string | null
}

// Column whitelist for task updates (SQL injection prevention)
export const TASK_UPDATABLE_COLUMNS = [
  'title',
  'description',
  'project_id',
  'status_id',
  'priority',
  'due_date',
  'assigned_to',
  'parent_id',
  'order_index',
  'is_in_my_day',
  'is_template',
  'is_archived',
  'completed_date',
  'recurrence_rule',
  'reference_url',
  'my_day_dismissed_date'
] as const

export type TaskUpdatableColumn = (typeof TASK_UPDATABLE_COLUMNS)[number]

export type UpdateTaskInput = Partial<Pick<Task, TaskUpdatableColumn>>

export interface CreateLabelInput {
  id: string
  user_id: string
  name: string
  color?: string
  project_id?: string // Optional: if provided, also links label to this project
}

export interface LabelUsageInfo extends Label {
  project_count: number
  task_count: number
}

export interface UpdateLabelInput {
  name?: string
  color?: string
}

export interface CreateThemeInput {
  id: string
  name: string
  mode: string
  config: string // JSON string
}

export interface UpdateThemeInput {
  name?: string
  mode?: string
  config?: string
}

export interface CreateActivityLogInput {
  id: string
  task_id: string
  user_id: string
  action: string
  old_value?: string | null
  new_value?: string | null
}

// ── Attachments ──────────────────────────────────────────────────────

export interface Attachment {
  id: string
  task_id: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
  updated_at: string
}

// ── Project Templates ─────────────────────────────────────────────────

export interface ProjectTemplate {
  id: string
  name: string
  color: string
  owner_id: string
  data: string // JSON string of ProjectTemplateData
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ProjectTemplateData {
  statuses: Array<{
    name: string
    color: string
    icon: string
    order_index: number
    is_done: number
    is_default: number
  }>
  labels: Array<{
    name: string
    color: string
    order_index: number
  }>
  tasks: ProjectTemplateTask[]
}

export interface ProjectTemplateTask {
  title: string
  description: string | null
  priority: number
  recurrence_rule: string | null
  due_date_offset: number | null
  order_index: number
  labels: string[] // label names for mapping
  subtasks: ProjectTemplateTask[]
}

export interface CreateProjectTemplateInput {
  id: string
  name: string
  color: string
  owner_id: string
  data: string
}

export interface UpdateProjectTemplateInput {
  name?: string
  color?: string
  data?: string
}

// ── Recurrence ──────────────────────────────────────────────────────

export interface RecurrenceConfig {
  interval: number // 1+
  unit: 'days' | 'weeks' | 'months' | 'years'
  weekDays?: string[] // for weeks: ['mon', 'wed', 'fri']
  monthDay?: number // for months: 1-31
  monthOrdinal?: { nth: '1st' | '2nd' | '3rd' | '4th' | 'last'; day: string } // for months: ordinal weekday
  yearMonth?: number // for years: 1-12
  yearDay?: number // for years: 1-31
  afterCompletion: boolean
  untilDate?: string // ISO date YYYY-MM-DD
}

// ── Collaboration ──────────────────────────────────────────────────

export type ProjectRole = 'owner' | 'member'
export type InviteStatus = 'pending' | 'accepted' | 'expired'
export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE'

export interface Notification {
  id: string
  type: string
  message: string
  task_id: string | null
  project_id: string | null
  from_user_id: string | null
  read: number
  created_at: string
}

export interface CreateNotificationInput {
  id: string
  type: string
  message: string
  task_id?: string | null
  project_id?: string | null
  from_user_id?: string | null
}

export interface SyncQueueEntry {
  id: string
  table_name: string
  row_id: string
  operation: SyncOperation
  payload: string // JSON
  created_at: string
}

export interface SharedProjectInvite {
  token: string
  project_id: string
  project_name: string
  owner_name: string
  created_by: string
  expires_at: string
  accepted_by: string | null
  status: InviteStatus
}

export interface SharedProjectMember {
  project_id: string
  user_id: string
  role: ProjectRole
  joined_at: string
  email: string
  display_name: string | null
}

// ── Project Areas ──────────────────────────────────────────────────

export interface ProjectArea {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  sidebar_order: number
  is_collapsed: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreateProjectAreaInput {
  id: string
  user_id: string
  name: string
  color?: string
  icon?: string
  sidebar_order?: number
}

export interface UpdateProjectAreaInput {
  name?: string
  color?: string
  icon?: string
  sidebar_order?: number
  is_collapsed?: number
}

// ── Saved Views ────────────────────────────────────────────────────

export interface SavedView {
  id: string
  user_id: string
  project_id: string | null
  name: string
  color: string
  icon: string
  sidebar_order: number
  filter_config: string // JSON serialized filter state
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreateSavedViewInput {
  id: string
  user_id: string
  project_id?: string | null
  name: string
  color?: string
  icon?: string
  sidebar_order?: number
  filter_config: string
}

export interface UpdateSavedViewInput {
  name?: string
  color?: string
  icon?: string
  sidebar_order?: number
  filter_config?: string
}
