import { fileURLToPath } from 'node:url'
import { ipcMain, safeStorage, BrowserWindow, dialog, shell } from 'electron'
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, mkdtempSync } from 'fs'
import keytar from 'keytar'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { getDatabase, switchDatabase, getDatabasePath, clearDatabaseUserId } from './database'
import { createRepositories, type Repositories } from './repositories'
import { hideQuickAddWindow } from './quick-add'
import { registerQuickAddShortcut, registerAppToggleShortcut } from './index'
import { is } from '@electron-toolkit/utils'
import { getReservedShortcutName } from '../shared/shortcut-utils'
import { setTrayUserId, refreshTray, setTimerState, clearTimerState } from './tray'
import { getMainWindow } from './index'
import type { TimerTrayState } from '../preload/index.d'
import {
  storeSession as storeSessionToDisk,
  loadSession as loadSessionFromDisk,
  clearSession as clearSessionFromDisk,
  type SessionStoreDeps
} from './auth/sessionStore'
import { validateExternalUrl } from './shell-url'
import { assertTrustedSender } from './navigation-security'
import { DatabaseSync } from 'node:sqlite'
import { DiagnosticsJournal } from './services/DiagnosticsJournal'
import { chmodSync } from 'node:fs'
import { sanitizeHostMetrics } from '../shared/hostMetrics'

let diagnosticsJournal: DiagnosticsJournal | null = null
function getDiagnosticsJournal(): DiagnosticsJournal {
  if (!diagnosticsJournal) {
    const path = join(app.getPath('userData'), 'diagnostics.db')
    const db = new DatabaseSync(path)
    chmodSync(path, 0o600)
    diagnosticsJournal = new DiagnosticsJournal(db)
  }
  return diagnosticsJournal
}

let repos: Repositories | null = null
let databaseGeneration = 0
let databaseUserId: string | null = null
const databaseHandlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>()
function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  if (channel === 'activityLog:create' || channel === 'activityLog:applyRemote' || /^(tasks|statuses|projects|labels|users|settings|themes|savedViews|projectAreas|projectTemplates|sync|syncMeta|notifications|attachments|stats):/.test(channel)) databaseHandlers.set(channel, listener)
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event)
    return listener(event, ...args)
  })
}

function getRepos(): Repositories {
  if (!repos) {
    repos = createRepositories(getDatabase(), databaseUserId)
  }
  return repos
}

// ── Auth token storage using safeStorage ──────────────────────────────
const getTokenPath = (): string => {
  const suffix = is.dev ? '.dev' : ''
  return join(app.getPath('userData'), `.auth-session${suffix}`)
}

const getSavedEmailPath = (): string => {
  const suffix = is.dev ? '.dev' : ''
  return join(app.getPath('userData'), `saved-email${suffix}.json`)
}
const KEYTAR_SERVICE = 'ToDoozy'

// Only warn the renderer once per session that the OS keychain is unavailable.
let sessionNotPersistedWarned = false

function sessionStoreDeps(): SessionStoreDeps {
  return {
    safeStorage,
    fs: { existsSync, readFileSync, writeFileSync, unlinkSync },
    tokenPath: getTokenPath(),
    logger: {
      warn: (message) => console.warn(message),
      error: (message, err) => console.error(message, err)
    }
  }
}

/** Notify the renderer (once) that the session will not persist across restarts. */
function warnSessionNotPersisted(): void {
  if (sessionNotPersistedWarned) return
  sessionNotPersistedWarned = true
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('auth:session-not-persisted')
  }
}

function storeEncryptedSession(sessionJson: string): void {
  const result = storeSessionToDisk(sessionJson, sessionStoreDeps())
  if (result.encryptionUnavailable) {
    warnSessionNotPersisted()
  }
}

function getEncryptedSession(): string | null {
  return loadSessionFromDisk(sessionStoreDeps())
}

function clearEncryptedSession(): void {
  clearSessionFromDisk(sessionStoreDeps())
}


function registerAuthHandlers(): void {
  handle('auth:storeSession', (_e, sessionJson: string) => {
    storeEncryptedSession(sessionJson)
  })

  handle('auth:getSession', () => {
    return getEncryptedSession()
  })

  handle('auth:clearSession', () => {
    databaseGeneration++
    databaseUserId = null
    clearDatabaseUserId()
    repos = null
    clearEncryptedSession()
  })

  handle('auth:saveEmail', (_e, email: string) => {
    try {
      writeFileSync(getSavedEmailPath(), JSON.stringify({ email }), 'utf-8')
    } catch (err) {
      console.error('Failed to save email:', err)
    }
  })

  handle('auth:getSavedEmail', () => {
    const path = getSavedEmailPath()
    if (!existsSync(path)) return null
    try {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw) as { email?: string }
      return parsed.email ?? null
    } catch {
      return null
    }
  })

  handle('auth:savePassword', async (_e, email: string, password: string) => {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, email, password)
    } catch (err) {
      console.error('Failed to save password to Keychain:', err)
    }
  })

  handle('auth:getSavedPassword', async (_e, email: string) => {
    try {
      return await keytar.getPassword(KEYTAR_SERVICE, email)
    } catch {
      return null
    }
  })

  handle('auth:clearCredentials', async () => {
    const path = getSavedEmailPath()
    let savedEmail: string | null = null
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8')
        savedEmail = (JSON.parse(raw) as { email?: string }).email ?? null
        unlinkSync(path)
      } catch {
        // ignore
      }
    }
    if (savedEmail) {
      try {
        await keytar.deletePassword(KEYTAR_SERVICE, savedEmail)
      } catch {
        // ignore
      }
    }
  })

  handle('auth:switchDatabase', (_e, userId: string, email?: string) => {
    databaseGeneration++
    databaseUserId = userId
    switchDatabase(userId, email)
    // Reset repos so they use the new DB
    repos = null
  })

  handle('auth:getSupabaseConfig', () => {
    return {
      url: process.env.SUPABASE_URL ?? '',
      anonKey: process.env.SUPABASE_ANON_KEY ?? ''
    }
  })

  handle('auth:openOAuthWindow', async (_e, url: string) => {
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
  handle('diagnostics:append', (_event, summary: unknown) => getDiagnosticsJournal().append(summary, app.getVersion()))
  handle('diagnostics:recent', () => getDiagnosticsJournal().recent())
  handle('diagnostics:hostRecent', () => {
    const path = join(app.getPath('userData'),'host-metrics','metrics.sqlite')
    if (!existsSync(path)) return []
    const db = new DatabaseSync(path,{readOnly:true})
    try {
      return (db.prepare('SELECT summary FROM samples WHERE observed_at >= ? ORDER BY id DESC LIMIT 100').all(new Date(Date.now()-7*86400_000).toISOString()) as Array<{summary:string}>)
        .reverse().flatMap(({summary})=>{try{return [sanitizeHostMetrics(JSON.parse(summary))]}catch{return []}})
    } finally { db.close() }
  })
  handle('sync:captureContext', () => ({ generation: databaseGeneration, userId: databaseUserId }))
  handle('sync:invokeContext', (event, context, channel: string, args: unknown[]) => {
    if (context.generation !== databaseGeneration || context.userId !== databaseUserId) throw new Error('Sync database changed')
    const listener = databaseHandlers.get(channel)
    if (!listener) throw new Error('Unsupported sync database operation')
    return listener(event, ...args)
  })
  registerAuthHandlers()

  // ── Tasks ──────────────────────────────────────────────────────────
  handle('tasks:rebaseSyncVersion', (_e, id: string, expectedAt: string, appliedAt: string) => getRepos().tasks.rebaseSyncVersion(id, expectedAt, appliedAt))

  handle('tasks:findById', (_e, id: string) => {
    return getRepos().tasks.findById(id) ?? null
  })

  handle('tasks:findByProjectId', (_e, projectId: string) => {
    return getRepos().tasks.findByProjectId(projectId)
  })

  handle('tasks:findByStatusId', (_e, statusId: string) => {
    return getRepos().tasks.findByStatusId(statusId)
  })

  handle('tasks:findMyDay', (_e, userId: string) => {
    return getRepos().tasks.findMyDay(userId)
  })

  handle('tasks:autoAddMyDay', (_e, userId: string, mode: string) => {
    return getRepos().tasks.autoAddMyDayTasks(userId, mode as 'off' | 'due_today' | 'due_today_or_overdue')
  })

  handle('tasks:findArchived', (_e, projectId: string) => {
    return getRepos().tasks.findArchived(projectId)
  })

  handle('tasks:findTemplates', (_e, projectId: string) => {
    return getRepos().tasks.findTemplates(projectId)
  })

  handle('tasks:findSubtasks', (_e, parentId: string) => {
    return getRepos().tasks.findSubtasks(parentId)
  })

  handle('tasks:getSubtaskCount', (_e, parentId: string) => {
    return getRepos().tasks.getSubtaskCount(parentId)
  })

  handle('tasks:create', (_e, input: Parameters<Repositories['tasks']['create']>[0]) => {
    return getRepos().tasks.create(input)
  })

  handle('tasks:applyRemote', (_e, task: Parameters<Repositories['tasks']['applyRemoteTask']>[0]) => {
    return getRepos().tasks.applyRemoteTask(task)
  })

  handle(
    'tasks:update',
    (_e, id: string, input: Parameters<Repositories['tasks']['update']>[1]) => {
      return getRepos().tasks.update(id, input) ?? null
    }
  )

  handle('tasks:delete', (_e, id: string) => {
    return getRepos().tasks.delete(id)
  })

  handle('tasks:hardDelete', (_e, id: string) => {
    return getRepos().tasks.hardDelete(id)
  })

  handle(
    'tasks:findAllByProject',
    (_e, projectId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().tasks.findAllByProject(projectId, options ?? {})
    }
  )

  handle('tasks:findMaxUpdatedAt', (_e, projectId: string) => {
    return getRepos().tasks.findMaxUpdatedAt(projectId)
  })

  handle('tasks:reorder', (_e, taskIds: string[]) => {
    return getRepos().tasks.reorder(taskIds)
  })

  handle('tasks:addLabel', (_e, taskId: string, labelId: string) => {
    return getRepos().tasks.addLabel(taskId, labelId)
  })

  handle('tasks:removeLabel', (_e, taskId: string, labelId: string) => {
    return getRepos().tasks.removeLabel(taskId, labelId)
  })

  handle('tasks:applyRemoteTaskLabels', (_e, ...args: Parameters<Repositories['tasks']['applyRemoteTaskLabels']>) => getRepos().tasks.applyRemoteTaskLabels(...args))
  handle('tasks:getLabelState', (_e,taskId: string) => getRepos().tasks.getLabelState(taskId))
  handle('tasks:acknowledgeLabelState', (_e,...args: Parameters<Repositories['tasks']['acknowledgeLabelState']>) => getRepos().tasks.acknowledgeLabelState(...args))

  handle('tasks:getLabels', (_e, taskId: string) => {
    return getRepos().tasks.getLabels(taskId)
  })

  handle('tasks:getTaskLabelsForUser', (_e, userId: string) => {
    return getRepos().tasks.getTaskLabelsForUser(userId)
  })

  handle('tasks:getTaskLabelsForSharedProjects', () => {
    return getRepos().tasks.getTaskLabelsForSharedProjects()
  })

  handle('tasks:duplicate', (_e, id: string, newId: string) => {
    return getRepos().tasks.duplicate(id, newId) ?? null
  })

  handle('tasks:findAllTemplates', (_e, userId: string) => {
    return getRepos().tasks.findAllTemplates(userId)
  })

  handle('tasks:saveAsTemplate', (_e, id: string, newId: string) => {
    return getRepos().tasks.saveAsTemplate(id, newId) ?? null
  })

  handle('tasks:completeRecurring', (_e, taskId: string) => {
    return getRepos().tasks.completeRecurringTask(taskId)
  })

  // ── Labels ─────────────────────────────────────────────────────────
  handle('labels:findById', (_e, id: string) => {
    return getRepos().labels.findById(id) ?? null
  })

  handle('labels:findByIds', (_e, ids: string[]) => {
    return getRepos().labels.findByIds(ids)
  })

  handle('labels:findAll', (_e, userId: string) => {
    return getRepos().labels.findAllForUser(userId)
  })

  handle('labels:findByProjectId', (_e, projectId: string) => {
    return getRepos().labels.findByProjectId(projectId)
  })

  handle('labels:findByName', (_e, userId: string, name: string) => {
    return getRepos().labels.findByName(userId, name) ?? null
  })

  handle(
    'labels:adopt',
    (_e, userId: string, foreignLabel: Parameters<Repositories['labels']['adopt']>[1]) => {
      return getRepos().labels.adopt(userId, foreignLabel)
    }
  )

  handle(
    'labels:create',
    (_e, input: Parameters<Repositories['labels']['create']>[0]) => {
      return getRepos().labels.create(input)
    }
  )

  handle(
    'labels:update',
    (_e, id: string, input: Parameters<Repositories['labels']['update']>[1]) => {
      return getRepos().labels.update(id, input) ?? null
    }
  )

  handle('labels:delete', (_e, id: string) => {
    return getRepos().labels.delete(id)
  })

  handle('labels:hardDelete', (_e, id: string) => {
    return getRepos().labels.hardDelete(id)
  })

  handle(
    'labels:findAllByUser',
    (_e, userId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().labels.findAllByUser(userId, options ?? {})
    }
  )

  handle('labels:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().labels.findMaxUpdatedAt(userId)
  })

  handle(
    'labels:applyRemote',
    (_e, label: Parameters<Repositories['labels']['applyRemote']>[0]) => {
      return getRepos().labels.applyRemote(label)
    }
  )

  handle('labels:consolidate', (_e, fromId: string, canonical: Parameters<Repositories['labels']['consolidate']>[1]) => {
    return getRepos().labels.consolidate(fromId, canonical)
  })

  handle('labels:removeFromProject', (_e, projectId: string, labelId: string) => {
    return getRepos().labels.removeFromProject(projectId, labelId)
  })

  handle('labels:addToProject', (_e, projectId: string, labelId: string) => {
    return getRepos().labels.addToProject(projectId, labelId)
  })

  handle('labels:getProjectLabelsForOwner', (_e, userId: string) => {
    return getRepos().labels.getProjectLabelsForOwner(userId)
  })

  handle('labels:getProjectLabelsForSharedProjects', () => {
    return getRepos().labels.getProjectLabelsForSharedProjects()
  })

  handle(
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

  handle(
    'labels:softDeleteTaskLabelsForProjectLabel',
    (_e, projectId: string, labelId: string) => {
      return getRepos().labels.softDeleteTaskLabelsForProjectLabel(projectId, labelId)
    }
  )

  handle('labels:findByTaskId', (_e, taskId: string) => {
    return getRepos().labels.findByTaskId(taskId)
  })

  handle('labels:findTaskLabelsByProject', (_e, projectId: string) => {
    return getRepos().labels.findTaskLabelsByProject(projectId)
  })

  handle('labels:reorder', (_e, labelIds: string[]) => {
    return getRepos().labels.reorder(labelIds)
  })

  handle('labels:findAllWithUsage', (_e, userId: string) => {
    return getRepos().labels.findAllWithUsage(userId)
  })

  handle('labels:findProjectsUsingLabel', (_e, userId: string, labelId: string) => {
    return getRepos().labels.findProjectsUsingLabel(userId, labelId)
  })

  handle('labels:findActiveLabelsForProject', (_e, projectId: string) => {
    return getRepos().labels.findActiveLabelsForProject(projectId)
  })

  // ── Projects ───────────────────────────────────────────────────────
  handle('projects:findById', (_e, id: string) => {
    return getRepos().projects.findById(id) ?? null
  })

  handle('projects:findByOwnerId', (_e, ownerId: string) => {
    return getRepos().projects.findByOwnerId(ownerId)
  })

  handle('projects:findDefault', (_e, ownerId: string) => {
    return getRepos().projects.findDefault(ownerId) ?? null
  })

  handle(
    'projects:create',
    (_e, input: Parameters<Repositories['projects']['create']>[0]) => {
      return getRepos().projects.create(input)
    }
  )

  handle(
    'projects:update',
    (_e, id: string, input: Parameters<Repositories['projects']['update']>[1]) => {
      return getRepos().projects.update(id, input) ?? null
    }
  )

  handle('projects:delete', (_e, id: string) => {
    return getRepos().projects.delete(id)
  })

  handle('projects:hardDelete', (_e, id: string) => {
    return getRepos().projects.hardDelete(id)
  })

  handle(
    'projects:findAllByOwner',
    (_e, ownerId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().projects.findAllByOwner(ownerId, options ?? {})
    }
  )

  handle('projects:findMaxUpdatedAt', (_e, ownerId: string) => {
    return getRepos().projects.findMaxUpdatedAt(ownerId)
  })

  handle(
    'projects:applyRemote',
    (_e, project: Parameters<Repositories['projects']['applyRemote']>[0]) => {
      return getRepos().projects.applyRemote(project)
    }
  )

  handle('projects:list', (_e, userId: string) => {
    return getRepos().projects.getProjectsForUser(userId)
  })

  handle(
    'projects:addMember',
    (_e, projectId: string, userId: string, role: string, invitedBy?: string) => {
      return getRepos().projects.addMember(projectId, userId, role, invitedBy)
    }
  )

  handle('projects:removeMember', (_e, projectId: string, userId: string) => {
    return getRepos().projects.removeMember(projectId, userId)
  })

  handle('projects:updateMember', (_e, projectId: string, userId: string, updates: { display_color?: string | null; display_initials?: string | null }) => {
    return getRepos().projects.updateMember(projectId, userId, updates)
  })

  handle('projects:getMembers', (_e, projectId: string) => {
    return getRepos().projects.getMembers(projectId)
  })

  handle('projects:getProjectsForUser', (_e, userId: string) => {
    return getRepos().projects.getProjectsForUser(userId)
  })

  handle(
    'projects:updateSidebarOrder',
    (_e, updates: Array<{ id: string; sidebar_order: number }>) => {
      return getRepos().projects.updateSidebarOrder(updates)
    }
  )

  handle('projects:archiveWithTasks', (_e, id: string) => {
    return getRepos().projects.archiveWithTasks(id)
  })
  handle('projects:unarchiveWithTasks', (_e, id: string) => {
    return getRepos().projects.unarchiveWithTasks(id)
  })

  // ── Statuses ───────────────────────────────────────────────────────
  handle('statuses:findById', (_e, id: string) => {
    return getRepos().statuses.findById(id) ?? null
  })

  handle('statuses:findByProjectId', (_e, projectId: string) => {
    return getRepos().statuses.findByProjectId(projectId)
  })

  handle('statuses:findDefault', (_e, projectId: string) => {
    return getRepos().statuses.findDefault(projectId) ?? null
  })

  handle('statuses:findDone', (_e, projectId: string) => {
    return getRepos().statuses.findDone(projectId) ?? null
  })

  handle(
    'statuses:create',
    (_e, input: Parameters<Repositories['statuses']['create']>[0]) => {
      return getRepos().statuses.create(input)
    }
  )

  handle(
    'statuses:update',
    (_e, id: string, input: Parameters<Repositories['statuses']['update']>[1]) => {
      return getRepos().statuses.update(id, input) ?? null
    }
  )

  handle('statuses:delete', (_e, id: string) => {
    return getRepos().statuses.delete(id)
  })

  handle('statuses:hardDelete', (_e, id: string) => {
    return getRepos().statuses.hardDelete(id)
  })

  handle(
    'statuses:findAllByProject',
    (_e, projectId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().statuses.findAllByProject(projectId, options ?? {})
    }
  )

  handle('statuses:findMaxUpdatedAt', (_e, projectId: string) => {
    return getRepos().statuses.findMaxUpdatedAt(projectId)
  })

  handle(
    'statuses:applyRemote',
    (_e, status: Parameters<Repositories['statuses']['applyRemote']>[0]) => {
      return getRepos().statuses.applyRemote(status)
    }
  )

  handle(
    'statuses:reassignAndDelete',
    (_e, statusId: string, targetStatusId: string) => {
      return getRepos().statuses.reassignAndDelete(statusId, targetStatusId)
    }
  )

  // ── Users ──────────────────────────────────────────────────────────
  handle('users:findById', (_e, id: string) => {
    return getRepos().users.findById(id) ?? null
  })

  handle('users:findByEmail', (_e, email: string) => {
    return getRepos().users.findByEmail(email) ?? null
  })

  handle('users:create', (_e, input: Parameters<Repositories['users']['create']>[0]) => {
    return getRepos().users.create(input)
  })

  handle(
    'users:update',
    (_e, id: string, input: Parameters<Repositories['users']['update']>[1]) => {
      return getRepos().users.update(id, input) ?? null
    }
  )

  handle('users:delete', (_e, id: string) => {
    return getRepos().users.delete(id)
  })

  handle('users:list', () => {
    return getRepos().users.list()
  })

  // ── Activity Log ───────────────────────────────────────────────────
  handle('activityLog:findById', (_e, id: string) => {
    return getRepos().activityLog.findById(id) ?? null
  })

  handle('activityLog:findByTaskId', (_e, taskId: string) => {
    return getRepos().activityLog.findByTaskId(taskId)
  })

  handle('activityLog:findByUserId', (_e, userId: string) => {
    return getRepos().activityLog.findByUserId(userId)
  })

  handle(
    'activityLog:create',
    (_e, input: Parameters<Repositories['activityLog']['create']>[0]) => {
      return getRepos().activityLog.create(input)
    }
  )

  handle(
    'activityLog:applyRemote',
    (_e, input: Parameters<Repositories['activityLog']['applyRemote']>[0]) => {
      return getRepos().activityLog.applyRemote(input)
    }
  )

  handle('activityLog:deleteByTaskId', (_e, taskId: string) => {
    return getRepos().activityLog.deleteByTaskId(taskId)
  })

  handle('activityLog:getRecent', (_e, userId: string, limit: number) => {
    return getRepos().activityLog.getRecent(userId, limit)
  })

  // ── Settings ───────────────────────────────────────────────────────
  handle('settings:get', (_e, userId: string, key: string) => {
    return getRepos().settings.get(userId, key)
  })

  handle('settings:set', (_e, userId: string, key: string, value: string | null) => {
    return getRepos().settings.set(userId, key, value)
  })

  handle('settings:getAll', (_e, userId: string) => {
    return getRepos().settings.getAll(userId)
  })

  handle(
    'settings:getMultiple',
    (_e, userId: string, keys: string[]) => {
      return getRepos().settings.getMultiple(userId, keys)
    }
  )

  handle(
    'settings:setMultiple',
    (_e, userId: string, settings: Parameters<Repositories['settings']['setMultiple']>[1]) => {
      return getRepos().settings.setMultiple(userId, settings)
    }
  )

  handle('settings:delete', (_e, userId: string, key: string) => {
    return getRepos().settings.delete(userId, key)
  })

  handle('settings:hardDelete', (_e, userId: string, key: string) => {
    return getRepos().settings.hardDelete(userId, key)
  })

  handle(
    'settings:findAllByUser',
    (_e, userId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().settings.findAllByUser(userId, options ?? {})
    }
  )

  handle('settings:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().settings.findMaxUpdatedAt(userId)
  })

  handle(
    'settings:applyRemote',
    (_e, setting: Parameters<Repositories['settings']['applyRemote']>[0]) => {
      return getRepos().settings.applyRemote(setting)
    }
  )

  handle('settings:findRaw', (_e, userId: string, key: string) => {
    return getRepos().settings.findRaw(userId, key) ?? null
  })

  handle('settings:canRewriteThemeReference', (_e, userId: string, from: string | null, to: string | null, updatedAt: string) => {
    return getRepos().settings.canRewriteThemeReference(userId, from, to, updatedAt)
  })

  handle('settings:themeReferenceSource', (_e, userId: string, value: string | null, updatedAt: string) => {
    return getRepos().settings.themeReferenceSource(userId, value, updatedAt)
  })

  // ── Themes ─────────────────────────────────────────────────────────
  handle('themes:isPresetAlias', (_e, theme: Parameters<Repositories['themes']['isPresetAlias']>[0]) => {
    return getRepos().themes.isPresetAlias(theme)
  })
  handle('themes:findById', (_e, id: string) => {
    return getRepos().themes.findById(id) ?? null
  })

  handle('themes:list', (_e, userId: string) => {
    return getRepos().themes.list(userId)
  })

  handle('themes:listByMode', (_e, mode: string, userId: string) => {
    return getRepos().themes.listByMode(mode, userId)
  })

  handle(
    'themes:create',
    (_e, input: Parameters<Repositories['themes']['create']>[0]) => {
      return getRepos().themes.create(input)
    }
  )

  handle(
    'themes:update',
    (_e, id: string, input: Parameters<Repositories['themes']['update']>[1]) => {
      return getRepos().themes.update(id, input) ?? null
    }
  )

  handle('themes:delete', (_e, id: string) => {
    return getRepos().themes.delete(id)
  })

  handle('themes:hardDelete', (_e, id: string) => {
    return getRepos().themes.hardDelete(id)
  })

  handle(
    'themes:findAllByOwner',
    (_e, ownerId: string, options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }) => {
      return getRepos().themes.findAllByOwner(ownerId, options ?? {})
    }
  )

  handle('themes:findMaxUpdatedAt', (_e, ownerId: string) => {
    return getRepos().themes.findMaxUpdatedAt(ownerId)
  })

  handle(
    'themes:applyRemote',
    (_e, theme: Parameters<Repositories['themes']['applyRemote']>[0]) => {
      return getRepos().themes.applyRemote(theme)
    }
  )

  handle('themes:getConfig', (_e, id: string) => {
    return getRepos().themes.getConfig(id) ?? null
  })

  // ── Project Templates ────────────────────────────────────────────
  handle('projectTemplates:findById', (_e, id: string) => {
    return getRepos().projectTemplates.findById(id) ?? null
  })

  handle('projectTemplates:findByOwnerId', (_e, ownerId: string) => {
    return getRepos().projectTemplates.findByOwnerId(ownerId)
  })

  handle('projectTemplates:findAll', (_e, userId: string) => {
    return getRepos().projectTemplates.findByOwnerId(userId)
  })

  handle(
    'projectTemplates:create',
    (_e, input: Parameters<Repositories['projectTemplates']['create']>[0]) => {
      return getRepos().projectTemplates.create(input)
    }
  )

  handle(
    'projectTemplates:update',
    (_e, id: string, input: Parameters<Repositories['projectTemplates']['update']>[1]) => {
      return getRepos().projectTemplates.update(id, input) ?? null
    }
  )

  handle('projectTemplates:delete', (_e, id: string) => {
    return getRepos().projectTemplates.delete(id)
  })

  handle('projectTemplates:hardDelete', (_e, id: string) => {
    return getRepos().projectTemplates.hardDelete(id)
  })

  handle(
    'projectTemplates:findAllByOwner',
    (_e, ownerId: string, options?: { includeTombstones?: boolean }) => {
      return getRepos().projectTemplates.findAllByOwner(ownerId, options ?? {})
    }
  )

  handle('projectTemplates:findMaxUpdatedAt', (_e, ownerId: string) => {
    return getRepos().projectTemplates.findMaxUpdatedAt(ownerId)
  })

  handle(
    'projectTemplates:applyRemote',
    (_e, template: Parameters<Repositories['projectTemplates']['applyRemote']>[0]) => {
      return getRepos().projectTemplates.applyRemote(template)
    }
  )

  // ── Quick Add ─────────────────────────────────────────────────────
  handle('quickadd:hide', () => {
    hideQuickAddWindow()
  })

  handle('quickadd:notifyTaskCreated', (event) => {
    // Broadcast tasks-changed to all windows except the sender
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== event.sender) {
        win.webContents.send('tasks-changed')
      }
    }
  })

  handle(
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

  handle(
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
  handle('tray:setUserId', (_e, userId: string) => {
    setTrayUserId(userId)
  })

  handle('tray:refresh', () => {
    refreshTray()
  })

  // ── Timer ──────────────────────────────────────────────────────────
  handle('timer:updateTimer', (_e, state: TimerTrayState) => {
    setTimerState(state)
  })

  handle('timer:clearTimer', () => {
    clearTimerState()
  })

  handle('timer:minimizeToTray', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.hide()
    }
  })

  handle('timer:navigateToTask', (_e, taskId: string) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      win.webContents.send('tray:navigate-to-task', taskId)
    }
  })

  // ── Attachments ─────────────────────────────────────────────────────
  handle('attachments:findByTaskId', (_e, taskId: string) => {
    return getRepos().attachments.findByTaskId(taskId)
  })

  handle('attachments:createFromFile', (_e, taskId: string, filePath: string) => {
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

  handle('attachments:open', async (_e, id: string) => {
    const data = getRepos().attachments.getFileData(id)
    if (!data) return
    const directory = mkdtempSync(join(app.getPath('temp'), 'todoozy-attachment-'))
    const name = basename(data.filename)
    const tmpPath = join(directory, name && name !== '.' && name !== '..' ? name : 'attachment')
    writeFileSync(tmpPath, data.file_data, { mode: 0o600 })
    await shell.openPath(tmpPath)
  })

  handle('attachments:restore', (_e, id: string) => getRepos().attachments.restore(id))

  handle('attachments:delete', (_e, id: string) => {
    return getRepos().attachments.delete(id)
  })

  // ── Shell ────────────────────────────────────────────────────────────

  handle('shell:openExternal', async (_e, url: string) => {
    // Enforce a scheme allowlist in the MAIN process — never trust the renderer.
    const validation = validateExternalUrl(url)
    if (!validation.ok) {
      console.warn(`[shell:openExternal] rejected external URL: ${validation.reason}`)
      return { ok: false as const, error: validation.reason }
    }
    await shell.openExternal(validation.url)
    return { ok: true as const }
  })

  handle('shell:openReference', async (_e, url: string) => {
    try {
      if (new URL(url).protocol === 'file:') {
        const path = fileURLToPath(url) // rejects remote hosts and encoded separators
        if (!existsSync(path)) return { ok: false, error: 'Referenced file does not exist on this Mac' }
        shell.showItemInFolder(path)
        return { ok: true }
      }
      const validation = validateExternalUrl(url)
      if (!validation.ok) return { ok: false, error: validation.reason }
      await shell.openExternal(validation.url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Cannot open reference' }
    }
  })

  // ── Launch at Login ─────────────────────────────────────────────────

  handle('app:getLoginItemSettings', () => {
    return app.getLoginItemSettings()
  })

  handle('app:setLoginItemSettings', (_e, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin })
  })

  handle('app:getDatabasePath', () => {
    return getDatabasePath()
  })

  handle('app:getChangelog', async () => {
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
  handle('notifications:findAll', (_e, limit?: number) => {
    return getRepos().notifications.findAll(limit)
  })

  handle('notifications:findUnread', () => {
    return getRepos().notifications.findUnread()
  })

  handle('notifications:getUnreadCount', () => {
    return getRepos().notifications.getUnreadCount()
  })

  handle(
    'notifications:create',
    (_e, input: Parameters<Repositories['notifications']['create']>[0]) => {
      return getRepos().notifications.create(input)
    }
  )

  handle('notifications:markAsRead', (_e, id: string) => {
    return getRepos().notifications.markAsRead(id)
  })

  handle('notifications:markAllAsRead', () => {
    return getRepos().notifications.markAllAsRead()
  })

  handle('notifications:deleteNotification', (_e, id: string) => {
    return getRepos().notifications.delete(id)
  })

  handle('notifications:deleteAll', () => {
    return getRepos().notifications.deleteAll()
  })

  // ── Sync Queue ────────────────────────────────────────────────────
  handle('sync:getQueue', () => {
    return getRepos().syncQueue.findAll()
  })

  handle('sync:enqueue', (_e, tableName: string, rowId: string, operation: string, payload: string) => {
    return getRepos().syncQueue.enqueue(tableName, rowId, operation as 'INSERT' | 'UPDATE' | 'DELETE', payload)
  })

  handle('sync:updatePayload', (_e, id: string, payload: string) => getRepos().syncQueue.updatePayload(id, payload))

  handle('sync:dequeue', (_e, id: string) => {
    return getRepos().syncQueue.dequeue(id)
  })

  handle('sync:clear', () => {
    return getRepos().syncQueue.clear()
  })

  handle('sync:count', () => {
    return getRepos().syncQueue.count()
  })

  // ── Sync Meta (high-water marks) ──────────────────────────────────
  handle(
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

  handle(
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

  handle(
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

  handle(
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

  handle('syncMeta:clearAll', (_e, userId: string) => {
    return getRepos().syncMeta.clearAll(userId)
  })

  // ── Release Notes ──────────────────────────────────────────────────
  // ── Project Areas ────────────────────────────────────────────────
  handle('projectAreas:findById', (_e, id: string) => getRepos().projectAreas.findById(id) ?? null)

  handle('projectAreas:findByUserId', (_e, userId: string) => {
    return getRepos().projectAreas.findByUserId(userId)
  })

  handle('projectAreas:create', (_e, input: import('../shared/types').CreateProjectAreaInput) => {
    return getRepos().projectAreas.create(input)
  })

  handle('projectAreas:update', (_e, id: string, input: import('../shared/types').UpdateProjectAreaInput) => {
    return getRepos().projectAreas.update(id, input)
  })

  handle('projectAreas:delete', (_e, id: string) => {
    return getRepos().projectAreas.delete(id)
  })

  handle('projectAreas:reorder', (_e, areaIds: string[]) => {
    return getRepos().projectAreas.reorder(areaIds)
  })

  handle('projectAreas:assignProject', (_e, projectId: string, areaId: string | null) => {
    return getRepos().projectAreas.assignProject(projectId, areaId)
  })

  handle('projectAreas:hardDelete', (_e, id: string) => {
    return getRepos().projectAreas.hardDelete(id)
  })

  handle(
    'projectAreas:findAllByUser',
    (
      _e,
      userId: string,
      options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
    ) => {
      return getRepos().projectAreas.findAllByUser(userId, options)
    }
  )

  handle('projectAreas:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().projectAreas.findMaxUpdatedAt(userId)
  })

  handle(
    'projectAreas:applyRemote',
    (_e, remote: import('../shared/types').ProjectArea) => {
      return getRepos().projectAreas.applyRemote(remote)
    }
  )

  // ── Stats ────────────────────────────────────────────────────────
  handle('stats:completions', (_e, userId: string, projectIds: string[] | null, startDate: string, endDate: string) => {
    return getRepos().tasks.getCompletionStats(userId, projectIds, startDate, endDate)
  })

  handle('stats:streaks', (_e, userId: string) => {
    return getRepos().tasks.getStreakStats(userId)
  })

  handle('stats:focus', (_e, userId: string, projectIds: string[] | null, startDate: string, endDate: string) => {
    return getRepos().activityLog.getFocusStats(userId, projectIds?.[0] ?? null, startDate, endDate)
  })

  handle('stats:heatmap', (_e, userId: string, startDate: string, endDate: string) => {
    return getRepos().activityLog.getActivityHeatmap(userId, startDate, endDate)
  })

  handle('stats:focusTaskList', (_e, userId: string, startDate: string, endDate: string, projectIds: string[] | null) => {
    return getRepos().activityLog.getFocusTaskList(userId, startDate, endDate, projectIds)
  })

  handle('stats:taskList', (_e, userId: string, filter: string, projectIds: string[] | null, startDate?: string, endDate?: string) => {
    return getRepos().tasks.getStatsTaskList(userId, filter as 'completed_today' | 'completed_week' | 'completed_range' | 'open' | 'overdue', projectIds, startDate, endDate)
  })

  handle('stats:summary', (_e, userId: string, projectIds: string[] | null) => {
    return getRepos().tasks.getTaskSummaryStats(userId, projectIds)
  })

  handle('stats:priorityBreakdown', (_e, userId: string, projectIds: string[] | null) => {
    return getRepos().tasks.getPriorityBreakdown(userId, projectIds)
  })

  handle('stats:completionsByDayOfWeek', (_e, userId: string, projectIds: string[] | null, startDate: string, endDate: string) => {
    return getRepos().tasks.getCompletionsByDayOfWeek(userId, projectIds, startDate, endDate)
  })

  handle('stats:projectBreakdown', (_e, userId: string) => {
    return getRepos().tasks.getProjectBreakdown(userId)
  })

  handle('stats:cookieBalance', (_e, userId: string, startDate: string, endDate: string) => {
    return getRepos().activityLog.getCookieStats(userId, startDate, endDate)
  })

  // ── Saved Views ──────────────────────────────────────────────────
  handle('savedViews:findById', (_e, id: string) => {
    return getRepos().savedViews.findById(id) ?? null
  })

  handle('savedViews:findByUserId', (_e, userId: string) => {
    return getRepos().savedViews.findByUserId(userId)
  })

  handle('savedViews:create', (_e, input: import('../shared/types').CreateSavedViewInput) => {
    return getRepos().savedViews.create(input)
  })

  handle('savedViews:update', (_e, id: string, input: import('../shared/types').UpdateSavedViewInput) => {
    return getRepos().savedViews.update(id, input)
  })

  handle('savedViews:delete', (_e, id: string) => {
    return getRepos().savedViews.delete(id)
  })

  handle('savedViews:reorder', (_e, viewIds: string[]) => {
    return getRepos().savedViews.reorder(viewIds)
  })

  handle('savedViews:countMatching', (_e, filterConfig: string, userId: string) => {
    return getRepos().savedViews.countMatchingTasks(filterConfig, userId)
  })

  handle('savedViews:hardDelete', (_e, id: string) => {
    return getRepos().savedViews.hardDelete(id)
  })

  handle(
    'savedViews:findAllByUser',
    (
      _e,
      userId: string,
      options?: { includeTombstones?: boolean; sinceUpdatedAt?: string | null }
    ) => {
      return getRepos().savedViews.findAllByUser(userId, options)
    }
  )

  handle('savedViews:findMaxUpdatedAt', (_e, userId: string) => {
    return getRepos().savedViews.findMaxUpdatedAt(userId)
  })

  handle('savedViews:applyRemote', (_e, remote: import('../shared/types').SavedView) => {
    return getRepos().savedViews.applyRemote(remote)
  })

  handle('releaseNotes:sync', async () => {
    try {
      const { syncReleaseNotes } = await import('./services/ReleaseNotesService')
      return await syncReleaseNotes()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, count: 0, cached: 0, error: `load failed: ${msg}` }
    }
  })

  handle('releaseNotes:fetchVersion', async (_e, version: string) => {
    const { fetchVersionNotes } = await import('./services/ReleaseNotesService')
    return fetchVersionNotes(version)
  })

  handle('fs:showOpenDialog', async (_e, options?: { filters?: Array<{ name: string; extensions: string[] }>; title?: string; multiSelections?: boolean }) => {
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

  handle('fs:showSaveDialog', async (_e, options: { defaultPath?: string; contents: string }) => {
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

  handle('fs:readFile', async (_e, filePath: string) => {
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
