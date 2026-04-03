#!/usr/bin/env node
// ToDoozy MCP Server — Model Context Protocol server for AI integration
// Standalone Node.js script, communicates via stdio, accesses the same SQLite database

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createRepositories } from './repositories'
import type { ProjectTemplateData, ProjectTemplateTask } from '../shared/types'

// ── Database Setup ──────────────────────────────────────────────────

function getDbPath(): string {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'todoozy', 'todoozy.db')
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'todoozy',
      'todoozy.db'
    )
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(home, '.config'),
    'todoozy',
    'todoozy.db'
  )
}

const dbPath = process.env.TODOOZY_DEV_DB || getDbPath()
if (!existsSync(dbPath)) {
  process.stderr.write(
    `ToDoozy database not found at ${dbPath}. Launch the ToDoozy app first to initialize it.\n`
  )
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

const repos = createRepositories(db)

// ── Supabase Client (for release notes) ─────────────────────────────

function loadEnvFile(): Record<string, string> {
  const envVars: Record<string, string> = {}
  // Try loading .env from project root (dev) or app directory
  const candidates = [
    join(process.cwd(), '.env'),
    join(__dirname, '../../.env'),
    join(__dirname, '../../../.env')
  ]
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf8')
      for (const line of content.split('\n')) {
        const match = line.match(/^([A-Z_]+)=(.+)$/)
        if (match) envVars[match[1]] = match[2].trim()
      }
      break
    }
  }
  return envVars
}

let supabaseClient: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (url && key) {
    supabaseClient = createClient(url, key)
    return supabaseClient
  }
  // Try loading from .env file
  const env = loadEnvFile()
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
    return supabaseClient
  }
  return null
}

// ── Helpers ─────────────────────────────────────────────────────────

function getUser(): { id: string } {
  const users = repos.users.list()
  if (users.length === 0) throw new Error('No user found. Launch ToDoozy and sign in first.')
  return users[0]
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  [key: string]: unknown
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function fail(msg: string): ToolResult {
  return { content: [{ type: 'text' as const, text: msg }], isError: true }
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const val = args[key]
  if (val === undefined || val === null || val === '')
    throw new Error(`Missing required argument: ${key}`)
  return String(val)
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key]
  return val !== undefined && val !== null ? String(val) : undefined
}

function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const val = args[key]
  return val !== undefined && val !== null ? Number(val) : undefined
}

function readPackageVersion(): string {
  const candidates = [
    join(process.cwd(), 'package.json'),
    join(__dirname, '../../package.json'),
    join(__dirname, '../../../package.json')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8'))
        return `v${pkg.version}`
      } catch { /* ignore */ }
    }
  }
  return 'v0.0.0'
}

// ── Schema Helpers ──────────────────────────────────────────────────

interface SchemaProp {
  type: string
  description: string
  enum?: (string | number)[]
  items?: { type: string }
}

function str(description: string): SchemaProp {
  return { type: 'string', description }
}

function num(description: string): SchemaProp {
  return { type: 'number', description }
}

interface InputSchema {
  type: 'object'
  properties: Record<string, SchemaProp>
  required?: string[]
}

interface ToolDef {
  name: string
  description: string
  inputSchema: InputSchema
}

// ── Tool Definitions ────────────────────────────────────────────────

const tools: ToolDef[] = [
  // Tasks — CRUD
  {
    name: 'create_task',
    description: 'Create a new task in a project',
    inputSchema: {
      type: 'object',
      properties: {
        title: str('Task title'),
        project_id: str('Project ID'),
        description: str('Task description (markdown)'),
        priority: num('Priority: 0=none, 1=low, 2=normal, 3=high, 4=urgent'),
        due_date: str('Due date in ISO 8601 format'),
        parent_id: str('Parent task ID (creates a subtask)')
      },
      required: ['title', 'project_id']
    }
  },
  {
    name: 'list_tasks',
    description: 'List all active tasks in a project (excludes archived and template tasks)',
    inputSchema: {
      type: 'object',
      properties: { project_id: str('Project ID') },
      required: ['project_id']
    }
  },
  {
    name: 'get_task',
    description: 'Get a task by ID, including its labels',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },
  {
    name: 'update_task',
    description: 'Update task fields (title, description, priority, due_date, status_id)',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        title: str('New title'),
        description: str('New description (markdown)'),
        priority: num('Priority: 0=none, 1=low, 2=normal, 3=high, 4=urgent'),
        due_date: str('Due date in ISO 8601 format, or empty string to clear'),
        status_id: str('New status ID')
      },
      required: ['task_id']
    }
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task and its subtasks',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },

  // Tasks — Status changes
  {
    name: 'complete_task',
    description: 'Mark a task as done (sets status to the done status of its project)',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },
  {
    name: 'reopen_task',
    description: 'Reopen a completed task (sets status back to the default status)',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },

  // Tasks — Field setters
  {
    name: 'set_task_priority',
    description: 'Set the priority of a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        priority: num('Priority: 0=none, 1=low, 2=normal, 3=high, 4=urgent')
      },
      required: ['task_id', 'priority']
    }
  },
  {
    name: 'set_task_due_date',
    description: 'Set or clear the due date of a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        due_date: str('Due date in ISO 8601 format, or empty string to clear')
      },
      required: ['task_id', 'due_date']
    }
  },
  {
    name: 'set_task_description',
    description: 'Set the description of a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        description: str('Description text (markdown)')
      },
      required: ['task_id', 'description']
    }
  },
  {
    name: 'set_task_recurrence',
    description: 'Set or clear the recurrence rule of a task. Uses canonical format: "every:N:unit[:details][|until:YYYY-MM-DD]". Examples: "every:1:days", "every:2:weeks:mon,wed", "every:1:months:15", "every:1:months:3rd:tue", "every:1:years:3:30". Use "every!" prefix for after-completion mode: "every!:3:days". Empty string to clear.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        recurrence_rule: str(
          'Canonical recurrence rule (e.g. "every:1:days", "every:2:weeks:mon,wed", "every!:1:months:15|until:2026-12-31"), or empty string to clear'
        )
      },
      required: ['task_id', 'recurrence_rule']
    }
  },

  // Tasks — My Day
  {
    name: 'add_task_to_my_day',
    description: 'Add a task to the My Day view',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },
  {
    name: 'remove_task_from_my_day',
    description: 'Remove a task from the My Day view',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },

  // Tasks — Other actions
  {
    name: 'snooze_task',
    description: 'Snooze a task until a given date (sets due date, removes from My Day)',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        snooze_until: str('Date to snooze until in ISO 8601 format')
      },
      required: ['task_id', 'snooze_until']
    }
  },
  {
    name: 'archive_task',
    description: 'Archive a task (hides from active views)',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },
  {
    name: 'unarchive_task',
    description: 'Unarchive a task (restores to active views)',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },
  {
    name: 'duplicate_task',
    description: 'Duplicate a task including its labels and subtasks',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },
  {
    name: 'save_task_as_template',
    description: 'Save a task as a reusable template (strips dates, resets statuses)',
    inputSchema: {
      type: 'object',
      properties: { task_id: str('Task ID') },
      required: ['task_id']
    }
  },

  // Subtasks
  {
    name: 'create_subtask',
    description: 'Create a subtask under a parent task',
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: str('Parent task ID'),
        title: str('Subtask title')
      },
      required: ['parent_id', 'title']
    }
  },
  {
    name: 'list_subtasks',
    description: 'List subtasks of a task',
    inputSchema: {
      type: 'object',
      properties: { parent_id: str('Parent task ID') },
      required: ['parent_id']
    }
  },

  // Projects
  {
    name: 'list_projects',
    description: 'List all projects',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_project',
    description: 'Get a project by ID, including its statuses and labels',
    inputSchema: {
      type: 'object',
      properties: { project_id: str('Project ID') },
      required: ['project_id']
    }
  },
  {
    name: 'create_project',
    description: 'Create a new project',
    inputSchema: {
      type: 'object',
      properties: {
        name: str('Project name'),
        color: str('Project color (hex, e.g. "#6366f1")'),
        description: str('Project description')
      },
      required: ['name']
    }
  },
  {
    name: 'update_project',
    description: 'Update a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: str('Project ID'),
        name: str('New name'),
        color: str('New color (hex)'),
        description: str('New description')
      },
      required: ['project_id']
    }
  },
  {
    name: 'delete_project',
    description: 'Delete a project and all its tasks',
    inputSchema: {
      type: 'object',
      properties: { project_id: str('Project ID') },
      required: ['project_id']
    }
  },

  // Labels
  {
    name: 'list_labels',
    description: 'List all labels for a project',
    inputSchema: {
      type: 'object',
      properties: { project_id: str('Project ID') },
      required: ['project_id']
    }
  },
  {
    name: 'create_label',
    description: 'Create a new label in a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: str('Project ID'),
        name: str('Label name'),
        color: str('Label color (hex, e.g. "#22c55e")')
      },
      required: ['project_id', 'name']
    }
  },
  {
    name: 'assign_label_to_task',
    description: 'Assign a label to a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        label_id: str('Label ID')
      },
      required: ['task_id', 'label_id']
    }
  },
  {
    name: 'remove_label_from_task',
    description: 'Remove a label from a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: str('Task ID'),
        label_id: str('Label ID')
      },
      required: ['task_id', 'label_id']
    }
  },

  // Statuses
  {
    name: 'list_statuses',
    description: 'List all statuses for a project',
    inputSchema: {
      type: 'object',
      properties: { project_id: str('Project ID') },
      required: ['project_id']
    }
  },

  // Search
  {
    name: 'search_tasks',
    description: 'Search tasks with filters. All filters are optional and combined with AND.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: str('Filter by project ID'),
        status_id: str('Filter by status ID'),
        priority: num('Filter by exact priority (0-4)'),
        label_id: str('Filter by label ID'),
        due_before: str('Tasks due before this date (ISO 8601)'),
        due_after: str('Tasks due after this date (ISO 8601)'),
        keyword: str('Search keyword (matches title and description)')
      }
    }
  },

  // My Day
  {
    name: 'list_my_day',
    description: 'List tasks in the My Day view (tasks marked for today or due today)',
    inputSchema: { type: 'object', properties: {} }
  },

  // Templates
  {
    name: 'list_templates',
    description: 'List all task templates and project templates',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'use_task_template',
    description:
      'Create a new task from a task template in a target project. Labels are auto-created if missing.',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: str('Task template ID'),
        project_id: str('Target project ID to create the task in')
      },
      required: ['template_id', 'project_id']
    }
  },
  {
    name: 'deploy_project_template',
    description:
      'Create a new project from a project template, including all statuses, labels, and tasks',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: str('Project template ID'),
        name: str('Override project name (defaults to template name)'),
        color: str('Override project color (defaults to template color)')
      },
      required: ['template_id']
    }
  },

  // Settings — What's New (writes to Supabase release_notes table)
  {
    name: 'set_whats_new',
    description:
      'Update the in-app "What\'s New" release notes for a specific version. Writes to Supabase release_notes table and updates local cache. Content should be flat bullet items: - **Title** — Description. No ## headers needed — the version is specified separately.',
    inputSchema: {
      type: 'object',
      properties: {
        version: str('Version string (e.g., "v1.0.0"). Defaults to current package.json version if omitted.'),
        content: str('Release notes content for this version (- **Title** — Description bullets)')
      },
      required: ['content']
    }
  },

  // Tasks — Reorder
  {
    name: 'reorder_tasks',
    description:
      'Reorder tasks by providing an ordered array of task IDs. Sets order_index sequentially based on array position.',
    inputSchema: {
      type: 'object',
      properties: {
        task_ids: {
          type: 'array',
          description: 'Ordered array of task IDs in the desired display order',
          items: { type: 'string' }
        }
      },
      required: ['task_ids']
    }
  }
]

// ── Subtask Copy Helper ─────────────────────────────────────────────

function copyTemplateSubtasks(
  templateParentId: string,
  newParentId: string,
  projectId: string,
  ownerId: string,
  defaultStatusId: string,
  targetLabels: Array<{ id: string; name: string; color: string }>
): void {
  const subtasks = repos.tasks.findSubtasks(templateParentId)
  for (const subtask of subtasks) {
    const subtaskId = randomUUID()
    repos.tasks.create({
      id: subtaskId,
      project_id: projectId,
      owner_id: ownerId,
      title: subtask.title,
      status_id: defaultStatusId,
      description: subtask.description,
      priority: subtask.priority,
      parent_id: newParentId,
      order_index: subtask.order_index,
      recurrence_rule: subtask.recurrence_rule
    })

    // Copy labels
    const subtaskLabels = repos.labels.findByTaskId(subtask.id)
    for (const sl of subtaskLabels) {
      let target = targetLabels.find((l) => l.name === sl.name)
      if (!target) {
        const existing = repos.labels.findByName(getUser().id, sl.name)
        if (existing) {
          repos.labels.addToProject(projectId, existing.id)
          targetLabels.push(existing)
          target = existing
        } else {
          const newLabel = repos.labels.create({
            id: randomUUID(),
            project_id: projectId,
            name: sl.name,
            color: sl.color
          })
          targetLabels.push(newLabel)
          target = newLabel
        }
      }
      repos.tasks.addLabel(subtaskId, target.id)
    }

    // Recurse
    copyTemplateSubtasks(subtask.id, subtaskId, projectId, ownerId, defaultStatusId, targetLabels)
  }
}

// ── Deploy Project Template Helper ──────────────────────────────────

function deployTemplate(
  data: ProjectTemplateData,
  projectId: string,
  ownerId: string
): { defaultStatusId: string; labelMap: Record<string, string> } {
  // Create statuses
  const statusMap: Record<number, string> = {}
  let defaultStatusId = ''
  for (const s of data.statuses) {
    const statusId = randomUUID()
    repos.statuses.create({
      id: statusId,
      project_id: projectId,
      name: s.name,
      color: s.color,
      icon: s.icon,
      order_index: s.order_index,
      is_done: s.is_done,
      is_default: s.is_default
    })
    statusMap[s.order_index] = statusId
    if (s.is_default) defaultStatusId = statusId
  }
  if (!defaultStatusId && data.statuses.length > 0) {
    defaultStatusId = statusMap[data.statuses[0].order_index]
  }

  // Create or reuse global labels and link to project
  const labelMap: Record<string, string> = {}
  for (const l of data.labels) {
    const existing = repos.labels.findByName(getUser().id, l.name)
    if (existing) {
      repos.labels.addToProject(projectId, existing.id)
      labelMap[l.name] = existing.id
    } else {
      const labelId = randomUUID()
      repos.labels.create({
        id: labelId,
        project_id: projectId,
        name: l.name,
        color: l.color
      })
      labelMap[l.name] = labelId
    }
  }

  // Create tasks recursively
  function createTasks(tasks: ProjectTemplateTask[], parentId: string | null): void {
    for (const t of tasks) {
      const taskId = randomUUID()
      repos.tasks.create({
        id: taskId,
        project_id: projectId,
        owner_id: ownerId,
        title: t.title,
        status_id: defaultStatusId,
        description: t.description,
        priority: t.priority,
        recurrence_rule: t.recurrence_rule,
        order_index: t.order_index,
        parent_id: parentId
      })
      for (const labelName of t.labels) {
        const labelId = labelMap[labelName]
        if (labelId) repos.tasks.addLabel(taskId, labelId)
      }
      if (t.subtasks.length > 0) {
        createTasks(t.subtasks, taskId)
      }
    }
  }

  createTasks(data.tasks, null)
  return { defaultStatusId, labelMap }
}

// ── Activity Logging Helper ─────────────────────────────────────────

const PRIORITY_NAMES: Record<number, string> = {
  0: 'none',
  1: 'low',
  2: 'normal',
  3: 'high',
  4: 'urgent'
}

function logActivity(
  taskId: string,
  userId: string,
  action: string,
  oldValue?: string | null,
  newValue?: string | null
): void {
  repos.activityLog.create({
    id: randomUUID(),
    task_id: taskId,
    user_id: userId,
    action,
    old_value: oldValue ?? null,
    new_value: newValue ?? null
  })
}

// ── Tool Handlers ───────────────────────────────────────────────────

type Handler = (args: Record<string, unknown>) => unknown

const handlers: Record<string, Handler> = {
  // ── Tasks — CRUD ────────────────────────────────────────────────
  create_task(args) {
    const user = getUser()
    const projectId = requireStr(args, 'project_id')
    const defaultStatus = repos.statuses.findDefault(projectId)
    if (!defaultStatus) throw new Error('No default status found for project')

    const task = repos.tasks.create({
      id: randomUUID(),
      project_id: projectId,
      owner_id: user.id,
      title: requireStr(args, 'title'),
      status_id: defaultStatus.id,
      description: optStr(args, 'description') ?? null,
      priority: optNum(args, 'priority') ?? 0,
      due_date: optStr(args, 'due_date') ?? null,
      parent_id: optStr(args, 'parent_id') ?? null
    })
    logActivity(task.id, user.id, 'created')
    return task
  },

  list_tasks(args) {
    return repos.tasks.findByProjectId(requireStr(args, 'project_id'))
  },

  get_task(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const labels = repos.labels.findByTaskId(taskId)
    const subtaskCount = repos.tasks.getSubtaskCount(taskId)
    return { ...task, labels, subtask_count: subtaskCount }
  },

  update_task(args) {
    const taskId = requireStr(args, 'task_id')
    const oldTask = repos.tasks.findById(taskId)
    if (!oldTask) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()

    const input: Record<string, string | number | null> = {}
    const title = optStr(args, 'title')
    if (title !== undefined) input.title = title
    const description = optStr(args, 'description')
    if (description !== undefined) input.description = description
    const priority = optNum(args, 'priority')
    if (priority !== undefined) input.priority = priority
    const dueDate = optStr(args, 'due_date')
    if (dueDate !== undefined) input.due_date = dueDate === '' ? null : dueDate
    const statusId = optStr(args, 'status_id')
    if (statusId !== undefined) input.status_id = statusId

    const result = repos.tasks.update(taskId, input)
    if (!result) throw new Error(`Task not found: ${taskId}`)

    // Log per changed field
    if (title !== undefined && title !== oldTask.title) {
      logActivity(taskId, user.id, 'title_changed', oldTask.title, title)
    }
    if (description !== undefined && description !== oldTask.description) {
      logActivity(taskId, user.id, 'description_changed', oldTask.description ?? '', description)
    }
    if (priority !== undefined && priority !== oldTask.priority) {
      logActivity(taskId, user.id, 'priority_changed', PRIORITY_NAMES[oldTask.priority] ?? '', PRIORITY_NAMES[priority] ?? '')
    }
    if (dueDate !== undefined) {
      const newDue = dueDate === '' ? null : dueDate
      if (newDue !== oldTask.due_date) {
        logActivity(taskId, user.id, 'due_date_changed', oldTask.due_date ?? '', newDue ?? '')
      }
    }
    if (statusId !== undefined && statusId !== oldTask.status_id) {
      const oldStatus = repos.statuses.findById(oldTask.status_id)
      const newStatus = repos.statuses.findById(statusId)
      logActivity(taskId, user.id, 'status_changed', oldStatus?.name ?? '', newStatus?.name ?? '')
    }
    return result
  },

  delete_task(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    logActivity(taskId, user.id, 'deleted', task.title, null)
    // Delete subtasks first
    const subtasks = repos.tasks.findSubtasks(taskId)
    for (const sub of subtasks) {
      repos.tasks.delete(sub.id)
    }
    repos.tasks.delete(taskId)
    return { deleted: true, task_id: taskId }
  },

  // ── Tasks — Status changes ──────────────────────────────────────
  complete_task(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const oldStatus = repos.statuses.findById(task.status_id)
    const doneStatus = repos.statuses.findDone(task.project_id)
    if (!doneStatus) throw new Error('No done status found for project')
    const result = repos.tasks.update(taskId, {
      status_id: doneStatus.id,
      completed_date: new Date().toISOString()
    })
    logActivity(taskId, user.id, 'status_changed', oldStatus?.name ?? '', doneStatus.name)
    return result
  },

  reopen_task(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const oldStatus = repos.statuses.findById(task.status_id)
    const defaultStatus = repos.statuses.findDefault(task.project_id)
    if (!defaultStatus) throw new Error('No default status found for project')
    const result = repos.tasks.update(taskId, {
      status_id: defaultStatus.id,
      completed_date: null
    })
    logActivity(taskId, user.id, 'status_changed', oldStatus?.name ?? '', defaultStatus.name)
    return result
  },

  // ── Tasks — Field setters ──────────────────────────────────────
  set_task_priority(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const priority = optNum(args, 'priority') ?? 0
    const result = repos.tasks.update(taskId, { priority })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'priority_changed', PRIORITY_NAMES[task.priority] ?? '', PRIORITY_NAMES[priority] ?? '')
    return result
  },

  set_task_due_date(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const dueDate = optStr(args, 'due_date') ?? ''
    const newDue = dueDate === '' ? null : dueDate
    const result = repos.tasks.update(taskId, { due_date: newDue })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'due_date_changed', task.due_date ?? '', newDue ?? '')
    return result
  },

  set_task_description(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const description = optStr(args, 'description') ?? ''
    const result = repos.tasks.update(taskId, { description })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'description_changed', task.description ?? '', description)
    return result
  },

  set_task_recurrence(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const rule = optStr(args, 'recurrence_rule') ?? ''
    const newRule = rule === '' ? null : rule
    const result = repos.tasks.update(taskId, { recurrence_rule: newRule })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'recurrence_changed', task.recurrence_rule ?? '', newRule ?? '')
    return result
  },

  // ── Tasks — My Day ─────────────────────────────────────────────
  add_task_to_my_day(args) {
    const taskId = requireStr(args, 'task_id')
    const user = getUser()
    const result = repos.tasks.update(taskId, { is_in_my_day: 1 })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'pinned_to_my_day')
    return result
  },

  remove_task_from_my_day(args) {
    const taskId = requireStr(args, 'task_id')
    const user = getUser()
    const result = repos.tasks.update(taskId, { is_in_my_day: 0 })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'unpinned_from_my_day')
    return result
  },

  // ── Tasks — Other actions ──────────────────────────────────────
  snooze_task(args) {
    const taskId = requireStr(args, 'task_id')
    const task = repos.tasks.findById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    const user = getUser()
    const snoozeUntil = requireStr(args, 'snooze_until')
    const result = repos.tasks.update(taskId, {
      due_date: snoozeUntil,
      is_in_my_day: 0
    })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'due_date_changed', task.due_date ?? '', snoozeUntil)
    return result
  },

  archive_task(args) {
    const taskId = requireStr(args, 'task_id')
    const user = getUser()
    const result = repos.tasks.update(taskId, { is_archived: 1 })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'archived')
    return result
  },

  unarchive_task(args) {
    const taskId = requireStr(args, 'task_id')
    const user = getUser()
    const result = repos.tasks.update(taskId, { is_archived: 0 })
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(taskId, user.id, 'unarchived')
    return result
  },

  duplicate_task(args) {
    const taskId = requireStr(args, 'task_id')
    const user = getUser()
    const result = repos.tasks.duplicate(taskId, randomUUID())
    if (!result) throw new Error(`Task not found: ${taskId}`)
    logActivity(result.id, user.id, 'created')
    return result
  },

  save_task_as_template(args) {
    const taskId = requireStr(args, 'task_id')
    const result = repos.tasks.saveAsTemplate(taskId, randomUUID())
    if (!result) throw new Error(`Task not found: ${taskId}`)
    return result
  },

  // ── Subtasks ───────────────────────────────────────────────────
  create_subtask(args) {
    const parentId = requireStr(args, 'parent_id')
    const parent = repos.tasks.findById(parentId)
    if (!parent) throw new Error(`Parent task not found: ${parentId}`)
    const user = getUser()
    const defaultStatus = repos.statuses.findDefault(parent.project_id)
    if (!defaultStatus) throw new Error('No default status found for project')

    const subtask = repos.tasks.create({
      id: randomUUID(),
      project_id: parent.project_id,
      owner_id: user.id,
      title: requireStr(args, 'title'),
      status_id: defaultStatus.id,
      parent_id: parentId
    })
    logActivity(subtask.id, user.id, 'created')
    return subtask
  },

  list_subtasks(args) {
    return repos.tasks.findSubtasks(requireStr(args, 'parent_id'))
  },

  // ── Projects ───────────────────────────────────────────────────
  list_projects() {
    return repos.projects.list()
  },

  get_project(args) {
    const projectId = requireStr(args, 'project_id')
    const project = repos.projects.findById(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)
    const statuses = repos.statuses.findByProjectId(projectId)
    const labels = repos.labels.findByProjectId(projectId)
    return { ...project, statuses, labels }
  },

  create_project(args) {
    const user = getUser()
    const projectId = randomUUID()
    const project = repos.projects.create({
      id: projectId,
      name: requireStr(args, 'name'),
      owner_id: user.id,
      color: optStr(args, 'color'),
      description: optStr(args, 'description')
    })
    repos.projects.addMember(projectId, user.id, 'owner')

    // Create default statuses
    const notStartedId = randomUUID()
    const inProgressId = randomUUID()
    const doneId = randomUUID()
    repos.statuses.create({
      id: notStartedId,
      project_id: projectId,
      name: 'Not Started',
      color: '#888888',
      icon: 'circle',
      order_index: 0,
      is_default: 1
    })
    repos.statuses.create({
      id: inProgressId,
      project_id: projectId,
      name: 'In Progress',
      color: '#3b82f6',
      icon: 'circle-dot',
      order_index: 1
    })
    repos.statuses.create({
      id: doneId,
      project_id: projectId,
      name: 'Done',
      color: '#22c55e',
      icon: 'check-circle-2',
      order_index: 2,
      is_done: 1
    })

    return project
  },

  update_project(args) {
    const projectId = requireStr(args, 'project_id')
    const input: Record<string, string | undefined> = {}
    const name = optStr(args, 'name')
    if (name !== undefined) input.name = name
    const color = optStr(args, 'color')
    if (color !== undefined) input.color = color
    const description = optStr(args, 'description')
    if (description !== undefined) input.description = description

    const result = repos.projects.update(projectId, input)
    if (!result) throw new Error(`Project not found: ${projectId}`)
    return result
  },

  delete_project(args) {
    const projectId = requireStr(args, 'project_id')
    const deleted = repos.projects.delete(projectId)
    if (!deleted) throw new Error(`Project not found: ${projectId}`)
    return { deleted: true, project_id: projectId }
  },

  // ── Labels ─────────────────────────────────────────────────────
  list_labels(args) {
    return repos.labels.findByProjectId(requireStr(args, 'project_id'))
  },

  create_label(args) {
    return repos.labels.create({
      id: randomUUID(),
      project_id: requireStr(args, 'project_id'),
      name: requireStr(args, 'name'),
      color: optStr(args, 'color')
    })
  },

  assign_label_to_task(args) {
    const taskId = requireStr(args, 'task_id')
    const labelId = requireStr(args, 'label_id')
    const user = getUser()
    repos.tasks.addLabel(taskId, labelId)
    const label = repos.labels.findById(labelId)
    logActivity(taskId, user.id, 'label_added', null, label?.name ?? labelId)
    return { assigned: true, task_id: taskId, label_id: labelId }
  },

  remove_label_from_task(args) {
    const taskId = requireStr(args, 'task_id')
    const labelId = requireStr(args, 'label_id')
    const user = getUser()
    const label = repos.labels.findById(labelId)
    const removed = repos.tasks.removeLabel(taskId, labelId)
    if (removed) {
      logActivity(taskId, user.id, 'label_removed', label?.name ?? labelId, null)
    }
    return { removed, task_id: taskId, label_id: labelId }
  },

  // ── Statuses ───────────────────────────────────────────────────
  list_statuses(args) {
    return repos.statuses.findByProjectId(requireStr(args, 'project_id'))
  },

  // ── Search ─────────────────────────────────────────────────────
  search_tasks(args) {
    return repos.tasks.search({
      project_id: optStr(args, 'project_id'),
      status_id: optStr(args, 'status_id'),
      priority: optNum(args, 'priority'),
      label_id: optStr(args, 'label_id'),
      due_before: optStr(args, 'due_before'),
      due_after: optStr(args, 'due_after'),
      keyword: optStr(args, 'keyword')
    })
  },

  // ── My Day ─────────────────────────────────────────────────────
  list_my_day() {
    const user = getUser()
    return repos.tasks.findMyDay(user.id)
  },

  // ── Templates ──────────────────────────────────────────────────
  list_templates() {
    const user = getUser()
    const taskTemplates = repos.tasks.findAllTemplates(user.id)
    const projectTemplates = repos.projectTemplates.findByOwnerId(user.id)
    return { task_templates: taskTemplates, project_templates: projectTemplates }
  },

  use_task_template(args) {
    const templateId = requireStr(args, 'template_id')
    const projectId = requireStr(args, 'project_id')

    const template = repos.tasks.findById(templateId)
    if (!template || !template.is_template) throw new Error(`Task template not found: ${templateId}`)

    const user = getUser()
    const defaultStatus = repos.statuses.findDefault(projectId)
    if (!defaultStatus) throw new Error('No default status found for target project')

    const newId = randomUUID()
    const newTask = repos.tasks.create({
      id: newId,
      project_id: projectId,
      owner_id: user.id,
      title: template.title,
      status_id: defaultStatus.id,
      description: template.description,
      priority: template.priority,
      recurrence_rule: template.recurrence_rule,
      order_index: 0
    })

    // Copy labels — reuse existing global labels or create new ones
    const templateLabels = repos.labels.findByTaskId(templateId)
    const targetLabels = [...repos.labels.findByProjectId(projectId)]
    for (const tl of templateLabels) {
      let target = targetLabels.find((l) => l.name === tl.name)
      if (!target) {
        // Check for existing global label by name
        const existing = repos.labels.findByName(getUser().id, tl.name)
        if (existing) {
          repos.labels.addToProject(projectId, existing.id)
          targetLabels.push(existing)
          target = existing
        } else {
          const created = repos.labels.create({
            id: randomUUID(),
            project_id: projectId,
            name: tl.name,
            color: tl.color
          })
          targetLabels.push(created)
          target = created
        }
      }
      repos.tasks.addLabel(newId, target.id)
    }

    // Copy subtasks recursively
    copyTemplateSubtasks(templateId, newId, projectId, user.id, defaultStatus.id, targetLabels)

    logActivity(newId, user.id, 'created')
    return newTask
  },

  deploy_project_template(args) {
    const templateId = requireStr(args, 'template_id')
    const template = repos.projectTemplates.findById(templateId)
    if (!template) throw new Error(`Project template not found: ${templateId}`)

    const data = JSON.parse(template.data) as ProjectTemplateData
    const user = getUser()

    const projectId = randomUUID()
    const project = repos.projects.create({
      id: projectId,
      name: optStr(args, 'name') ?? template.name,
      color: optStr(args, 'color') ?? template.color,
      owner_id: user.id
    })
    repos.projects.addMember(projectId, user.id, 'owner')

    deployTemplate(data, projectId, user.id)
    return project
  },

  // ── Tasks — Reorder ─────────────────────────────────────────────
  reorder_tasks(args) {
    const taskIds = args.task_ids
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      throw new Error('task_ids must be a non-empty array of task IDs')
    }
    const ids = taskIds.map(String)

    // Validate all task IDs exist
    for (const id of ids) {
      const task = repos.tasks.findById(id)
      if (!task) throw new Error(`Task not found: ${id}`)
    }

    repos.tasks.reorder(ids)

    // Check if priority auto-sort is enabled
    const user = getUser()
    const autoSort = repos.settings.get(user.id, 'priority_auto_sort')
    const warning =
      autoSort === 'true'
        ? 'Note: priority auto-sort is enabled in the user\'s settings — the visual order in the app may differ from the requested order'
        : undefined

    return {
      reordered: true,
      count: ids.length,
      ...(warning ? { warning } : {})
    }
  },

  // ── Settings — What's New (Supabase) ─────────────────────────────
  async set_whats_new(args) {
    const content = requireStr(args, 'content')
    const version = optStr(args, 'version') ?? readPackageVersion()

    const client = getSupabaseClient()
    if (client) {
      const { error } = await client
        .from('release_notes')
        .upsert({ version, content, published_at: new Date().toISOString() }, { onConflict: 'version' })

      if (error) {
        // Fall back to local SQLite
        process.stderr.write(`Supabase upsert failed: ${error.message}\n`)
        repos.settings.set('', 'whats_new', `## ${version}\n${content}`)
        return { success: true, content, version, storage: 'local-fallback', error: error.message }
      }

      // Sync all versions to local cache
      const { data } = await client
        .from('release_notes')
        .select('version, content')
        .order('published_at', { ascending: false })

      if (data && data.length > 0) {
        const markdown = data.map((row: { version: string; content: string }) => `## ${row.version}\n${row.content}`).join('\n\n')
        repos.settings.set('', 'whats_new', markdown)
      }

      return { success: true, content, version, storage: 'supabase' }
    }

    // No Supabase — write locally only
    repos.settings.set('', 'whats_new', `## ${version}\n${content}`)
    return { success: true, content, version, storage: 'local-only' }
  }
}

// ── Server Setup ────────────────────────────────────────────────────

const server = new Server(
  { name: 'todoozy', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const handler = handlers[name]
  if (!handler) return fail(`Unknown tool: ${name}`)
  try {
    const result = await Promise.resolve(handler(args ?? {}))
    return ok(result)
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((e) => {
  process.stderr.write(`MCP server error: ${e}\n`)
  process.exit(1)
})
