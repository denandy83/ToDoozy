import type Database from 'better-sqlite3'
import { UserRepository } from './UserRepository'
import { ProjectRepository } from './ProjectRepository'
import { StatusRepository } from './StatusRepository'
import { TaskRepository } from './TaskRepository'
import { LabelRepository } from './LabelRepository'
import { ThemeRepository } from './ThemeRepository'
import { SettingsRepository } from './SettingsRepository'
import { ActivityLogRepository } from './ActivityLogRepository'
import { ProjectTemplateRepository } from './ProjectTemplateRepository'
import { AttachmentRepository } from './AttachmentRepository'

export interface Repositories {
  users: UserRepository
  projects: ProjectRepository
  statuses: StatusRepository
  tasks: TaskRepository
  labels: LabelRepository
  themes: ThemeRepository
  settings: SettingsRepository
  activityLog: ActivityLogRepository
  projectTemplates: ProjectTemplateRepository
  attachments: AttachmentRepository
}

export function createRepositories(db: Database.Database): Repositories {
  return {
    users: new UserRepository(db),
    projects: new ProjectRepository(db),
    statuses: new StatusRepository(db),
    tasks: new TaskRepository(db),
    labels: new LabelRepository(db),
    themes: new ThemeRepository(db),
    settings: new SettingsRepository(db),
    activityLog: new ActivityLogRepository(db),
    projectTemplates: new ProjectTemplateRepository(db),
    attachments: new AttachmentRepository(db)
  }
}

export {
  UserRepository,
  ProjectRepository,
  StatusRepository,
  TaskRepository,
  LabelRepository,
  ThemeRepository,
  SettingsRepository,
  ActivityLogRepository,
  ProjectTemplateRepository,
  AttachmentRepository
}
