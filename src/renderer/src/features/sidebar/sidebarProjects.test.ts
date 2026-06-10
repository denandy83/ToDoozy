import { describe, it, expect } from 'vitest'
import { shouldAutoExpandProjects, MAX_VISIBLE_PROJECTS } from './sidebarProjects'
import type { Project } from '../../../../shared/types'

function makeProjects(n: number): Project[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as Project)
}

describe('shouldAutoExpandProjects', () => {
  const projects = makeProjects(8)

  it('returns false when not viewing a project', () => {
    expect(shouldAutoExpandProjects('my-day', 'p7', projects, false)).toBe(false)
  })

  it('returns false when no project is selected', () => {
    expect(shouldAutoExpandProjects('project', null, projects, false)).toBe(false)
  })

  it('returns false when the selected project is within the visible cutoff', () => {
    // index 4 is the 5th item — still visible (cutoff is index >= 5)
    expect(shouldAutoExpandProjects('project', 'p4', projects, false)).toBe(false)
  })

  it('returns true when navigating to a project hidden beyond the cutoff', () => {
    expect(shouldAutoExpandProjects('project', 'p7', projects, false)).toBe(true)
  })

  it('returns true exactly at the cutoff boundary (index === MAX_VISIBLE_PROJECTS)', () => {
    expect(shouldAutoExpandProjects('project', `p${MAX_VISIBLE_PROJECTS}`, projects, false)).toBe(true)
  })

  it('returns false when the list is already expanded — manual "Less" must not re-expand', () => {
    // This is the regression guard for the bug: selected project is hidden (index 7)
    // but the list was just manually collapsed; with alreadyExpanded reflecting the
    // pre-toggle state via a ref, the helper must NOT request re-expansion.
    expect(shouldAutoExpandProjects('project', 'p7', projects, true)).toBe(false)
  })

  it('returns false when the selected project id is not found', () => {
    expect(shouldAutoExpandProjects('project', 'missing', projects, false)).toBe(false)
  })

  it('honours a custom maxVisible', () => {
    expect(shouldAutoExpandProjects('project', 'p2', projects, false, 2)).toBe(true)
    expect(shouldAutoExpandProjects('project', 'p1', projects, false, 2)).toBe(false)
  })
})
