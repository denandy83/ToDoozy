import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { TodoozyAPI } from './index.d'

const api: TodoozyAPI = {
  tasks: {
    findById: (id) => ipcRenderer.invoke('tasks:findById', id),
    findByProjectId: (projectId) => ipcRenderer.invoke('tasks:findByProjectId', projectId),
    findByStatusId: (statusId) => ipcRenderer.invoke('tasks:findByStatusId', statusId),
    findMyDay: (userId) => ipcRenderer.invoke('tasks:findMyDay', userId),
    findArchived: (projectId) => ipcRenderer.invoke('tasks:findArchived', projectId),
    findTemplates: (projectId) => ipcRenderer.invoke('tasks:findTemplates', projectId),
    findSubtasks: (parentId) => ipcRenderer.invoke('tasks:findSubtasks', parentId),
    getSubtaskCount: (parentId) => ipcRenderer.invoke('tasks:getSubtaskCount', parentId),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    update: (id, input) => ipcRenderer.invoke('tasks:update', id, input),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
    reorder: (taskIds) => ipcRenderer.invoke('tasks:reorder', taskIds),
    addLabel: (taskId, labelId) => ipcRenderer.invoke('tasks:addLabel', taskId, labelId),
    removeLabel: (taskId, labelId) => ipcRenderer.invoke('tasks:removeLabel', taskId, labelId),
    getLabels: (taskId) => ipcRenderer.invoke('tasks:getLabels', taskId),
    duplicate: (id, newId) => ipcRenderer.invoke('tasks:duplicate', id, newId),
    findAllTemplates: () => ipcRenderer.invoke('tasks:findAllTemplates'),
    saveAsTemplate: (id, newId) => ipcRenderer.invoke('tasks:saveAsTemplate', id, newId)
  },

  labels: {
    findById: (id) => ipcRenderer.invoke('labels:findById', id),
    findAll: () => ipcRenderer.invoke('labels:findAll'),
    findByProjectId: (projectId) => ipcRenderer.invoke('labels:findByProjectId', projectId),
    findByName: (name) => ipcRenderer.invoke('labels:findByName', name),
    create: (input) => ipcRenderer.invoke('labels:create', input),
    update: (id, input) => ipcRenderer.invoke('labels:update', id, input),
    delete: (id) => ipcRenderer.invoke('labels:delete', id),
    removeFromProject: (projectId, labelId) =>
      ipcRenderer.invoke('labels:removeFromProject', projectId, labelId),
    addToProject: (projectId, labelId) =>
      ipcRenderer.invoke('labels:addToProject', projectId, labelId),
    findByTaskId: (taskId) => ipcRenderer.invoke('labels:findByTaskId', taskId),
    findTaskLabelsByProject: (projectId) =>
      ipcRenderer.invoke('labels:findTaskLabelsByProject', projectId),
    reorder: (labelIds) => ipcRenderer.invoke('labels:reorder', labelIds),
    findAllWithUsage: () => ipcRenderer.invoke('labels:findAllWithUsage'),
    findProjectsUsingLabel: (labelId) =>
      ipcRenderer.invoke('labels:findProjectsUsingLabel', labelId),
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
    list: () => ipcRenderer.invoke('projects:list'),
    addMember: (projectId, userId, role, invitedBy) =>
      ipcRenderer.invoke('projects:addMember', projectId, userId, role, invitedBy),
    removeMember: (projectId, userId) =>
      ipcRenderer.invoke('projects:removeMember', projectId, userId),
    getMembers: (projectId) => ipcRenderer.invoke('projects:getMembers', projectId),
    getProjectsForUser: (userId) => ipcRenderer.invoke('projects:getProjectsForUser', userId),
    updateSidebarOrder: (updates) =>
      ipcRenderer.invoke('projects:updateSidebarOrder', updates)
  },

  statuses: {
    findById: (id) => ipcRenderer.invoke('statuses:findById', id),
    findByProjectId: (projectId) => ipcRenderer.invoke('statuses:findByProjectId', projectId),
    findDefault: (projectId) => ipcRenderer.invoke('statuses:findDefault', projectId),
    findDone: (projectId) => ipcRenderer.invoke('statuses:findDone', projectId),
    create: (input) => ipcRenderer.invoke('statuses:create', input),
    update: (id, input) => ipcRenderer.invoke('statuses:update', id, input),
    delete: (id) => ipcRenderer.invoke('statuses:delete', id),
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
    getRecent: (limit) => ipcRenderer.invoke('activityLog:getRecent', limit)
  },

  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    getMultiple: (keys) => ipcRenderer.invoke('settings:getMultiple', keys),
    setMultiple: (settings) => ipcRenderer.invoke('settings:setMultiple', settings),
    delete: (key) => ipcRenderer.invoke('settings:delete', key)
  },

  themes: {
    findById: (id) => ipcRenderer.invoke('themes:findById', id),
    list: () => ipcRenderer.invoke('themes:list'),
    listByMode: (mode) => ipcRenderer.invoke('themes:listByMode', mode),
    create: (input) => ipcRenderer.invoke('themes:create', input),
    update: (id, input) => ipcRenderer.invoke('themes:update', id, input),
    delete: (id) => ipcRenderer.invoke('themes:delete', id),
    getConfig: (id) => ipcRenderer.invoke('themes:getConfig', id)
  },

  projectTemplates: {
    findById: (id) => ipcRenderer.invoke('projectTemplates:findById', id),
    findByOwnerId: (ownerId) => ipcRenderer.invoke('projectTemplates:findByOwnerId', ownerId),
    findAll: () => ipcRenderer.invoke('projectTemplates:findAll'),
    create: (input) => ipcRenderer.invoke('projectTemplates:create', input),
    update: (id, input) => ipcRenderer.invoke('projectTemplates:update', id, input),
    delete: (id) => ipcRenderer.invoke('projectTemplates:delete', id)
  },

  attachments: {
    findByTaskId: (taskId) => ipcRenderer.invoke('attachments:findByTaskId', taskId),
    createFromFile: (taskId, filePath) => ipcRenderer.invoke('attachments:createFromFile', taskId, filePath),
    open: (id) => ipcRenderer.invoke('attachments:open', id),
    delete: (id) => ipcRenderer.invoke('attachments:delete', id)
  },

  fs: {
    showOpenDialog: () => ipcRenderer.invoke('fs:showOpenDialog')
  },

  auth: {
    storeSession: (sessionJson) => ipcRenderer.invoke('auth:storeSession', sessionJson),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
    clearSession: () => ipcRenderer.invoke('auth:clearSession'),
    getSupabaseConfig: () => ipcRenderer.invoke('auth:getSupabaseConfig'),
    openOAuthWindow: (url) => ipcRenderer.invoke('auth:openOAuthWindow', url)
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

  mcp: {
    getInfo: () => ipcRenderer.invoke('mcp:getInfo'),
    isRunning: () => ipcRenderer.invoke('mcp:isRunning')
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
    }
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },

  onTasksChanged: (callback) => {
    ipcRenderer.on('tasks-changed', callback)
    return () => {
      ipcRenderer.removeListener('tasks-changed', callback)
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
