// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Task } from '../../../../shared/types'
import { TaskRow } from './TaskRow'
import { useTaskStore } from '../../shared/stores/taskStore'
import { useContextMenuStore } from '../../shared/stores/contextMenuStore'

const noop = (): void => {}
const task = { id:'readonly-task', project_id:'p', owner_id:'u', title:'Synthetic task', priority:0, status_id:'s', parent_id:null, due_date:null, recurrence_rule:null, reference_url:null, assigned_to:null } as Task
const props: ComponentProps<typeof TaskRow> = {
  task, statuses:[], allLabels:[], isSelected:false, depth:0, isExpanded:false,
  onSelect:noop, onStatusChange:noop, onTitleChange:noop, onDelete:noop,
  onToggleExpanded:noop, onAddLabel:noop, onRemoveLabel:noop, onCreateLabel:noop,
  hideAssignee:true, disableDrag:true
}
let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true })
  useTaskStore.setState({ tasks:{[task.id]:task}, selectedTaskIds:new Set(), taskLabels:{} })
  useContextMenuStore.getState().close()
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useContextMenuStore.getState().close() })
const render = async (readOnly: boolean): Promise<void> => { await act(async () => root.render(createElement(TaskRow,{...props,readOnly}))) }
const menu = async (): Promise<void> => { await act(async () => host.querySelector('[data-task-id]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:10,clientY:20}))) }
it('uses current readOnly permission when otherwise stable task props change', async () => {
  await render(true); await menu(); expect(useContextMenuStore.getState().isOpen).toBe(false)
  await render(false); await menu(); expect(useContextMenuStore.getState().taskId).toBe(task.id)
  await act(async () => useContextMenuStore.getState().close())
  await render(true); await menu(); expect(useContextMenuStore.getState().isOpen).toBe(false)
})
