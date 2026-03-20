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
  sidebar_order: number
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  role: string
  invited_by: string | null
  joined_at: string
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
  created_at: string
  updated_at: string
}

export interface Label {
  id: string
  project_id: string
  name: string
  color: string
  order_index: number
  created_at: string
  updated_at: string
}

export interface TaskLabel {
  task_id: string
  label_id: string
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
  created_at: string
  updated_at: string
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
}

export interface Setting {
  key: string
  value: string | null
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
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  color?: string
  icon?: string
  sidebar_order?: number
  is_default?: number
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
}

// Column whitelist for task updates (SQL injection prevention)
export const TASK_UPDATABLE_COLUMNS = [
  'title',
  'description',
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
  'recurrence_rule'
] as const

export type TaskUpdatableColumn = (typeof TASK_UPDATABLE_COLUMNS)[number]

export type UpdateTaskInput = Partial<Pick<Task, TaskUpdatableColumn>>

export interface CreateLabelInput {
  id: string
  project_id: string
  name: string
  color?: string
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
