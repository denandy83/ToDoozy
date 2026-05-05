import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { TodoozyAPI, UpdateStatus } from './index.d'

const api: TodoozyAPI = {
  tasks: {
    findById: (id) => ipcRenderer.invoke('tasks:findById', id),
    findByProjectId: (projectId) => ipcRenderer.invoke('tasks:findByProjectId', projectId),
    findByStatusId: (statusId) => ipcRenderer.invoke('tasks:findByStatusId', statusId),
    findMyDay: (userId) => ipcRenderer.invoke('tasks:findMyDay', userId),
    autoAddMyDay: (userId, mode) => ipcRenderer.invoke('tasks:autoAddMyDay', userId, mode),
    findArchived: (projectId) => ipcRenderer.invoke('tasks:findArchived', projectId),
    findTemplates: (projectId) => ipcRenderer.invoke('tasks:findTemplates', projectId),
    findSubtasks: (parentId) => ipcRenderer.invoke('tasks:findSubtasks', parentId),
    getSubtaskCount: (parentId) => ipcRenderer.invoke('tasks:getSubtaskCount', parentId),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    applyRemote: (task) => ipcRenderer.invoke('tasks:applyRemote', task),
    update: (id, input) => ipcRenderer.invoke('tasks:update', id, input),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
    hardDelete: (id) => ipcRenderer.invoke('tasks:hardDelete', id),
    findAllByProject: (projectId, options) =>
      ipcRenderer.invoke('tasks:findAllByProject', projectId, options),
    findMaxUpdatedAt: (projectId) => ipcRenderer.invoke('tasks:findMaxUpdatedAt', projectId),
    reorder: (taskIds) => ipcRenderer.invoke('tasks:reorder', taskIds),
    addLabel: (taskId, labelId) => ipcRenderer.invoke('tasks:addLabel', taskId, labelId),
    removeLabel: (taskId, labelId) => ipcRenderer.invoke('tasks:removeLabel', taskId, labelId),
    getLabels: (taskId) => ipcRenderer.invoke('tasks:getLabels', taskId),
    getTaskLabelsForUser: (userId) => ipcRenderer.invoke('tasks:getTaskLabelsForUser', userId),
    getTaskLabelsForSharedProjects: () =>
      ipcRenderer.invoke('tasks:getTaskLabelsForSharedProjects'),
    duplicate: (id, newId) => ipcRenderer.invoke('tasks:duplicate', id, newId),
    findAllTemplates: (userId) => ipcRenderer.invoke('tasks:findAllTemplates', userId),
    saveAsTemplate: (id, newId) => ipcRenderer.invoke('tasks:saveAsTemplate', id, newId),
    completeRecurring: (taskId) => ipcRenderer.invoke('tasks:completeRecurring', taskId)
  },

  labels: {
    findById: (id) => ipcRenderer.invoke('labels:findById', id),
    findByIds: (ids: string[]) => ipcRenderer.invoke('labels:findByIds', ids),
    findAll: (userId) => ipcRenderer.invoke('labels:findAll', userId),
    findByProjectId: (projectId) => ipcRenderer.invoke('labels:findByProjectId', projectId),
    findByName: (userId, name) => ipcRenderer.invoke('labels:findByName', userId, name),
    create: (input) => ipcRenderer.invoke('labels:create', input),
    update: (id, input) => ipcRenderer.invoke('labels:update', id, input),
    delete: (id) => ipcRenderer.invoke('labels:delete', id),
    hardDelete: (id) => ipcRenderer.invoke('labels:hardDelete', id),
    findAllByUser: (userId, options) =>
      ipcRenderer.invoke('labels:findAllByUser', userId, options),
    findMaxUpdatedAt: (userId) => ipcRenderer.invoke('labels:findMaxUpdatedAt', userId),
    applyRemote: (label) => ipcRenderer.invoke('labels:applyRemote', label),
    consolidate: (fromId, canonical) =>
      ipcRenderer.invoke('labels:consolidate', fromId, canonical),
    removeFromProject: (projectId, labelId) =>
      ipcRenderer.invoke('labels:removeFromProject', projectId, labelId),
    addToProject: (projectId, labelId) =>
      ipcRenderer.invoke('labels:addToProject', projectId, labelId),
    getProjectLabelsForOwner: (userId) =>
      ipcRenderer.invoke('labels:getProjectLabelsForOwner', userId),
    getProjectLabelsForSharedProjects: () =>
      ipcRenderer.invoke('labels:getProjectLabelsForSharedProjects'),
    applyRemoteProjectLabel: (remote) =>
      ipcRenderer.invoke('labels:applyRemoteProjectLabel', remote),
    softDeleteTaskLabelsForProjectLabel: (projectId, labelId) =>
      ipcRenderer.invoke('labels:softDeleteTaskLabelsForProjectLabel', projectId, labelId),
    findByTaskId: (taskId) => ipcRenderer.invoke('labels:findByTaskId', taskId),
    findTaskLabelsByProject: (projectId) =>
      ipcRenderer.invoke('labels:findTaskLabelsByProject', projectId),
    reorder: (labelIds) => ipcRenderer.invoke('labels:reorder', labelIds),
    findAllWithUsage: (userId) => ipcRenderer.invoke('labels:findAllWithUsage', userId),
    findProjectsUsingLabel: (userId, labelId) =>
      ipcRenderer.invoke('labels:findProjectsUsingLabel', userId, labelId),
    findActiveLabelsForProject: (projectId) =>
      ipcRenderer.invoke('labels:findActiveLabelsForProject', projectId)
  },

  projects: {
    findById: (id) => ipcRenderer.invoke('projects:findById', id),
    findByOwnerId: (ownerId) => ipcRenderer.invoke('projects:findByOwnerId', ownerId),
    findDefault: (ownerId) => ipcRenderer.invoke('projects:findDefault', ownerId),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    update: (id, input) => ipcRenderer.invoke('projects:update', id, input),
    delete: (id) => ipcRenderer.invoke('projects:delete', id),
    hardDelete: (id) => ipcRenderer.invoke('projects:hardDelete', id),
    findAllByOwner: (ownerId, options) =>
      ipcRenderer.invoke('projects:findAllByOwner', ownerId, options),
    findMaxUpdatedAt: (ownerId) => ipcRenderer.invoke('projects:findMaxUpdatedAt', ownerId),
    applyRemote: (project) => ipcRenderer.invoke('projects:applyRemote', project),
    list: (userId) => ipcRenderer.invoke('projects:list', userId),
    addMember: (projectId, userId, role, invitedBy) =>
      ipcRenderer.invoke('projects:addMember', projectId, userId, role, invitedBy),
    removeMember: (projectId, userId) =>
      ipcRenderer.invoke('projects:removeMember', projectId, userId),
    updateMember: (projectId, userId, updates) =>
      ipcRenderer.invoke('projects:updateMember', projectId, userId, updates),
    getMembers: (projectId) => ipcRenderer.invoke('projects:getMembers', projectId),
    getProjectsForUser: (userId) => ipcRenderer.invoke('projects:getProjectsForUser', userId),
    updateSidebarOrder: (updates) =>
      ipcRenderer.invoke('projects:updateSidebarOrder', updates),
    archiveWithTasks: (id) => ipcRenderer.invoke('projects:archiveWithTasks', id),
    unarchiveWithTasks: (id) => ipcRenderer.invoke('projects:unarchiveWithTasks', id)
  },

  statuses: {
    findById: (id) => ipcRenderer.invoke('statuses:findById', id),
    findByProjectId: (projectId) => ipcRenderer.invoke('statuses:findByProjectId', projectId),
    findDefault: (projectId) => ipcRenderer.invoke('statuses:findDefault', projectId),
    findDone: (projectId) => ipcRenderer.invoke('statuses:findDone', projectId),
    create: (input) => ipcRenderer.invoke('statuses:create', input),
    update: (id, input) => ipcRenderer.invoke('statuses:update', id, input),
    delete: (id) => ipcRenderer.invoke('statuses:delete', id),
    hardDelete: (id) => ipcRenderer.invoke('statuses:hardDelete', id),
    findAllByProject: (projectId, options) =>
      ipcRenderer.invoke('statuses:findAllByProject', projectId, options),
    findMaxUpdatedAt: (projectId) => ipcRenderer.invoke('statuses:findMaxUpdatedAt', projectId),
    applyRemote: (status) => ipcRenderer.invoke('statuses:applyRemote', status),
    reassignAndDelete: (statusId, targetStatusId) =>
      ipcRenderer.invoke('statuses:reassignAndDelete', statusId, targetStatusId)
  },

  users: {
    findById: (id) => ipcRenderer.invoke('users:findById', id),
    findByEmail: (email) => ipcRenderer.invoke('users:findByEmail', email),
    create: (input) => ipcRenderer.invoke('users:create', input),
    update: (id, input) => ipcRenderer.invoke('users:update', id, input),
    delete: (id) => ipcRenderer.invoke('users:delete', id),
    list: () => ipcRenderer.invoke('users:list')
  },

  activityLog: {
    findById: (id) => ipcRenderer.invoke('activityLog:findById', id),
    findByTaskId: (taskId) => ipcRenderer.invoke('activityLog:findByTaskId', taskId),
    findByUserId: (userId) => ipcRenderer.invoke('activityLog:findByUserId', userId),
    create: (input) => ipcRenderer.invoke('activityLog:create', input),
    deleteByTaskId: (taskId) => ipcRenderer.invoke('activityLog:deleteByTaskId', taskId),
    getRecent: (userId, limit) => ipcRenderer.invoke('activityLog:getRecent', userId, limit)
  },

  settings: {
    get: (userId, key) => ipcRenderer.invoke('settings:get', userId, key),
    set: (userId, key, value) => ipcRenderer.invoke('settings:set', userId, key, value),
    getAll: (userId) => ipcRenderer.invoke('settings:getAll', userId),
    getMultiple: (userId, keys) => ipcRenderer.invoke('settings:getMultiple', userId, keys),
    setMultiple: (userId, settings) => ipcRenderer.invoke('settings:setMultiple', userId, settings),
    delete: (userId, key) => ipcRenderer.invoke('settings:delete', userId, key),
    hardDelete: (userId, key) => ipcRenderer.invoke('settings:hardDelete', userId, key),
    findAllByUser: (userId, options) => ipcRenderer.invoke('settings:findAllByUser', userId, options),
    findMaxUpdatedAt: (userId) => ipcRenderer.invoke('settings:findMaxUpdatedAt', userId),
    applyRemote: (setting) => ipcRenderer.invoke('settings:applyRemote', setting),
    findRaw: (userId, key) => ipcRenderer.invoke('settings:findRaw', userId, key)
  },

  themes: {
    findById: (id) => ipcRenderer.invoke('themes:findById', id),
    list: (userId) => ipcRenderer.invoke('themes:list', userId),
    listByMode: (mode, userId) => ipcRenderer.invoke('themes:listByMode', mode, userId),
    create: (input) => ipcRenderer.invoke('themes:create', input),
    update: (id, input) => ipcRenderer.invoke('themes:update', id, input),
    delete: (id) => ipcRenderer.invoke('themes:delete', id),
    hardDelete: (id) => ipcRenderer.invoke('themes:hardDelete', id),
    findAllByOwner: (ownerId, options) =>
      ipcRenderer.invoke('themes:findAllByOwner', ownerId, options),
    findMaxUpdatedAt: (ownerId) => ipcRenderer.invoke('themes:findMaxUpdatedAt', ownerId),
    applyRemote: (theme) => ipcRenderer.invoke('themes:applyRemote', theme),
    getConfig: (id) => ipcRenderer.invoke('themes:getConfig', id)
  },

  projectTemplates: {
    findById: (id) => ipcRenderer.invoke('projectTemplates:findById', id),
    findByOwnerId: (ownerId) => ipcRenderer.invoke('projectTemplates:findByOwnerId', ownerId),
    findAll: (userId) => ipcRenderer.invoke('projectTemplates:findAll', userId),
    create: (input) => ipcRenderer.invoke('projectTemplates:create', input),
    update: (id, input) => ipcRenderer.invoke('projectTemplates:update', id, input),
    delete: (id) => ipcRenderer.invoke('projectTemplates:delete', id),
    hardDelete: (id) => ipcRenderer.invoke('projectTemplates:hardDelete', id),
    findAllByOwner: (ownerId, options) =>
      ipcRenderer.invoke('projectTemplates:findAllByOwner', ownerId, options),
    findMaxUpdatedAt: (ownerId) => ipcRenderer.invoke('projectTemplates:findMaxUpdatedAt', ownerId),
    applyRemote: (template) => ipcRenderer.invoke('projectTemplates:applyRemote', template)
  },

  attachments: {
    findByTaskId: (taskId) => ipcRenderer.invoke('attachments:findByTaskId', taskId),
    createFromFile: (taskId, filePath) => ipcRenderer.invoke('attachments:createFromFile', taskId, filePath),
    open: (id) => ipcRenderer.invoke('attachments:open', id),
    delete: (id) => ipcRenderer.invoke('attachments:delete', id)
  },

  fs: {
    showOpenDialog: (options) => ipcRenderer.invoke('fs:showOpenDialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('fs:showSaveDialog', options),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath)
  },

  auth: {
    storeSession: (sessionJson) => ipcRenderer.invoke('auth:storeSession', sessionJson),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
    clearSession: () => ipcRenderer.invoke('auth:clearSession'),
    getSupabaseConfig: () => ipcRenderer.invoke('auth:getSupabaseConfig'),
    openOAuthWindow: (url) => ipcRenderer.invoke('auth:openOAuthWindow', url),
    switchDatabase: (userId, email) => ipcRenderer.invoke('auth:switchDatabase', userId, email),
    saveEmail: (email) => ipcRenderer.invoke('auth:saveEmail', email),
    getSavedEmail: () => ipcRenderer.invoke('auth:getSavedEmail'),
    savePassword: (email, password) => ipcRenderer.invoke('auth:savePassword', email, password),
    getSavedPassword: (email) => ipcRenderer.invoke('auth:getSavedPassword', email),
    clearCredentials: () => ipcRenderer.invoke('auth:clearCredentials')
  },

  quickadd: {
    signalReady: () => ipcRenderer.send('quickadd:ready'),
    hide: () => ipcRenderer.invoke('quickadd:hide'),
    notifyTaskCreated: () => ipcRenderer.invoke('quickadd:notifyTaskCreated'),
    updateShortcut: (accelerator) => ipcRenderer.invoke('quickadd:updateShortcut', accelerator),
    onFocus: (callback) => {
      ipcRenderer.on('quickadd:focus', callback)
      return () => {
        ipcRenderer.removeListener('quickadd:focus', callback)
      }
    },
  },

  appToggle: {
    updateShortcut: (accelerator) => ipcRenderer.invoke('app-toggle:updateShortcut', accelerator)
  },

  timer: {
    updateTimer: (state) => ipcRenderer.invoke('timer:updateTimer', state),
    clearTimer: () => ipcRenderer.invoke('timer:clearTimer'),
    minimizeToTray: () => ipcRenderer.invoke('timer:minimizeToTray'),
    navigateToTask: (taskId) => ipcRenderer.invoke('timer:navigateToTask', taskId),
    onPause: (callback) => {
      ipcRenderer.on('timer:pause', callback)
      return () => { ipcRenderer.removeListener('timer:pause', callback) }
    },
    onResume: (callback) => {
      ipcRenderer.on('timer:resume', callback)
      return () => { ipcRenderer.removeListener('timer:resume', callback) }
    },
    onStop: (callback) => {
      ipcRenderer.on('timer:stop', callback)
      return () => { ipcRenderer.removeListener('timer:stop', callback) }
    },
    onCookieBreak: (callback) => {
      ipcRenderer.on('timer:cookieBreak', callback)
      return () => { ipcRenderer.removeListener('timer:cookieBreak', callback) }
    },
    onBackToWork: (callback) => {
      ipcRenderer.on('timer:backToWork', callback)
      return () => { ipcRenderer.removeListener('timer:backToWork', callback) }
    }
  },

  tray: {
    setUserId: (userId) => ipcRenderer.invoke('tray:setUserId', userId),
    refresh: () => ipcRenderer.invoke('tray:refresh'),
    onNavigateToTask: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, taskId: string): void => callback(taskId)
      ipcRenderer.on('tray:navigate-to-task', handler)
      return () => {
        ipcRenderer.removeListener('tray:navigate-to-task', handler)
      }
    },
    onNavigateToMyDay: (callback) => {
      ipcRenderer.on('tray:navigate-to-myday', callback)
      return () => {
        ipcRenderer.removeListener('tray:navigate-to-myday', callback)
      }
    }
  },

  notifications: {
    onNavigateToTask: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, taskId: string, projectId: string): void =>
        callback(taskId, projectId)
      ipcRenderer.on('notification:navigate-to-task', handler)
      return () => {
        ipcRenderer.removeListener('notification:navigate-to-task', handler)
      }
    },
    findAll: (limit) => ipcRenderer.invoke('notifications:findAll', limit),
    findUnread: () => ipcRenderer.invoke('notifications:findUnread'),
    getUnreadCount: () => ipcRenderer.invoke('notifications:getUnreadCount'),
    create: (input) => ipcRenderer.invoke('notifications:create', input),
    markAsRead: (id) => ipcRenderer.invoke('notifications:markAsRead', id),
    markAllAsRead: () => ipcRenderer.invoke('notifications:markAllAsRead'),
    deleteNotification: (id) => ipcRenderer.invoke('notifications:deleteNotification', id),
    deleteAll: () => ipcRenderer.invoke('notifications:deleteAll')
  },

  sync: {
    getQueue: () => ipcRenderer.invoke('sync:getQueue'),
    enqueue: (tableName, rowId, operation, payload) =>
      ipcRenderer.invoke('sync:enqueue', tableName, rowId, operation, payload),
    dequeue: (id) => ipcRenderer.invoke('sync:dequeue', id),
    clear: () => ipcRenderer.invoke('sync:clear'),
    count: () => ipcRenderer.invoke('sync:count')
  },

  syncMeta: {
    getHighWater: (userId, scopeId, tableName) =>
      ipcRenderer.invoke('syncMeta:getHighWater', userId, scopeId, tableName),
    setHighWater: (userId, scopeId, tableName, isoTs) =>
      ipcRenderer.invoke('syncMeta:setHighWater', userId, scopeId, tableName, isoTs),
    getLastReconciledAt: (userId, scopeId, tableName) =>
      ipcRenderer.invoke('syncMeta:getLastReconciledAt', userId, scopeId, tableName),
    setLastReconciledAt: (userId, scopeId, tableName, isoTs) =>
      ipcRenderer.invoke('syncMeta:setLastReconciledAt', userId, scopeId, tableName, isoTs),
    clearAll: (userId) => ipcRenderer.invoke('syncMeta:clearAll', userId)
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },

  app: {
    getLoginItemSettings: () => ipcRenderer.invoke('app:getLoginItemSettings'),
    setLoginItemSettings: (openAtLogin) => ipcRenderer.invoke('app:setLoginItemSettings', openAtLogin),
    getChangelog: () => ipcRenderer.invoke('app:getChangelog'),
    getDatabasePath: () => ipcRenderer.invoke('app:getDatabasePath') as Promise<string>
  },

  projectAreas: {
    findByUserId: (userId) => ipcRenderer.invoke('projectAreas:findByUserId', userId),
    create: (input) => ipcRenderer.invoke('projectAreas:create', input),
    update: (id, input) => ipcRenderer.invoke('projectAreas:update', id, input),
    delete: (id) => ipcRenderer.invoke('projectAreas:delete', id),
    reorder: (areaIds) => ipcRenderer.invoke('projectAreas:reorder', areaIds),
    assignProject: (projectId, areaId) => ipcRenderer.invoke('projectAreas:assignProject', projectId, areaId),
    hardDelete: (id) => ipcRenderer.invoke('projectAreas:hardDelete', id),
    findAllByUser: (userId, options) =>
      ipcRenderer.invoke('projectAreas:findAllByUser', userId, options),
    findMaxUpdatedAt: (userId) => ipcRenderer.invoke('projectAreas:findMaxUpdatedAt', userId),
    applyRemote: (remote) => ipcRenderer.invoke('projectAreas:applyRemote', remote)
  },

  stats: {
    completions: (userId, projectId, startDate, endDate) =>
      ipcRenderer.invoke('stats:completions', userId, projectId, startDate, endDate),
    streaks: (userId) => ipcRenderer.invoke('stats:streaks', userId),
    focus: (userId, projectId, startDate, endDate) =>
      ipcRenderer.invoke('stats:focus', userId, projectId, startDate, endDate),
    heatmap: (userId, startDate, endDate) =>
      ipcRenderer.invoke('stats:heatmap', userId, startDate, endDate),
    summary: (userId, projectIds) =>
      ipcRenderer.invoke('stats:summary', userId, projectIds),
    priorityBreakdown: (userId, projectIds) =>
      ipcRenderer.invoke('stats:priorityBreakdown', userId, projectIds),
    completionsByDayOfWeek: (userId, projectIds, startDate, endDate) =>
      ipcRenderer.invoke('stats:completionsByDayOfWeek', userId, projectIds, startDate, endDate),
    projectBreakdown: (userId) =>
      ipcRenderer.invoke('stats:projectBreakdown', userId),
    taskList: (userId, filter, projectIds, startDate, endDate) =>
      ipcRenderer.invoke('stats:taskList', userId, filter, projectIds, startDate, endDate),
    focusTaskList: (userId, startDate, endDate, projectIds) =>
      ipcRenderer.invoke('stats:focusTaskList', userId, startDate, endDate, projectIds),
    cookieBalance: (userId: string, startDate: string, endDate: string) =>
      ipcRenderer.invoke('stats:cookieBalance', userId, startDate, endDate)
  },

  savedViews: {
    findById: (id) => ipcRenderer.invoke('savedViews:findById', id),
    findByUserId: (userId) => ipcRenderer.invoke('savedViews:findByUserId', userId),
    create: (input) => ipcRenderer.invoke('savedViews:create', input),
    update: (id, input) => ipcRenderer.invoke('savedViews:update', id, input),
    delete: (id) => ipcRenderer.invoke('savedViews:delete', id),
    reorder: (viewIds) => ipcRenderer.invoke('savedViews:reorder', viewIds),
    countMatching: (filterConfig, userId) => ipcRenderer.invoke('savedViews:countMatching', filterConfig, userId),
    hardDelete: (id) => ipcRenderer.invoke('savedViews:hardDelete', id),
    findAllByUser: (userId, options) =>
      ipcRenderer.invoke('savedViews:findAllByUser', userId, options),
    findMaxUpdatedAt: (userId) => ipcRenderer.invoke('savedViews:findMaxUpdatedAt', userId),
    applyRemote: (remote) => ipcRenderer.invoke('savedViews:applyRemote', remote)
  },

  releaseNotes: {
    sync: () => ipcRenderer.invoke('releaseNotes:sync'),
    fetchVersion: (version) => ipcRenderer.invoke('releaseNotes:fetchVersion', version)
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    dismiss: (version) => ipcRenderer.invoke('updater:dismiss', version),
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    onStatus: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => callback(status)
      ipcRenderer.on('updater:status', handler)
      return () => {
        ipcRenderer.removeListener('updater:status', handler)
      }
    }
  },

  power: {
    onSuspend: (callback) => {
      const handler = (): void => callback()
      ipcRenderer.on('power:suspend', handler)
      return () => {
        ipcRenderer.removeListener('power:suspend', handler)
      }
    },
    onResume: (callback) => {
      const handler = (): void => callback()
      ipcRenderer.on('power:resume', handler)
      return () => {
        ipcRenderer.removeListener('power:resume', handler)
      }
    }
  },

  onTasksChanged: (callback) => {
    ipcRenderer.on('tasks-changed', callback)
    return () => {
      ipcRenderer.removeListener('tasks-changed', callback)
    }
  },

  onInviteReceived: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string): void => callback(token)
    ipcRenderer.on('invite:received', handler)
    return () => {
      ipcRenderer.removeListener('invite:received', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose API via contextBridge:', error)
  }
} else {
  ;(globalThis as Record<string, unknown>).electron = electronAPI
  ;(globalThis as Record<string, unknown>).api = api
}
