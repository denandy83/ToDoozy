import { ipcMain, safeStorage, BrowserWindow, dialog, shell } from 'electron'
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { getDatabase, switchDatabase, getDatabasePath } from './database'
import { createRepositories, type Repositories } from './repositories'
import { hideQuickAddWindow } from './quick-add'
import { registerQuickAddShortcut, registerAppToggleShortcut } from './index'
import { is } from '@electron-toolkit/utils'
import { getReservedShortcutName } from '../shared/shortcut-utils'
import { setTrayUserId, refreshTray, setTimerState, clearTimerState } from './tray'
import { getMainWindow } from './index'
import type { TimerTrayState } from '../preload/index.d'

let repos: Repositories | null = null

function getRepos(): Repositories {
  if (!repos) {
    repos = createRepositories(getDatabase())
  }
  return repos
}

// ── Auth token storage using safeStorage ──────────────────────────────
const getTokenPath = (): string => {
  const suffix = is.dev ? '.dev' : ''
  return join(app.getPath('userData'), `.auth-session${suffix}`)
}

function storeEncryptedSession(sessionJson: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(sessionJson)
    writeFileSync(getTokenPath(), encrypted)
  } else {
    // Fallback: store as plain text (less secure, but functional)
    writeFileSync(getTokenPath(), sessionJson, 'utf-8')
  }
}

function getEncryptedSession(): string | null {
  const tokenPath = getTokenPath()
  if (!existsSync(tokenPath)) return null
  try {
    const data = readFileSync(tokenPath)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(data)
    }
    return data.toString('utf-8')
  } catch (err) {
    console.error('Failed to read stored session:', err)
    return null
  }
}

function clearEncryptedSession(): void {
  const tokenPath = getTokenPath()
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath)
  }
}


function registerAuthHandlers(): void {
  ipcMain.handle('auth:storeSession', (_e, sessionJson: string) => {
    storeEncryptedSession(sessionJson)
  })

  ipcMain.handle('auth:getSession', () => {
    return getEncryptedSession()
  })

  ipcMain.handle('auth:clearSession', () => {
    clearEncryptedSession()
  })

  ipcMain.handle('auth:switchDatabase', (_e, userId: string, email?: string) => {
    switchDatabase(userId, email)
    // Reset repos so they use the new DB
    repos = null
  })

  ipcMain.handle('auth:getSupabaseConfig', () => {
    return {
      url: process.env.SUPABASE_URL ?? '',
      anonKey: process.env.SUPABASE_ANON_KEY ?? ''
    }
  })

  ipcMain.handle('auth:openOAuthWindow', async (_e, url: string) => {
    return new Promise<string | null>((resolve) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      let resolved = false

      const handleNavigation = async (navUrl: string): Promise<void> => {
        if (resolved) return
        // Look for the auth callback with code (PKCE) or access_token (implicit)
        if (navUrl.includes('code=') || navUrl.includes('access_token=')) {
          resolved = true
          try {
            const fullUrl = await authWindow.webContents.executeJavaScript(
              'window.location.href'
            )
            resolve(fullUrl)
          } catch {
            resolve(navUrl)
          }
          authWindow.close()
        }
      }

      authWindow.webContents.on('will-navigate', (_event, navUrl) => {
        handleNavigation(navUrl)
      })

      authWindow.webContents.on('did-navigate', (_event, navUrl) => {
        handleNavigation(navUrl)
      })

      authWindow.webContents.on('will-redirect', (_event, navUrl) => {
        handleNavigation(navUrl)
      })

      authWindow.on('closed', () => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
      })

      authWindow.loadURL(url)
    })
  })
}

export function registerIpcHandlers(): void {
  registerAuthHandlers()

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

  ipcMain.handle('tasks:autoAddMyDay', (_e, userId: string, mode: string) => {
    return getRepos().tasks.autoAddMyDayTasks(userId, mode as 'off' | 'due_today' | 'due_today_or_overdue')
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

  ipcMain.handle('tasks:applyRemote', (_e, task: Parameters<Repositories['tasks']['applyRemoteTask']>[0]) => {
    return getRepos().tasks.applyRemoteTask(task)
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

  ipcMain.handle('tasks:hardDelete', (_e, id: string) => {
    return getRepos().tasks.hardDelete(id)
  })

  ipcMain.handle(
    'tasks:findAllByProject',
    (_e, projectId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().tasks.findAllByProject(projectId, options ?? {})
    }
  )

  ipcMain.handle('tasks:findMaxUpdatedAt', (_e, projectId: string) => {
    return getRepos().tasks.findMaxUpdatedAt(projectId)
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

  ipcMain.handle('tasks:getTaskLabelsForUser', (_e, userId: string) => {
    return getRepos().tasks.getTaskLabelsForUser(userId)
  })

  ipcMain.handle('tasks:getTaskLabelsForSharedProjects', () => {
    return getRepos().tasks.getTaskLabelsForSharedProjects()
  })

  ipcMain.handle('tasks:duplicate', (_e, id: string, newId: string) => {
    return getRepos().tasks.duplicate(id, newId) ?? null
  })

  ipcMain.handle('tasks:findAllTemplates', (_e, userId: string) => {
    return getRepos().tasks.findAllTemplates(userId)
  })

  ipcMain.handle('tasks:saveAsTemplate', (_e, id: string, newId: string) => {
    return getRepos().tasks.saveAsTemplate(id, newId) ?? null
  })

  ipcMain.handle('tasks:completeRecurring', (_e, taskId: string) => {
    return getRepos().tasks.completeRecurringTask(taskId)
  })

  // ── Labels ─────────────────────────────────────────────────────────
  ipcMain.handle('labels:findById', (_e, id: string) => {
    return getRepos().labels.findById(id) ?? null
  })

  ipcMain.handle('labels:findByIds', (_e, ids: string[]) => {
    return getRepos().labels.findByIds(ids)
  })

  ipcMain.handle('labels:findAll', (_e, userId: string) => {
    return getRepos().labels.findAllForUser(userId)
  })

  ipcMain.handle('labels:findByProjectId', (_e, projectId: string) => {
    return getRepos().labels.findByProjectId(projectId)
  })

  ipcMain.handle('labels:findByName', (_e, userId: string, name: string) => {
    return getRepos().labels.findByName(userId, name) ?? null
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

  ipcMain.handle('labels:hardDelete', (_e, id: string) => {
    return getRepos().labels.hardDelete(id)
  })

  ipcMain.handle(
    'labels:findAllByUser',
    (_e, userId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().labels.findAllByUser(userId, options ?? {})
    }
  )

  ipcMain.handle('labels:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().labels.findMaxUpdatedAt(userId)
  })

  ipcMain.handle(
    'labels:applyRemote',
    (_e, label: Parameters<Repositories['labels']['applyRemote']>[0]) => {
      return getRepos().labels.applyRemote(label)
    }
  )

  ipcMain.handle('labels:consolidate', (_e, fromId: string, toId: string) => {
    return getRepos().labels.consolidate(fromId, toId)
  })

  ipcMain.handle('labels:removeFromProject', (_e, projectId: string, labelId: string) => {
    return getRepos().labels.removeFromProject(projectId, labelId)
  })

  ipcMain.handle('labels:addToProject', (_e, projectId: string, labelId: string) => {
    return getRepos().labels.addToProject(projectId, labelId)
  })

  ipcMain.handle('labels:getProjectLabelsForOwner', (_e, userId: string) => {
    return getRepos().labels.getProjectLabelsForOwner(userId)
  })

  ipcMain.handle('labels:getProjectLabelsForSharedProjects', () => {
    return getRepos().labels.getProjectLabelsForSharedProjects()
  })

  ipcMain.handle(
    'labels:applyRemoteProjectLabel',
    (
      _e,
      remote: {
        project_id: string
        label_id: string
        created_at: string | null
        deleted_at: string | null
      }
    ) => {
      return getRepos().labels.applyRemoteProjectLabel(remote)
    }
  )

  ipcMain.handle('labels:findByTaskId', (_e, taskId: string) => {
    return getRepos().labels.findByTaskId(taskId)
  })

  ipcMain.handle('labels:findTaskLabelsByProject', (_e, projectId: string) => {
    return getRepos().labels.findTaskLabelsByProject(projectId)
  })

  ipcMain.handle('labels:reorder', (_e, labelIds: string[]) => {
    return getRepos().labels.reorder(labelIds)
  })

  ipcMain.handle('labels:findAllWithUsage', (_e, userId: string) => {
    return getRepos().labels.findAllWithUsage(userId)
  })

  ipcMain.handle('labels:findProjectsUsingLabel', (_e, userId: string, labelId: string) => {
    return getRepos().labels.findProjectsUsingLabel(userId, labelId)
  })

  ipcMain.handle('labels:findActiveLabelsForProject', (_e, projectId: string) => {
    return getRepos().labels.findActiveLabelsForProject(projectId)
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

  ipcMain.handle('projects:hardDelete', (_e, id: string) => {
    return getRepos().projects.hardDelete(id)
  })

  ipcMain.handle(
    'projects:findAllByOwner',
    (_e, ownerId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().projects.findAllByOwner(ownerId, options ?? {})
    }
  )

  ipcMain.handle('projects:findMaxUpdatedAt', (_e, ownerId: string) => {
    return getRepos().projects.findMaxUpdatedAt(ownerId)
  })

  ipcMain.handle(
    'projects:applyRemote',
    (_e, project: Parameters<Repositories['projects']['applyRemote']>[0]) => {
      return getRepos().projects.applyRemote(project)
    }
  )

  ipcMain.handle('projects:list', (_e, userId: string) => {
    return getRepos().projects.getProjectsForUser(userId)
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

  ipcMain.handle('projects:updateMember', (_e, projectId: string, userId: string, updates: { display_color?: string | null; display_initials?: string | null }) => {
    return getRepos().projects.updateMember(projectId, userId, updates)
  })

  ipcMain.handle('projects:getMembers', (_e, projectId: string) => {
    return getRepos().projects.getMembers(projectId)
  })

  ipcMain.handle('projects:getProjectsForUser', (_e, userId: string) => {
    return getRepos().projects.getProjectsForUser(userId)
  })

  ipcMain.handle(
    'projects:updateSidebarOrder',
    (_e, updates: Array<{ id: string; sidebar_order: number }>) => {
      return getRepos().projects.updateSidebarOrder(updates)
    }
  )

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

  ipcMain.handle('statuses:hardDelete', (_e, id: string) => {
    return getRepos().statuses.hardDelete(id)
  })

  ipcMain.handle(
    'statuses:findAllByProject',
    (_e, projectId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().statuses.findAllByProject(projectId, options ?? {})
    }
  )

  ipcMain.handle('statuses:findMaxUpdatedAt', (_e, projectId: string) => {
    return getRepos().statuses.findMaxUpdatedAt(projectId)
  })

  ipcMain.handle(
    'statuses:applyRemote',
    (_e, status: Parameters<Repositories['statuses']['applyRemote']>[0]) => {
      return getRepos().statuses.applyRemote(status)
    }
  )

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

  ipcMain.handle('activityLog:getRecent', (_e, userId: string, limit: number) => {
    return getRepos().activityLog.getRecent(userId, limit)
  })

  // ── Settings ───────────────────────────────────────────────────────
  ipcMain.handle('settings:get', (_e, userId: string, key: string) => {
    return getRepos().settings.get(userId, key)
  })

  ipcMain.handle('settings:set', (_e, userId: string, key: string, value: string | null) => {
    return getRepos().settings.set(userId, key, value)
  })

  ipcMain.handle('settings:getAll', (_e, userId: string) => {
    return getRepos().settings.getAll(userId)
  })

  ipcMain.handle(
    'settings:getMultiple',
    (_e, userId: string, keys: string[]) => {
      return getRepos().settings.getMultiple(userId, keys)
    }
  )

  ipcMain.handle(
    'settings:setMultiple',
    (_e, userId: string, settings: Parameters<Repositories['settings']['setMultiple']>[1]) => {
      return getRepos().settings.setMultiple(userId, settings)
    }
  )

  ipcMain.handle('settings:delete', (_e, userId: string, key: string) => {
    return getRepos().settings.delete(userId, key)
  })

  ipcMain.handle('settings:hardDelete', (_e, userId: string, key: string) => {
    return getRepos().settings.hardDelete(userId, key)
  })

  ipcMain.handle(
    'settings:findAllByUser',
    (_e, userId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().settings.findAllByUser(userId, options ?? {})
    }
  )

  ipcMain.handle('settings:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().settings.findMaxUpdatedAt(userId)
  })

  ipcMain.handle(
    'settings:applyRemote',
    (_e, setting: Parameters<Repositories['settings']['applyRemote']>[0]) => {
      return getRepos().settings.applyRemote(setting)
    }
  )

  ipcMain.handle('settings:findRaw', (_e, userId: string, key: string) => {
    return getRepos().settings.findRaw(userId, key) ?? null
  })

  // ── Themes ─────────────────────────────────────────────────────────
  ipcMain.handle('themes:findById', (_e, id: string) => {
    return getRepos().themes.findById(id) ?? null
  })

  ipcMain.handle('themes:list', (_e, userId: string) => {
    return getRepos().themes.list(userId)
  })

  ipcMain.handle('themes:listByMode', (_e, mode: string, userId: string) => {
    return getRepos().themes.listByMode(mode, userId)
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

  ipcMain.handle('themes:hardDelete', (_e, id: string) => {
    return getRepos().themes.hardDelete(id)
  })

  ipcMain.handle(
    'themes:findAllByOwner',
    (_e, ownerId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().themes.findAllByOwner(ownerId, options ?? {})
    }
  )

  ipcMain.handle('themes:findMaxUpdatedAt', (_e, ownerId: string) => {
    return getRepos().themes.findMaxUpdatedAt(ownerId)
  })

  ipcMain.handle(
    'themes:applyRemote',
    (_e, theme: Parameters<Repositories['themes']['applyRemote']>[0]) => {
      return getRepos().themes.applyRemote(theme)
    }
  )

  ipcMain.handle('themes:getConfig', (_e, id: string) => {
    return getRepos().themes.getConfig(id) ?? null
  })

  // ── Project Templates ────────────────────────────────────────────
  ipcMain.handle('projectTemplates:findById', (_e, id: string) => {
    return getRepos().projectTemplates.findById(id) ?? null
  })

  ipcMain.handle('projectTemplates:findByOwnerId', (_e, ownerId: string) => {
    return getRepos().projectTemplates.findByOwnerId(ownerId)
  })

  ipcMain.handle('projectTemplates:findAll', (_e, userId: string) => {
    return getRepos().projectTemplates.findByOwnerId(userId)
  })

  ipcMain.handle(
    'projectTemplates:create',
    (_e, input: Parameters<Repositories['projectTemplates']['create']>[0]) => {
      return getRepos().projectTemplates.create(input)
    }
  )

  ipcMain.handle(
    'projectTemplates:update',
    (_e, id: string, input: Parameters<Repositories['projectTemplates']['update']>[1]) => {
      return getRepos().projectTemplates.update(id, input) ?? null
    }
  )

  ipcMain.handle('projectTemplates:delete', (_e, id: string) => {
    return getRepos().projectTemplates.delete(id)
  })

  ipcMain.handle('projectTemplates:hardDelete', (_e, id: string) => {
    return getRepos().projectTemplates.hardDelete(id)
  })

  ipcMain.handle(
    'projectTemplates:findAllByOwner',
    (_e, ownerId: string, options?: { includeTombstones?: boolean }) => {
      return getRepos().projectTemplates.findAllByOwner(ownerId, options ?? {})
    }
  )

  ipcMain.handle('projectTemplates:findMaxUpdatedAt', (_e, ownerId: string) => {
    return getRepos().projectTemplates.findMaxUpdatedAt(ownerId)
  })

  ipcMain.handle(
    'projectTemplates:applyRemote',
    (_e, template: Parameters<Repositories['projectTemplates']['applyRemote']>[0]) => {
      return getRepos().projectTemplates.applyRemote(template)
    }
  )

  // ── Quick Add ─────────────────────────────────────────────────────
  ipcMain.handle('quickadd:hide', () => {
    hideQuickAddWindow()
  })

  ipcMain.handle('quickadd:notifyTaskCreated', (event) => {
    // Broadcast tasks-changed to all windows except the sender
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== event.sender) {
        win.webContents.send('tasks-changed')
      }
    }
  })

  ipcMain.handle(
    'quickadd:updateShortcut',
    (_e, accelerator: string): { success: boolean; error?: string; reservedBy?: string } => {
      // Check for reserved macOS shortcuts
      const reservedBy = getReservedShortcutName(accelerator)
      if (reservedBy) {
        return {
          success: false,
          error: `This shortcut is reserved by macOS (${reservedBy}) and can't be used.`,
          reservedBy
        }
      }

      // Try to register the new shortcut
      const result = registerQuickAddShortcut(accelerator)
      if (result.success) {
        // Persist to settings
        getRepos().settings.set('', 'quick_add_shortcut', accelerator)
      }
      return result
    }
  )

  ipcMain.handle(
    'app-toggle:updateShortcut',
    (_e, accelerator: string): { success: boolean; error?: string; reservedBy?: string } => {
      const reservedBy = getReservedShortcutName(accelerator)
      if (reservedBy) {
        return {
          success: false,
          error: `This shortcut is reserved by macOS (${reservedBy}) and can't be used.`,
          reservedBy
        }
      }

      const result = registerAppToggleShortcut(accelerator)
      if (result.success) {
        getRepos().settings.set('', 'app_toggle_shortcut', accelerator)
      }
      return result
    }
  )

  // ── Tray ──────────────────────────────────────────────────────────
  ipcMain.handle('tray:setUserId', (_e, userId: string) => {
    setTrayUserId(userId)
  })

  ipcMain.handle('tray:refresh', () => {
    refreshTray()
  })

  // ── Timer ──────────────────────────────────────────────────────────
  ipcMain.handle('timer:updateTimer', (_e, state: TimerTrayState) => {
    setTimerState(state)
  })

  ipcMain.handle('timer:clearTimer', () => {
    clearTimerState()
  })

  ipcMain.handle('timer:minimizeToTray', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.hide()
    }
  })

  ipcMain.handle('timer:navigateToTask', (_e, taskId: string) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      win.webContents.send('tray:navigate-to-task', taskId)
    }
  })

  // ── Attachments ─────────────────────────────────────────────────────
  ipcMain.handle('attachments:findByTaskId', (_e, taskId: string) => {
    return getRepos().attachments.findByTaskId(taskId)
  })

  ipcMain.handle('attachments:createFromFile', (_e, taskId: string, filePath: string) => {
    const fileData = readFileSync(filePath)
    const stat = statSync(filePath)
    const filename = basename(filePath)
    const ext = extname(filename)
    return getRepos().attachments.create({
      id: crypto.randomUUID(),
      task_id: taskId,
      filename,
      mime_type: getMimeType(ext),
      size_bytes: stat.size,
      file_data: fileData
    })
  })

  ipcMain.handle('attachments:open', async (_e, id: string) => {
    const data = getRepos().attachments.getFileData(id)
    if (!data) return
    const tmpPath = join(app.getPath('temp'), data.filename)
    writeFileSync(tmpPath, data.file_data)
    await shell.openPath(tmpPath)
  })

  ipcMain.handle('attachments:delete', (_e, id: string) => {
    return getRepos().attachments.delete(id)
  })

  // ── Shell ────────────────────────────────────────────────────────────

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    return shell.openExternal(url)
  })

  // ── Launch at Login ─────────────────────────────────────────────────

  ipcMain.handle('app:getLoginItemSettings', () => {
    return app.getLoginItemSettings()
  })

  ipcMain.handle('app:setLoginItemSettings', (_e, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin })
  })

  ipcMain.handle('app:getDatabasePath', () => {
    return getDatabasePath()
  })

  ipcMain.handle('app:getChangelog', async () => {
    // Always sync from Supabase first to get the latest release notes
    try {
      const { syncReleaseNotes } = await import('./services/ReleaseNotesService')
      await syncReleaseNotes()
    } catch { /* sync failed — fall through to cache */ }
    // Return whatever is in the cache (fresh from sync, or stale if offline)
    try {
      return getRepos().settings.get('', 'whats_new') ?? ''
    } catch {
      return ''
    }
  })

  // ── Notifications ──────────────────────────────────────────────────
  ipcMain.handle('notifications:findAll', (_e, limit?: number) => {
    return getRepos().notifications.findAll(limit)
  })

  ipcMain.handle('notifications:findUnread', () => {
    return getRepos().notifications.findUnread()
  })

  ipcMain.handle('notifications:getUnreadCount', () => {
    return getRepos().notifications.getUnreadCount()
  })

  ipcMain.handle(
    'notifications:create',
    (_e, input: Parameters<Repositories['notifications']['create']>[0]) => {
      return getRepos().notifications.create(input)
    }
  )

  ipcMain.handle('notifications:markAsRead', (_e, id: string) => {
    return getRepos().notifications.markAsRead(id)
  })

  ipcMain.handle('notifications:markAllAsRead', () => {
    return getRepos().notifications.markAllAsRead()
  })

  ipcMain.handle('notifications:deleteNotification', (_e, id: string) => {
    return getRepos().notifications.delete(id)
  })

  ipcMain.handle('notifications:deleteAll', () => {
    return getRepos().notifications.deleteAll()
  })

  // ── Sync Queue ────────────────────────────────────────────────────
  ipcMain.handle('sync:getQueue', () => {
    return getRepos().syncQueue.findAll()
  })

  ipcMain.handle('sync:enqueue', (_e, tableName: string, rowId: string, operation: string, payload: string) => {
    return getRepos().syncQueue.enqueue(tableName, rowId, operation as 'INSERT' | 'UPDATE' | 'DELETE', payload)
  })

  ipcMain.handle('sync:dequeue', (_e, id: string) => {
    return getRepos().syncQueue.dequeue(id)
  })

  ipcMain.handle('sync:clear', () => {
    return getRepos().syncQueue.clear()
  })

  ipcMain.handle('sync:count', () => {
    return getRepos().syncQueue.count()
  })

  // ── Sync Meta (high-water marks) ──────────────────────────────────
  ipcMain.handle(
    'syncMeta:getHighWater',
    (
      _e,
      userId: string,
      scopeId: string,
      tableName: import('./repositories/SyncMetaRepository').SyncTableName
    ) => {
      return getRepos().syncMeta.getHighWater(userId, scopeId, tableName)
    }
  )

  ipcMain.handle(
    'syncMeta:setHighWater',
    (
      _e,
      userId: string,
      scopeId: string,
      tableName: import('./repositories/SyncMetaRepository').SyncTableName,
      isoTs: string
    ) => {
      return getRepos().syncMeta.setHighWater(userId, scopeId, tableName, isoTs)
    }
  )

  ipcMain.handle(
    'syncMeta:getLastReconciledAt',
    (
      _e,
      userId: string,
      scopeId: string,
      tableName: import('./repositories/SyncMetaRepository').SyncTableName
    ) => {
      return getRepos().syncMeta.getLastReconciledAt(userId, scopeId, tableName)
    }
  )

  ipcMain.handle(
    'syncMeta:setLastReconciledAt',
    (
      _e,
      userId: string,
      scopeId: string,
      tableName: import('./repositories/SyncMetaRepository').SyncTableName,
      isoTs: string
    ) => {
      return getRepos().syncMeta.setLastReconciledAt(userId, scopeId, tableName, isoTs)
    }
  )

  ipcMain.handle('syncMeta:clearAll', (_e, userId: string) => {
    return getRepos().syncMeta.clearAll(userId)
  })

  // ── Release Notes ──────────────────────────────────────────────────
  // ── Project Areas ────────────────────────────────────────────────
  ipcMain.handle('projectAreas:findByUserId', (_e, userId: string) => {
    return getRepos().projectAreas.findByUserId(userId)
  })

  ipcMain.handle('projectAreas:create', (_e, input: import('../shared/types').CreateProjectAreaInput) => {
    return getRepos().projectAreas.create(input)
  })

  ipcMain.handle('projectAreas:update', (_e, id: string, input: import('../shared/types').UpdateProjectAreaInput) => {
    return getRepos().projectAreas.update(id, input)
  })

  ipcMain.handle('projectAreas:delete', (_e, id: string) => {
    return getRepos().projectAreas.delete(id)
  })

  ipcMain.handle('projectAreas:reorder', (_e, areaIds: string[]) => {
    return getRepos().projectAreas.reorder(areaIds)
  })

  ipcMain.handle('projectAreas:assignProject', (_e, projectId: string, areaId: string | null) => {
    return getRepos().projectAreas.assignProject(projectId, areaId)
  })

  ipcMain.handle('projectAreas:hardDelete', (_e, id: string) => {
    return getRepos().projectAreas.hardDelete(id)
  })

  ipcMain.handle(
    'projectAreas:findAllByUser',
    (
      _e,
      userId: string,
      options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
    ) => {
      return getRepos().projectAreas.findAllByUser(userId, options)
    }
  )

  ipcMain.handle('projectAreas:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().projectAreas.findMaxUpdatedAt(userId)
  })

  ipcMain.handle(
    'projectAreas:applyRemote',
    (_e, remote: import('../shared/types').ProjectArea) => {
      return getRepos().projectAreas.applyRemote(remote)
    }
  )

  // ── Stats ────────────────────────────────────────────────────────
  ipcMain.handle('stats:completions', (_e, userId: string, projectIds: string[] | null, startDate: string, endDate: string) => {
    return getRepos().tasks.getCompletionStats(userId, projectIds, startDate, endDate)
  })

  ipcMain.handle('stats:streaks', (_e, userId: string) => {
    return getRepos().tasks.getStreakStats(userId)
  })

  ipcMain.handle('stats:focus', (_e, userId: string, projectIds: string[] | null, startDate: string, endDate: string) => {
    return getRepos().activityLog.getFocusStats(userId, projectIds?.[0] ?? null, startDate, endDate)
  })

  ipcMain.handle('stats:heatmap', (_e, userId: string, startDate: string, endDate: string) => {
    return getRepos().activityLog.getActivityHeatmap(userId, startDate, endDate)
  })

  ipcMain.handle('stats:focusTaskList', (_e, userId: string, startDate: string, endDate: string, projectIds: string[] | null) => {
    return getRepos().activityLog.getFocusTaskList(userId, startDate, endDate, projectIds)
  })

  ipcMain.handle('stats:taskList', (_e, userId: string, filter: string, projectIds: string[] | null, startDate?: string, endDate?: string) => {
    return getRepos().tasks.getStatsTaskList(userId, filter as 'completed_today' | 'completed_week' | 'completed_range' | 'open' | 'overdue', projectIds, startDate, endDate)
  })

  ipcMain.handle('stats:summary', (_e, userId: string, projectIds: string[] | null) => {
    return getRepos().tasks.getTaskSummaryStats(userId, projectIds)
  })

  ipcMain.handle('stats:priorityBreakdown', (_e, userId: string, projectIds: string[] | null) => {
    return getRepos().tasks.getPriorityBreakdown(userId, projectIds)
  })

  ipcMain.handle('stats:completionsByDayOfWeek', (_e, userId: string, projectIds: string[] | null, startDate: string, endDate: string) => {
    return getRepos().tasks.getCompletionsByDayOfWeek(userId, projectIds, startDate, endDate)
  })

  ipcMain.handle('stats:projectBreakdown', (_e, userId: string) => {
    return getRepos().tasks.getProjectBreakdown(userId)
  })

  ipcMain.handle('stats:cookieBalance', (_e, userId: string, startDate: string, endDate: string) => {
    return getRepos().activityLog.getCookieStats(userId, startDate, endDate)
  })

  // ── Saved Views ──────────────────────────────────────────────────
  ipcMain.handle('savedViews:findById', (_e, id: string) => {
    return getRepos().savedViews.findById(id) ?? null
  })

  ipcMain.handle('savedViews:findByUserId', (_e, userId: string) => {
    return getRepos().savedViews.findByUserId(userId)
  })

  ipcMain.handle('savedViews:create', (_e, input: import('../shared/types').CreateSavedViewInput) => {
    return getRepos().savedViews.create(input)
  })

  ipcMain.handle('savedViews:update', (_e, id: string, input: import('../shared/types').UpdateSavedViewInput) => {
    return getRepos().savedViews.update(id, input)
  })

  ipcMain.handle('savedViews:delete', (_e, id: string) => {
    return getRepos().savedViews.delete(id)
  })

  ipcMain.handle('savedViews:reorder', (_e, viewIds: string[]) => {
    return getRepos().savedViews.reorder(viewIds)
  })

  ipcMain.handle('savedViews:countMatching', (_e, filterConfig: string, userId: string) => {
    return getRepos().savedViews.countMatchingTasks(filterConfig, userId)
  })

  ipcMain.handle('savedViews:hardDelete', (_e, id: string) => {
    return getRepos().savedViews.hardDelete(id)
  })

  ipcMain.handle(
    'savedViews:findAllByUser',
    (
      _e,
      userId: string,
      options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
    ) => {
      return getRepos().savedViews.findAllByUser(userId, options)
    }
  )

  ipcMain.handle('savedViews:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().savedViews.findMaxUpdatedAt(userId)
  })

  ipcMain.handle('savedViews:applyRemote', (_e, remote: import('../shared/types').SavedView) => {
    return getRepos().savedViews.applyRemote(remote)
  })

  ipcMain.handle('releaseNotes:sync', async () => {
    try {
      const { syncReleaseNotes } = await import('./services/ReleaseNotesService')
      return await syncReleaseNotes()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, count: 0, cached: 0, error: `load failed: ${msg}` }
    }
  })

  ipcMain.handle('releaseNotes:fetchVersion', async (_e, version: string) => {
    const { fetchVersionNotes } = await import('./services/ReleaseNotesService')
    return fetchVersionNotes(version)
  })

  ipcMain.handle('fs:showOpenDialog', async (_e, options?: { filters?: Array<{ name: string; extensions: string[] }>; title?: string; multiSelections?: boolean }) => {
    const win = getMainWindow()
    if (!win) return { canceled: true, filePaths: [] }
    const multi = options?.multiSelections ?? true
    const result = await dialog.showOpenDialog(win, {
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      title: options?.title ?? 'Select files to attach',
      filters: options?.filters
    })
    return result
  })

  ipcMain.handle('fs:showSaveDialog', async (_e, options: { defaultPath?: string; contents: string }) => {
    const win = getMainWindow()
    if (!win) return { canceled: true }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: options.defaultPath,
      filters: [{ name: 'ToDoozy Theme', extensions: ['json'] }],
      title: 'Export theme'
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      writeFileSync(result.filePath, options.contents, 'utf8')
      return { canceled: false, filePath: result.filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write failed'
      return { canceled: false, error: message }
    }
  })

  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    try {
      const contents = readFileSync(filePath, 'utf8')
      return { ok: true, contents }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Read failed'
      return { ok: false, error: message }
    }
  })
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.md': 'text/markdown'
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}
