import { describe, it, expect } from 'vitest'
import { shouldShowGoToTask } from './goToTask'

describe('shouldShowGoToTask', () => {
  it('shows in My Day when the task has a project', () => {
    expect(shouldShowGoToTask('my-day', 'proj-1')).toBe(true)
  })

  it('shows in Saved Views when the task has a project', () => {
    expect(shouldShowGoToTask('saved-view', 'proj-1')).toBe(true)
  })

  it('is hidden inside a project view (redundant there)', () => {
    expect(shouldShowGoToTask('project', 'proj-1')).toBe(false)
  })

  it('is hidden in other views (archive, templates, calendar, stats)', () => {
    expect(shouldShowGoToTask('archive', 'proj-1')).toBe(false)
    expect(shouldShowGoToTask('templates', 'proj-1')).toBe(false)
    expect(shouldShowGoToTask('calendar', 'proj-1')).toBe(false)
    expect(shouldShowGoToTask('stats', 'proj-1')).toBe(false)
  })

  it('is hidden when the task has no project, even in My Day / Saved Views', () => {
    expect(shouldShowGoToTask('my-day', null)).toBe(false)
    expect(shouldShowGoToTask('my-day', undefined)).toBe(false)
    expect(shouldShowGoToTask('my-day', '')).toBe(false)
    expect(shouldShowGoToTask('saved-view', null)).toBe(false)
  })
})
