import { ipcMain, safeStorage, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getDatabase } from './database'
import { createRepositories, type Repositories } from './repositories'
import { hideQuickAddWindow } from './quick-add'
import { registerQuickAddShortcut, registerAppToggleShortcut } from './index'
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
const getTokenPath = (): string => join(app.getPath('userData'), '.auth-session')

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

  ipcMain.handle('tasks:findAllTemplates', () => {
    return getRepos().tasks.findAllTemplates()
  })

  ipcMain.handle('tasks:saveAsTemplate', (_e, id: string, newId: string) => {
    return getRepos().tasks.saveAsTemplate(id, newId) ?? null
  })

  // ── Labels ─────────────────────────────────────────────────────────
  ipcMain.handle('labels:findById', (_e, id: string) => {
    return getRepos().labels.findById(id) ?? null
  })

  ipcMain.handle('labels:findAll', () => {
    return getRepos().labels.findAll()
  })

  ipcMain.handle('labels:findByProjectId', (_e, projectId: string) => {
    return getRepos().labels.findByProjectId(projectId)
  })

  ipcMain.handle('labels:findByName', (_e, name: string) => {
    return getRepos().labels.findByName(name) ?? null
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

  ipcMain.handle('labels:removeFromProject', (_e, projectId: string, labelId: string) => {
    return getRepos().labels.removeFromProject(projectId, labelId)
  })

  ipcMain.handle('labels:addToProject', (_e, projectId: string, labelId: string) => {
    return getRepos().labels.addToProject(projectId, labelId)
  })

  ipcMain.handle('labels:findByTaskId', (_e, taskId: string) => {
    return getRepos().labels.findByTaskId(taskId)
  })

  ipcMain.handle('labels:findTaskLabelsByProject', (_e, projectId: string) => {
    return getRepos().labels.findTaskLabelsByProject(projectId)
  })

  ipcMain.handle('labels:reorder', (_e, labelIds: string[]) => {
    return getRepos().labels.reorder(labelIds)
  })

  ipcMain.handle('labels:findAllWithUsage', () => {
    return getRepos().labels.findAllWithUsage()
  })

  ipcMain.handle('labels:findProjectsUsingLabel', (_e, labelId: string) => {
    return getRepos().labels.findProjectsUsingLabel(labelId)
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

  // ── Project Templates ────────────────────────────────────────────
  ipcMain.handle('projectTemplates:findById', (_e, id: string) => {
    return getRepos().projectTemplates.findById(id) ?? null
  })

  ipcMain.handle('projectTemplates:findByOwnerId', (_e, ownerId: string) => {
    return getRepos().projectTemplates.findByOwnerId(ownerId)
  })

  ipcMain.handle('projectTemplates:findAll', () => {
    return getRepos().projectTemplates.findAll()
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
        getRepos().settings.set('quick_add_shortcut', accelerator)
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
        getRepos().settings.set('app_toggle_shortcut', accelerator)
      }
      return result
    }
  )

  // ── MCP ───────────────────────────────────────────────────────────
  ipcMain.handle('mcp:getInfo', () => {
    const serverPath = join(app.getPath('exe'), '..', '..', 'Resources', 'app', 'out', 'main', 'mcp-server.js')
    // In development, use the project directory
    const devServerPath = join(app.getAppPath(), 'out', 'main', 'mcp-server.js')
    const actualPath = existsSync(devServerPath) ? devServerPath : serverPath

    // Use the real Electron binary with ELECTRON_RUN_AS_NODE=1 so better-sqlite3 native module matches
    // In dev, resolve via require('electron') which points to the actual binary, not the cli.js wrapper
    const devElectronBin = join(app.getAppPath(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    const actualElectron = existsSync(devElectronBin) ? devElectronBin : app.getPath('exe')

    const config = {
      mcpServers: {
        ToDoozy: {
          command: actualElectron,
          args: [actualPath],
          env: { ELECTRON_RUN_AS_NODE: '1' }
        }
      }
    }
    return {
      serverPath: actualPath,
      configJson: JSON.stringify(config, null, 2)
    }
  })

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
}
