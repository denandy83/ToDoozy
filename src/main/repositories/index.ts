import type { DatabaseSync } from 'node:sqlite'
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
import { NotificationRepository } from './NotificationRepository'
import { SyncQueueRepository } from './SyncQueueRepository'
import { SyncMetaRepository } from './SyncMetaRepository'
import { SavedViewRepository } from './SavedViewRepository'
import { ProjectAreaRepository } from './ProjectAreaRepository'

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
  notifications: NotificationRepository
  syncQueue: SyncQueueRepository
  syncMeta: SyncMetaRepository
  savedViews: SavedViewRepository
  projectAreas: ProjectAreaRepository
}

export function createRepositories(db: DatabaseSync): Repositories {
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
    attachments: new AttachmentRepository(db),
    notifications: new NotificationRepository(db),
    syncQueue: new SyncQueueRepository(db),
    syncMeta: new SyncMetaRepository(db),
    savedViews: new SavedViewRepository(db),
    projectAreas: new ProjectAreaRepository(db)
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
  AttachmentRepository,
  NotificationRepository,
  SyncQueueRepository,
  SyncMetaRepository,
  SavedViewRepository,
  ProjectAreaRepository
}
