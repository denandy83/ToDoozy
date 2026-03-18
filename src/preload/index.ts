import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose API via contextBridge:', error)
  }
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as Record<string, unknown>).electron = electronAPI
  ;(globalThis as Record<string, unknown>).api = api
}
