import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleExit } from './presence'

afterEach(() => vi.useRealTimers())
describe('retained surface lifecycle', () => {
  it('retains content until the exit completes', () => {
    vi.useFakeTimers()
    const unmount = vi.fn()
    scheduleExit(false, 100, unmount)
    vi.advanceTimersByTime(99)
    expect(unmount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(unmount).toHaveBeenCalledOnce()
  })
  it('cancels an interrupted exit instead of unmounting a reopened menu', () => {
    vi.useFakeTimers()
    const unmount = vi.fn()
    const cancel = scheduleExit(false, 100, unmount)
    vi.advanceTimersByTime(50)
    cancel()
    scheduleExit(true, 100, unmount)
    vi.advanceTimersByTime(200)
    expect(unmount).not.toHaveBeenCalled()
  })
  it('finishes keyboard and reduced-motion closes immediately', () => {
    const unmount = vi.fn()
    scheduleExit(false, 0, unmount)
    expect(unmount).toHaveBeenCalledOnce()
  })
})
