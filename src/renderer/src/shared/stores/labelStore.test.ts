import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Label } from '../../../../shared/types'

// Mock authStore so getUserId() resolves without pulling in supabase.
vi.mock('./authStore', () => ({
  useAuthStore: {
    getState: () => ({ currentUser: { id: 'user-1' } })
  }
}))

// Mock the sync service the store dynamically imports. The dynamic import in
// createLabel resolves the same relative specifier the store uses, so this
// factory intercepts it.
const { pushLabelMock, pushProjectLabelMock } = vi.hoisted(() => ({
  pushLabelMock: vi.fn().mockResolvedValue(undefined),
  pushProjectLabelMock: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../services/PersonalSyncService', () => ({
  pushLabel: pushLabelMock,
  pushProjectLabel: pushProjectLabelMock
}))

function makeLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: 'label-1',
    user_id: 'user-1',
    name: 'Urgent',
    color: '#ff0000',
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides
  }
}

describe('labelStore.createLabel — pushes project_labels junction (#77)', () => {
  beforeEach(() => {
    pushLabelMock.mockClear()
    pushProjectLabelMock.mockClear()
    const created = makeLabel()
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: {
        labels: {
          create: vi.fn().mockResolvedValue(created),
          findAll: vi.fn().mockResolvedValue([created])
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pushes the junction row when a label is created inside a project', async () => {
    const { useLabelStore } = await import('./labelStore')
    await useLabelStore.getState().createLabel({
      id: 'label-1',
      user_id: 'user-1',
      project_id: 'project-9',
      name: 'Urgent',
      color: '#ff0000'
    })

    // The push happens in a fire-and-forget dynamic-import .then() callback.
    await vi.waitFor(() => expect(pushProjectLabelMock).toHaveBeenCalled())
    expect(pushProjectLabelMock).toHaveBeenCalledWith('project-9', 'label-1', null)
    expect(pushLabelMock).toHaveBeenCalled()
  })

  it('does NOT push a junction row when no project_id is provided', async () => {
    const { useLabelStore } = await import('./labelStore')
    await useLabelStore.getState().createLabel({
      id: 'label-1',
      user_id: 'user-1',
      name: 'Urgent',
      color: '#ff0000'
    })

    // Wait for the label push so we know the .then() callback has run, then
    // assert the junction push was skipped.
    await vi.waitFor(() => expect(pushLabelMock).toHaveBeenCalled())
    expect(pushProjectLabelMock).not.toHaveBeenCalled()
  })
})
