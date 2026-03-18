import { ipcMain } from 'electron'
import { getDatabase } from './database'
import { createRepositories, type Repositories } from './repositories'

let repos: Repositories | null = null

function getRepos(): Repositories {
  if (!repos) {
    repos = createRepositories(getDatabase())
  }
  return repos
}

export function registerIpcHandlers(): void {
  // ── Tasks ──────────────────────────────────────────────────────────
  ipcMain.handle('tasks:findById', (_e, id: string) => {
    return getRepos().tasks.findById(id) ?? null
  })

  ipcMain.handle('tasks:findByProjectId', (_e, projectId: string) => {
    return getRepos().tasks.findByProjectId(projectId)
  })

  ipcMain.handle('tasks:findByStatusId', (_e, statusId: string) => {
    return getRepos().tasks.findByStatusId(statusId)
  })

  ipcMain.handle('tasks:findMyDay', (_e, userId: string) => {
    return getRepos().tasks.findMyDay(userId)
  })

  ipcMain.handle('tasks:findArchived', (_e, projectId: string) => {
    return getRepos().tasks.findArchived(projectId)
  })

  ipcMain.handle('tasks:findTemplates', (_e, projectId: string) => {
    return getRepos().tasks.findTemplates(projectId)
  })

  ipcMain.handle('tasks:findSubtasks', (_e, parentId: string) => {
    return getRepos().tasks.findSubtasks(parentId)
  })

  ipcMain.handle('tasks:getSubtaskCount', (_e, parentId: string) => {
    return getRepos().tasks.getSubtaskCount(parentId)
  })

  ipcMain.handle('tasks:create', (_e, input: Parameters<Repositories['tasks']['create']>[0]) => {
    return getRepos().tasks.create(input)
  })

  ipcMain.handle(
    'tasks:update',
    (_e, id: string, input: Parameters<Repositories['tasks']['update']>[1]) => {
      return getRepos().tasks.update(id, input) ?? null
    }
  )

  ipcMain.handle('tasks:delete', (_e, id: string) => {
    return getRepos().tasks.delete(id)
  })

  ipcMain.handle('tasks:reorder', (_e, taskIds: string[]) => {
    return getRepos().tasks.reorder(taskIds)
  })

  ipcMain.handle('tasks:addLabel', (_e, taskId: string, labelId: string) => {
    return getRepos().tasks.addLabel(taskId, labelId)
  })

  ipcMain.handle('tasks:removeLabel', (_e, taskId: string, labelId: string) => {
    return getRepos().tasks.removeLabel(taskId, labelId)
  })

  ipcMain.handle('tasks:getLabels', (_e, taskId: string) => {
    return getRepos().tasks.getLabels(taskId)
  })

  ipcMain.handle('tasks:duplicate', (_e, id: string, newId: string) => {
    return getRepos().tasks.duplicate(id, newId) ?? null
  })

  // ── Labels ─────────────────────────────────────────────────────────
  ipcMain.handle('labels:findById', (_e, id: string) => {
    return getRepos().labels.findById(id) ?? null
  })

  ipcMain.handle('labels:findByProjectId', (_e, projectId: string) => {
    return getRepos().labels.findByProjectId(projectId)
  })

  ipcMain.handle(
    'labels:create',
    (_e, input: Parameters<Repositories['labels']['create']>[0]) => {
      return getRepos().labels.create(input)
    }
  )

  ipcMain.handle(
    'labels:update',
    (_e, id: string, input: Parameters<Repositories['labels']['update']>[1]) => {
      return getRepos().labels.update(id, input) ?? null
    }
  )

  ipcMain.handle('labels:delete', (_e, id: string) => {
    return getRepos().labels.delete(id)
  })

  ipcMain.handle('labels:findByTaskId', (_e, taskId: string) => {
    return getRepos().labels.findByTaskId(taskId)
  })

  // ── Projects ───────────────────────────────────────────────────────
  ipcMain.handle('projects:findById', (_e, id: string) => {
    return getRepos().projects.findById(id) ?? null
  })

  ipcMain.handle('projects:findByOwnerId', (_e, ownerId: string) => {
    return getRepos().projects.findByOwnerId(ownerId)
  })

  ipcMain.handle('projects:findDefault', (_e, ownerId: string) => {
    return getRepos().projects.findDefault(ownerId) ?? null
  })

  ipcMain.handle(
    'projects:create',
    (_e, input: Parameters<Repositories['projects']['create']>[0]) => {
      return getRepos().projects.create(input)
    }
  )

  ipcMain.handle(
    'projects:update',
    (_e, id: string, input: Parameters<Repositories['projects']['update']>[1]) => {
      return getRepos().projects.update(id, input) ?? null
    }
  )

  ipcMain.handle('projects:delete', (_e, id: string) => {
    return getRepos().projects.delete(id)
  })

  ipcMain.handle('projects:list', () => {
    return getRepos().projects.list()
  })

  ipcMain.handle(
    'projects:addMember',
    (_e, projectId: string, userId: string, role: string, invitedBy?: string) => {
      return getRepos().projects.addMember(projectId, userId, role, invitedBy)
    }
  )

  ipcMain.handle('projects:removeMember', (_e, projectId: string, userId: string) => {
    return getRepos().projects.removeMember(projectId, userId)
  })

  ipcMain.handle('projects:getMembers', (_e, projectId: string) => {
    return getRepos().projects.getMembers(projectId)
  })

  ipcMain.handle('projects:getProjectsForUser', (_e, userId: string) => {
    return getRepos().projects.getProjectsForUser(userId)
  })

  // ── Statuses ───────────────────────────────────────────────────────
  ipcMain.handle('statuses:findById', (_e, id: string) => {
    return getRepos().statuses.findById(id) ?? null
  })

  ipcMain.handle('statuses:findByProjectId', (_e, projectId: string) => {
    return getRepos().statuses.findByProjectId(projectId)
  })

  ipcMain.handle('statuses:findDefault', (_e, projectId: string) => {
    return getRepos().statuses.findDefault(projectId) ?? null
  })

  ipcMain.handle('statuses:findDone', (_e, projectId: string) => {
    return getRepos().statuses.findDone(projectId) ?? null
  })

  ipcMain.handle(
    'statuses:create',
    (_e, input: Parameters<Repositories['statuses']['create']>[0]) => {
      return getRepos().statuses.create(input)
    }
  )

  ipcMain.handle(
    'statuses:update',
    (_e, id: string, input: Parameters<Repositories['statuses']['update']>[1]) => {
      return getRepos().statuses.update(id, input) ?? null
    }
  )

  ipcMain.handle('statuses:delete', (_e, id: string) => {
    return getRepos().statuses.delete(id)
  })

  ipcMain.handle(
    'statuses:reassignAndDelete',
    (_e, statusId: string, targetStatusId: string) => {
      return getRepos().statuses.reassignAndDelete(statusId, targetStatusId)
    }
  )

  // ── Users ──────────────────────────────────────────────────────────
  ipcMain.handle('users:findById', (_e, id: string) => {
    return getRepos().users.findById(id) ?? null
  })

  ipcMain.handle('users:findByEmail', (_e, email: string) => {
    return getRepos().users.findByEmail(email) ?? null
  })

  ipcMain.handle('users:create', (_e, input: Parameters<Repositories['users']['create']>[0]) => {
    return getRepos().users.create(input)
  })

  ipcMain.handle(
    'users:update',
    (_e, id: string, input: Parameters<Repositories['users']['update']>[1]) => {
      return getRepos().users.update(id, input) ?? null
    }
  )

  ipcMain.handle('users:delete', (_e, id: string) => {
    return getRepos().users.delete(id)
  })

  ipcMain.handle('users:list', () => {
    return getRepos().users.list()
  })

  // ── Activity Log ───────────────────────────────────────────────────
  ipcMain.handle('activityLog:findById', (_e, id: string) => {
    return getRepos().activityLog.findById(id) ?? null
  })

  ipcMain.handle('activityLog:findByTaskId', (_e, taskId: string) => {
    return getRepos().activityLog.findByTaskId(taskId)
  })

  ipcMain.handle('activityLog:findByUserId', (_e, userId: string) => {
    return getRepos().activityLog.findByUserId(userId)
  })

  ipcMain.handle(
    'activityLog:create',
    (_e, input: Parameters<Repositories['activityLog']['create']>[0]) => {
      return getRepos().activityLog.create(input)
    }
  )

  ipcMain.handle('activityLog:deleteByTaskId', (_e, taskId: string) => {
    return getRepos().activityLog.deleteByTaskId(taskId)
  })

  ipcMain.handle('activityLog:getRecent', (_e, limit: number) => {
    return getRepos().activityLog.getRecent(limit)
  })

  // ── Settings ───────────────────────────────────────────────────────
  ipcMain.handle('settings:get', (_e, key: string) => {
    return getRepos().settings.get(key)
  })

  ipcMain.handle('settings:set', (_e, key: string, value: string | null) => {
    return getRepos().settings.set(key, value)
  })

  ipcMain.handle('settings:getAll', () => {
    return getRepos().settings.getAll()
  })

  ipcMain.handle(
    'settings:getMultiple',
    (_e, keys: string[]) => {
      return getRepos().settings.getMultiple(keys)
    }
  )

  ipcMain.handle(
    'settings:setMultiple',
    (_e, settings: Parameters<Repositories['settings']['setMultiple']>[0]) => {
      return getRepos().settings.setMultiple(settings)
    }
  )

  ipcMain.handle('settings:delete', (_e, key: string) => {
    return getRepos().settings.delete(key)
  })

  // ── Themes ─────────────────────────────────────────────────────────
  ipcMain.handle('themes:findById', (_e, id: string) => {
    return getRepos().themes.findById(id) ?? null
  })

  ipcMain.handle('themes:list', () => {
    return getRepos().themes.list()
  })

  ipcMain.handle('themes:listByMode', (_e, mode: string) => {
    return getRepos().themes.listByMode(mode)
  })

  ipcMain.handle(
    'themes:create',
    (_e, input: Parameters<Repositories['themes']['create']>[0]) => {
      return getRepos().themes.create(input)
    }
  )

  ipcMain.handle(
    'themes:update',
    (_e, id: string, input: Parameters<Repositories['themes']['update']>[1]) => {
      return getRepos().themes.update(id, input) ?? null
    }
  )

  ipcMain.handle('themes:delete', (_e, id: string) => {
    return getRepos().themes.delete(id)
  })

  ipcMain.handle('themes:getConfig', (_e, id: string) => {
    return getRepos().themes.getConfig(id) ?? null
  })
}
