import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TimerTrayState } from '../preload/index.d'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  title: vi.fn(), callbacks: new Map<string, () => void>(), menu: [] as Array<{ label?: string }>
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => harness.handlers.set(channel, handler) },
  Tray: class { setTitle = harness.title; setToolTip(): void { return undefined } closeContextMenu(): void { return undefined } on(event: string, callback: () => void): void { harness.callbacks.set(event, callback) } destroy(): void { return undefined } popUpContextMenu(): void { return undefined } },
  Menu: { buildFromTemplate: (rows: Array<{ label?: string }>) => { harness.menu = rows; return rows } },
  nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn() }) },
  app: { isPackaged: false, getPath: () => '.', getVersion: () => 'synthetic' },
  BrowserWindow: { getAllWindows: () => [] }, safeStorage: {}, dialog: {}, shell: {}
}))
vi.mock('keytar', () => ({ default: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./database', () => ({ getDatabase: vi.fn(), switchDatabase: vi.fn(), clearDatabaseUserId: vi.fn(), getDatabasePath: vi.fn() }))
vi.mock('./quick-add', () => ({ hideQuickAddWindow: vi.fn(), showQuickAddWindow: vi.fn() }))
vi.mock('./index', () => ({ registerQuickAddShortcut: vi.fn(), registerAppToggleShortcut: vi.fn(), getMainWindow: vi.fn() }))
vi.mock('./priority-icons', () => ({ getPriorityDotIcon: vi.fn() }))
import { createTray, destroyTray, clearTimerState } from './tray'
import { registerIpcHandlers } from './ipc-handlers'
import { trustedRendererUrl } from './navigation-security'
import { useTimerStore, resetTimerForAccount, formatTimeRemaining } from '../renderer/src/shared/stores/timerStore'
import { useAuthStore } from '../renderer/src/shared/stores/authStore'
import { useSettingsStore } from '../renderer/src/shared/stores/settingsStore'

const trusted = { senderFrame: { parent: null, url: trustedRendererUrl() } }
const state: TimerTrayState = { remainingSeconds: 600, elapsedSeconds: 0, phase: 'work', isPaused: false, currentRep: 1, totalReps: 1, isPerpetual: false, taskTitle: 'Synthetic', isFlowtime: false, isLongBreak: false, sessionsCompleted: 0, totalFocusSecondsToday: 0, isCookieBreakPhase: false, cookiePoolSeconds: 0 }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-16T12:00:00Z'))
  registerIpcHandlers(); createTray()
  harness.handlers.get('auth:switchDatabase')!(trusted, 'u')
  useAuthStore.setState({ currentUser: { id: 'u' } as never })
  useSettingsStore.setState({ settings: { timer_minimize_on_start: 'false' } })
  const context = harness.handlers.get('sync:captureContext')!(trusted) as {userId:string;generation:number}
  const scope = JSON.stringify([context.userId, context.generation])
  vi.stubGlobal('window', { api: { sync: { currentContext: () => scope }, timer: {
    updateTimer: (value: TimerTrayState) => harness.handlers.get('timer:updateTimer')!(trusted, value, scope),
    clearTimer: () => harness.handlers.get('timer:clearTimer')!(trusted, scope), minimizeToTray: vi.fn()
  } } })
})
afterEach(() => { resetTimerForAccount(); clearTimerState(); destroyTray(); vi.unstubAllGlobals(); vi.useRealTimers() })
it.each([false, true])('formats actual fractional elapsed timer IPC for flowtime=%s', flowtime => {
  useTimerStore.getState().startTimer({ taskId: 't', taskTitle: 'Synthetic', minutes: 10, breakMinutes: 1, reps: 1, isPerpetual: false, autoBreak: false, soundEnabled: false, notificationEnabled: false, userId: 'u', isFlowtime: flowtime })
  vi.setSystemTime(Date.now() + 1001)
  useTimerStore.getState().pause()
  const value = flowtime ? useTimerStore.getState().elapsedSeconds : useTimerStore.getState().remainingSeconds
  expect(value).toBeCloseTo(flowtime ? 1.001 : 598.999)
  expect(harness.title.mock.lastCall?.[0]).toBe(`${flowtime ? '🌊' : '⏱'} ${flowtime ? '0:01' : '9:58'}`)
  expect(formatTimeRemaining(value)).toBe(flowtime ? '0:01' : '9:58')
})
it.each([
  { value: 598.999, expected: '9:58' }, { value: 3661, expected: '61:01' },
  { value: -1.2, expected: '0:00' }, { value: NaN, expected: '0:00' }, { value: Infinity, expected: '0:00' }
])('normalizes work and break IPC display $value', ({ value, expected }) => {
  for (const phase of ['work', 'break'] as const) {
    window.api.timer.updateTimer({ ...state, phase, remainingSeconds: value }, window.api.sync.currentContext())
    expect(harness.title.mock.lastCall?.[0]).toBe(`${phase === 'work' ? '⏱' : '☕'} ${expected}`)
  }
})
it('keeps signed cookie display consistent in tray title, menu and renderer', () => {
  window.api.timer.updateTimer({ ...state, isFlowtime: true, isCookieBreakPhase: true, cookiePoolSeconds: -0.2 }, window.api.sync.currentContext())
  expect(harness.title.mock.lastCall?.[0]).toBe('🍪 -0:01')
  harness.callbacks.get('click')!(); vi.advanceTimersByTime(150)
  expect(harness.menu.some(row => row.label === '🍪 Cookie Time: -0:01')).toBe(true)
  expect(formatTimeRemaining(-0.2)).toBe('-0:01')
})
