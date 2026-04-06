/** Shared task type matching Supabase shared_tasks schema */
export interface SharedTask {
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
  is_template: number
  is_archived: number
  completed_date: string | null
  recurrence_rule: string | null
  reference_url: string | null
  label_names: string | null // JSON array of label name strings
  created_at: string
  updated_at: string
}

export interface SharedProject {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface SharedStatus {
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

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

/** Priority levels matching ToDoozy convention */
export const PRIORITY_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Normal',
  3: 'High',
  4: 'Urgent'
}

export const PRIORITY_COLORS: Record<number, string> = {
  0: '#888888',
  1: '#4ade80',
  2: '#60a5fa',
  3: '#f59e0b',
  4: '#ef4444'
}
