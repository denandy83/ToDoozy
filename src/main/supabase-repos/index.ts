// Async repository interface for Supabase-backed MCP server
// Mirrors the SQLite Repositories interface but returns Promise<T>

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Task,
  Project,
  Status,
  Label,
  ActivityLogEntry,
  SavedView,
  ProjectArea,
  ProjectTemplate,
  CreateTaskInput,
  UpdateTaskInput,
  CreateProjectInput,
  UpdateProjectInput,
  CreateStatusInput,
  CreateLabelInput,
  CreateActivityLogInput,
  CreateSavedViewInput,
  CreateProjectAreaInput,
  UpdateProjectAreaInput,
  TaskLabel
} from '../../shared/types'
import type { TaskSearchFilters } from '../repositories/TaskRepository'
import { SupabaseTaskRepository } from './TaskRepository'
import { SupabaseProjectRepository } from './ProjectRepository'
import { SupabaseStatusRepository } from './StatusRepository'
import { SupabaseLabelRepository } from './LabelRepository'
import { SupabaseActivityLogRepository } from './ActivityLogRepository'
import { SupabaseSettingsRepository } from './SettingsRepository'
import { SupabaseSavedViewRepository } from './SavedViewRepository'
import { SupabaseProjectAreaRepository } from './ProjectAreaRepository'
import { SupabaseProjectTemplateRepository } from './ProjectTemplateRepository'

export interface AsyncTaskRepository {
  findById(id: string): Promise<Task | undefined>
  findByProjectId(projectId: string): Promise<Task[]>
  findSubtasks(parentId: string): Promise<Task[]>
  findMyDay(userId: string): Promise<Task[]>
  findArchived(projectId: string): Promise<Task[]>
  findTemplates(projectId: string): Promise<Task[]>
  findAllTemplates(userId: string): Promise<Task[]>
  create(input: CreateTaskInput): Promise<Task>
  update(id: string, input: UpdateTaskInput): Promise<Task | undefined>
  delete(id: string): Promise<boolean>
  duplicate(id: string, newId: string): Promise<Task | undefined>
  saveAsTemplate(id: string, newId: string): Promise<Task | undefined>
  reorder(taskIds: string[]): Promise<void>
  addLabel(taskId: string, labelId: string): Promise<void>
  removeLabel(taskId: string, labelId: string): Promise<boolean>
  getLabels(taskId: string): Promise<TaskLabel[]>
  search(filters: TaskSearchFilters): Promise<Task[]>
  getSubtaskCount(parentId: string): Promise<{ total: number; done: number }>
  completeRecurringTask(taskId: string): Promise<{ id: string; dueDate: string } | null>
}

export interface AsyncProjectRepository {
  list(): Promise<Project[]>
  findById(id: string): Promise<Project | undefined>
  create(input: CreateProjectInput): Promise<Project>
  update(id: string, input: UpdateProjectInput): Promise<Project | undefined>
  delete(id: string): Promise<boolean>
  addMember(projectId: string, userId: string, role: string): Promise<void>
  getProjectsForUser(userId: string): Promise<Project[]>
}

export interface AsyncStatusRepository {
  findByProjectId(projectId: string): Promise<Status[]>
  findById(id: string): Promise<Status | undefined>
  findDefault(projectId: string): Promise<Status | undefined>
  findDone(projectId: string): Promise<Status | undefined>
  create(input: CreateStatusInput): Promise<Status>
}

export interface AsyncLabelRepository {
  findById(id: string): Promise<Label | undefined>
  findByProjectId(projectId: string): Promise<Label[]>
  findByTaskId(taskId: string): Promise<Label[]>
  findByName(userId: string, name: string): Promise<Label | undefined>
  create(input: CreateLabelInput): Promise<Label>
  addToProject(projectId: string, labelId: string): Promise<void>
}

export interface AsyncActivityLogRepository {
  create(input: CreateActivityLogInput & { project_id?: string }): Promise<ActivityLogEntry>
}

export interface AsyncSettingsRepository {
  get(userId: string, key: string): Promise<string | null>
  set(userId: string, key: string, value: string | null): Promise<void>
}

export interface AsyncSavedViewRepository {
  findByUserId(userId: string): Promise<SavedView[]>
  findById(id: string): Promise<SavedView | undefined>
  create(input: CreateSavedViewInput): Promise<SavedView>
  delete(id: string): Promise<boolean>
}

export interface AsyncProjectAreaRepository {
  findByUserId(userId: string): Promise<ProjectArea[]>
  findById(id: string): Promise<ProjectArea | undefined>
  create(input: CreateProjectAreaInput): Promise<ProjectArea>
  update(id: string, input: UpdateProjectAreaInput): Promise<ProjectArea | null>
  delete(id: string): Promise<boolean>
  assignProject(projectId: string, areaId: string | null): Promise<void>
}

export interface AsyncProjectTemplateRepository {
  findById(id: string): Promise<ProjectTemplate | undefined>
  findByOwnerId(ownerId: string): Promise<ProjectTemplate[]>
}

export interface AsyncRepositories {
  tasks: AsyncTaskRepository
  projects: AsyncProjectRepository
  statuses: AsyncStatusRepository
  labels: AsyncLabelRepository
  activityLog: AsyncActivityLogRepository
  settings: AsyncSettingsRepository
  savedViews: AsyncSavedViewRepository
  projectAreas: AsyncProjectAreaRepository
  projectTemplates: AsyncProjectTemplateRepository
}

export function createSupabaseRepositories(
  client: SupabaseClient,
  userId: string
): AsyncRepositories {
  return {
    tasks: new SupabaseTaskRepository(client, userId),
    projects: new SupabaseProjectRepository(client, userId),
    statuses: new SupabaseStatusRepository(client),
    labels: new SupabaseLabelRepository(client, userId),
    activityLog: new SupabaseActivityLogRepository(client),
    settings: new SupabaseSettingsRepository(client),
    savedViews: new SupabaseSavedViewRepository(client),
    projectAreas: new SupabaseProjectAreaRepository(client),
    projectTemplates: new SupabaseProjectTemplateRepository()
  }
}
