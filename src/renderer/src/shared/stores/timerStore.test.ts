import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatTimeRemaining, DEFAULT_TIMER_PRESETS } from './timerStore'

describe('formatTimeRemaining', () => {
  it('formats 0 seconds as 0:00', () => {
    expect(formatTimeRemaining(0)).toBe('0:00')
  })

  it('formats seconds less than a minute', () => {
    expect(formatTimeRemaining(45)).toBe('0:45')
  })

  it('formats exact minutes', () => {
    expect(formatTimeRemaining(300)).toBe('5:00')
    expect(formatTimeRemaining(1500)).toBe('25:00')
  })

  it('formats minutes and seconds', () => {
    expect(formatTimeRemaining(1532)).toBe('25:32')
    expect(formatTimeRemaining(67)).toBe('1:07')
  })

  it('pads single-digit seconds with leading zero', () => {
    expect(formatTimeRemaining(61)).toBe('1:01')
    expect(formatTimeRemaining(605)).toBe('10:05')
  })
})

describe('DEFAULT_TIMER_PRESETS', () => {
  it('has exactly 3 presets', () => {
    expect(DEFAULT_TIMER_PRESETS).toHaveLength(3)
  })

  it('has 10, 25, 50 minute presets', () => {
    expect(DEFAULT_TIMER_PRESETS.map((p) => p.minutes)).toEqual([10, 25, 50])
  })

  it('each preset has id, name, minutes', () => {
    for (const preset of DEFAULT_TIMER_PRESETS) {
      expect(preset.id).toBeTruthy()
      expect(preset.name).toBeTruthy()
      expect(preset.minutes).toBeGreaterThan(0)
    }
  })
})

describe('useTimerStore', () => {
  // We need to mock window.api for the store to work
  beforeEach(() => {
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: {
        timer: {
          updateTimer: vi.fn().mockResolvedValue(undefined),
          clearTimer: vi.fn().mockResolvedValue(undefined),
          minimizeToTray: vi.fn().mockResolvedValue(undefined),
          navigateToTask: vi.fn().mockResolvedValue(undefined),
          onPause: vi.fn().mockReturnValue(() => {}),
          onResume: vi.fn().mockReturnValue(() => {}),
          onStop: vi.fn().mockReturnValue(() => {})
        },
        activityLog: {
          create: vi.fn().mockResolvedValue({})
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('can import the store', async () => {
    const { useTimerStore } = await import('./timerStore')
    const state = useTimerStore.getState()
    expect(state.isRunning).toBe(false)
    expect(state.isPaused).toBe(false)
    expect(state.taskId).toBeNull()
  })

  it('starts a timer correctly', async () => {
    const { useTimerStore } = await import('./timerStore')
    const { startTimer } = useTimerStore.getState()

    startTimer({
      taskId: 'task-1',
      taskTitle: 'Test Task',
      minutes: 25,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1'
    })

    const state = useTimerStore.getState()
    expect(state.isRunning).toBe(true)
    expect(state.isPaused).toBe(false)
    expect(state.taskId).toBe('task-1')
    expect(state.taskTitle).toBe('Test Task')
    expect(state.workSeconds).toBe(1500) // 25 * 60
    expect(state.remainingSeconds).toBe(1500)
    expect(state.currentRep).toBe(1)
    expect(state.phase).toBe('work')

    // Clean up
    useTimerStore.getState().stop()
  })

  it('pauses and resumes correctly', async () => {
    const { useTimerStore } = await import('./timerStore')
    const store = useTimerStore.getState()

    store.startTimer({
      taskId: 'task-1',
      taskTitle: 'Test',
      minutes: 10,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1'
    })

    expect(useTimerStore.getState().isRunning).toBe(true)
    expect(useTimerStore.getState().isPaused).toBe(false)

    useTimerStore.getState().pause()
    expect(useTimerStore.getState().isPaused).toBe(true)

    useTimerStore.getState().resume()
    expect(useTimerStore.getState().isPaused).toBe(false)

    useTimerStore.getState().stop()
  })

  it('stops and resets state', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Test',
      minutes: 10,
      reps: 3,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1'
    })

    useTimerStore.getState().stop()

    const state = useTimerStore.getState()
    expect(state.isRunning).toBe(false)
    expect(state.taskId).toBeNull()
    expect(state.remainingSeconds).toBe(0)
    expect(state.currentRep).toBe(0)
  })

  it('tick decrements remaining seconds', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Test',
      minutes: 1,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 1,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: false,
      userId: 'user-1'
    })

    const before = useTimerStore.getState().remainingSeconds
    useTimerStore.getState().tick()
    const after = useTimerStore.getState().remainingSeconds
    expect(after).toBe(before - 1)

    useTimerStore.getState().stop()
  })

  it('does not tick when paused', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Test',
      minutes: 1,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 1,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: false,
      userId: 'user-1'
    })

    useTimerStore.getState().pause()
    const before = useTimerStore.getState().remainingSeconds
    useTimerStore.getState().tick()
    expect(useTimerStore.getState().remainingSeconds).toBe(before)

    useTimerStore.getState().stop()
  })
})
