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

  it('starts flowtime mode correctly', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Flowtime Test',
      minutes: 25,
      reps: 0,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1',
      isFlowtime: true
    })

    const state = useTimerStore.getState()
    expect(state.isFlowtime).toBe(true)
    expect(state.elapsedSeconds).toBe(0)
    expect(state.phase).toBe('work')

    useTimerStore.getState().stop()
  })

  it('flowtime tick counts up instead of down', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Flowtime Test',
      minutes: 25,
      reps: 0,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1',
      isFlowtime: true
    })

    expect(useTimerStore.getState().elapsedSeconds).toBe(0)
    useTimerStore.getState().tick()
    expect(useTimerStore.getState().elapsedSeconds).toBe(1)
    useTimerStore.getState().tick()
    expect(useTimerStore.getState().elapsedSeconds).toBe(2)
    // remainingSeconds should NOT change in flowtime work mode
    expect(useTimerStore.getState().remainingSeconds).toBe(25 * 60)

    useTimerStore.getState().stop()
  })

  it('flowtime pauses the elapsed counter', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Flowtime Pause Test',
      minutes: 25,
      reps: 0,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1',
      isFlowtime: true
    })

    useTimerStore.getState().tick()
    useTimerStore.getState().tick()
    expect(useTimerStore.getState().elapsedSeconds).toBe(2)

    useTimerStore.getState().pause()
    useTimerStore.getState().tick()
    expect(useTimerStore.getState().elapsedSeconds).toBe(2) // unchanged

    useTimerStore.getState().resume()
    useTimerStore.getState().tick()
    expect(useTimerStore.getState().elapsedSeconds).toBe(3)

    useTimerStore.getState().stop()
  })

  it('starts with long break params', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Long Break Test',
      minutes: 25,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1',
      longBreakMinutes: 15,
      longBreakInterval: 4
    })

    const state = useTimerStore.getState()
    expect(state.longBreakSeconds).toBe(900) // 15 * 60
    expect(state.longBreakInterval).toBe(4)
    expect(state.isLongBreak).toBe(false)

    useTimerStore.getState().stop()
  })

  it('long break interval of 0 disables long breaks', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'No Long Break',
      minutes: 25,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1',
      longBreakMinutes: 0,
      longBreakInterval: 0
    })

    const state = useTimerStore.getState()
    expect(state.longBreakSeconds).toBe(0)
    expect(state.longBreakInterval).toBe(0)

    useTimerStore.getState().stop()
  })

  it('preserves session stats across stops', async () => {
    const { useTimerStore } = await import('./timerStore')

    // Manually set some session stats
    useTimerStore.setState({
      sessionsCompleted: 3,
      totalFocusSecondsToday: 4500,
      statsDate: new Date().toISOString().slice(0, 10)
    })

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Stats Preserve Test',
      minutes: 25,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: false,
      userId: 'user-1'
    })

    useTimerStore.getState().stop()

    const state = useTimerStore.getState()
    // Session stats should be preserved even after stop
    expect(state.sessionsCompleted).toBe(3)
    expect(state.totalFocusSecondsToday).toBe(4500)
  })

  it('resets session stats when date changes', async () => {
    const { useTimerStore } = await import('./timerStore')

    // Set stats from yesterday
    useTimerStore.setState({
      sessionsCompleted: 5,
      totalFocusSecondsToday: 9000,
      statsDate: '2020-01-01'
    })

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Date Reset Test',
      minutes: 25,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: false,
      userId: 'user-1'
    })

    const state = useTimerStore.getState()
    expect(state.sessionsCompleted).toBe(0)
    expect(state.totalFocusSecondsToday).toBe(0)
    expect(state.statsDate).toBe(new Date().toISOString().slice(0, 10))

    useTimerStore.getState().stop()
  })

  it('defaults isFlowtime to false when not specified', async () => {
    const { useTimerStore } = await import('./timerStore')

    useTimerStore.getState().startTimer({
      taskId: 'task-1',
      taskTitle: 'Default Flowtime Test',
      minutes: 25,
      reps: 1,
      isPerpetual: false,
      breakMinutes: 5,
      soundEnabled: false,
      notificationEnabled: false,
      autoBreak: true,
      userId: 'user-1'
    })

    expect(useTimerStore.getState().isFlowtime).toBe(false)

    useTimerStore.getState().stop()
  })
})
