// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskRow } from './TaskRow'
import { DetailPanel } from '../detail/DetailPanel'
import { useTaskStore, useProjectStore } from '../../shared/stores'
import type { Task, Status, Project } from '../../../../shared/types'

vi.mock('../../shared/stores', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/stores')>()
  const task = (selector?: (state: ReturnType<typeof original.useTaskStore.getState>) => unknown): unknown => selector ? selector(original.useTaskStore.getState()) : original.useTaskStore.getState()
  const project = (selector?: (state: ReturnType<typeof original.useProjectStore.getState>) => unknown): unknown => selector ? selector(original.useProjectStore.getState()) : original.useProjectStore.getState()
  return { ...original, useTaskStore: Object.assign(task, original.useTaskStore), useProjectStore: Object.assign(project, original.useProjectStore) }
})
vi.mock('../detail/DetailDescription', () => ({ DetailDescription: () => null }))
vi.mock('../../shared/components/DatePicker', () => ({ DatePicker: () => null }))
const originalZone = process.env.TZ
afterEach(() => { vi.useRealTimers(); if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone })
it.each([
  ['2026-01-16T23:30:00Z', false], ['2026-01-17T00:30', false], ['2026-01-16', true],
  ['2026-01-17T00:30:00+05:00', true], ['2026-01-16T23:30:00-05:00', false]
] as const)('classifies %s consistently in the actual task row and detail panel', (due_date, overdue) => {
  process.env.TZ = 'Europe/Brussels'
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-17T12:00:00+01:00'))
  const task = { id: 't', title: 'Synthetic due date', project_id: 'p', owner_id: 'u', status_id: 's', due_date, completed_date: null, priority: 0, is_archived: 0, is_template: 0, parent_id: null, description: null, reference_url: null, recurrence_rule: null } as Task
  const status = { id: 's', project_id: 'p', name: 'Open', is_done: 0 } as Status
  useTaskStore.setState({ tasks: { t: task }, taskLabels: {}, selectedTaskIds: new Set(['t']), lastSelectedTaskId: 't', showDetailPanel: true })
  useProjectStore.setState({ projects: { p: { id: 'p', name: 'Project', is_shared: 0 } as Project } })
  const row = document.createElement('div')
  row.innerHTML = renderToStaticMarkup(createElement(TaskRow, { task, statuses: [status], allLabels: [], isSelected: false, depth: 0, isExpanded: false, onSelect: vi.fn(), onStatusChange: vi.fn(), onTitleChange: vi.fn(), onDelete: vi.fn(), onToggleExpanded: vi.fn(), onAddLabel: vi.fn(), onRemoveLabel: vi.fn(), onCreateLabel: vi.fn(), disableDrag: true }))
  const date = row.querySelector('.lucide-calendar')?.parentElement
  expect(date).toBeTruthy()
  expect(date?.classList.contains('text-danger')).toBe(overdue)
  const detail = document.createElement('div')
  detail.innerHTML = renderToStaticMarkup(createElement(DetailPanel))
  const label = [...detail.querySelectorAll('span')].find(element => element.textContent === 'Due Date')
  expect(label).toBeTruthy()
  expect(!!label?.parentElement?.querySelector('.text-danger')).toBe(overdue)
})
