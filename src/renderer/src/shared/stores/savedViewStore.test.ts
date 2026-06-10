import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SavedView } from '../../../../shared/types'

function view(id: string, filterConfig: string): SavedView {
  return {
    id,
    user_id: 'u1',
    project_id: null,
    name: id,
    color: '#888',
    icon: 'filter',
    sidebar_order: 0,
    filter_config: filterConfig,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null
  }
}

describe('useSavedViewStore — scheduleRecount', () => {
  let countMatching: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    countMatching = vi.fn().mockResolvedValue(7)
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: { savedViews: { countMatching } }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('coalesces rapid calls into a single countMatching per view (debounced 1s)', async () => {
    const { useSavedViewStore } = await import('./savedViewStore')
    const { useViewStore } = await import('./viewStore')
    useViewStore.setState({ currentView: 'my-day', selectedSavedViewId: null })
    useSavedViewStore.setState({
      views: [view('v1', '{"labelIds":["bug"]}'), view('v2', '{"labelIds":["feature"]}')],
      viewCounts: {}
    })

    const store = useSavedViewStore.getState()
    store.scheduleRecount('u1')
    store.scheduleRecount('u1')
    store.scheduleRecount('u1')

    // Debounced — nothing fired yet
    expect(countMatching).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)

    // One SQL count per view, regardless of how many times scheduleRecount ran
    expect(countMatching).toHaveBeenCalledTimes(2)
    expect(useSavedViewStore.getState().viewCounts).toEqual({ v1: 7, v2: 7 })
  })

  it('skips the currently open saved view (it maintains its own live count)', async () => {
    const { useSavedViewStore } = await import('./savedViewStore')
    const { useViewStore } = await import('./viewStore')
    useViewStore.setState({ currentView: 'saved-view', selectedSavedViewId: 'v1' })
    useSavedViewStore.setState({
      views: [view('v1', '{"labelIds":["bug"]}'), view('v2', '{"labelIds":["feature"]}')],
      // v1's count is being maintained live by the open view (e.g. unsaved edits)
      viewCounts: { v1: 42 }
    })

    useSavedViewStore.getState().scheduleRecount('u1')
    await vi.advanceTimersByTimeAsync(1000)

    // Only the non-open view is recomputed; the open view's count is preserved
    expect(countMatching).toHaveBeenCalledTimes(1)
    expect(countMatching).toHaveBeenCalledWith('{"labelIds":["feature"]}', 'u1')
    expect(useSavedViewStore.getState().viewCounts).toEqual({ v1: 42, v2: 7 })
  })

  it('hydrateCounts recomputes every view (no skipping)', async () => {
    const { useSavedViewStore } = await import('./savedViewStore')
    const { useViewStore } = await import('./viewStore')
    useViewStore.setState({ currentView: 'saved-view', selectedSavedViewId: 'v1' })
    useSavedViewStore.setState({
      views: [view('v1', '{"labelIds":["bug"]}'), view('v2', '{"labelIds":["feature"]}')],
      viewCounts: {}
    })

    await useSavedViewStore.getState().hydrateCounts('u1')

    expect(countMatching).toHaveBeenCalledTimes(2)
    expect(useSavedViewStore.getState().viewCounts).toEqual({ v1: 7, v2: 7 })
  })

  it('falls back to 0 when a count query throws', async () => {
    countMatching.mockRejectedValueOnce(new Error('boom'))
    const { useSavedViewStore } = await import('./savedViewStore')
    const { useViewStore } = await import('./viewStore')
    useViewStore.setState({ currentView: 'my-day', selectedSavedViewId: null })
    useSavedViewStore.setState({ views: [view('v1', '{}')], viewCounts: {} })

    useSavedViewStore.getState().scheduleRecount('u1')
    await vi.advanceTimersByTimeAsync(1000)

    expect(useSavedViewStore.getState().viewCounts).toEqual({ v1: 0 })
  })
})
