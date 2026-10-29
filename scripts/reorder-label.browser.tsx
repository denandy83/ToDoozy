import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { DndContext, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useLayoutMotion } from '../src/renderer/src/shared/motion/useLayoutMotion'
import { markPointerReorder, subscribeMotionInput } from '../src/renderer/src/shared/motion/motion'
import { useDragAndDrop } from '../src/renderer/src/features/tasks/useDragAndDrop'
import { TaskRow } from '../src/renderer/src/features/tasks/TaskRow'
import { KanbanCard } from '../src/renderer/src/features/tasks/KanbanCard'
import { LabelPicker } from '../src/renderer/src/shared/components/LabelPicker'
import type { Label, Task } from '../src/shared/types'
import '../src/renderer/src/assets/main.css'

const container = document.getElementById('root')!
const root = createRoot(container)
const pause = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const render = async (content: ReactNode): Promise<void> => { flushSync(() => root.render(content)); await pause(30) }
const noop = (): void => {}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const ipc = (window as unknown as { require: (name: string) => { ipcRenderer: { invoke: (channel: string, value: string) => Promise<void> } } }).require('electron').ipcRenderer
const key = async (value: string): Promise<void> => { await ipc.invoke('verify:keyboard', value); await pause(30) }
const text = async (value: string): Promise<void> => { await ipc.invoke('verify:text', value); await pause(30) }
function button(value: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === value)
  assert(found, `Missing button: ${value}`)
  return found
}
const tasks = Object.fromEntries(Array.from({ length: 8 }, (_, order_index) => {
  const task = { id: `task-${order_index}`, project_id: 'synthetic', title: `Synthetic task ${order_index}`, status_id: 'todo', parent_id: null, order_index, priority: 0, is_archived: 0, is_template: 0 } as Task
  return [task.id, task]
}))
const persisted: string[][] = []
let controls: { start(id: string): void; end(id: string, over: string | null): Promise<void>; cancel(): void }
function ReorderFixture({ kind }: { kind: 'list' | 'kanban' }): React.JSX.Element {
  const [rows, setRows] = useState(tasks)
  const ref = useRef<HTMLDivElement>(null)
  const capture = useLayoutMotion(ref, rows)
  useEffect(subscribeMotionInput, [])
  const dnd = useDragAndDrop({ tasks: rows,
    onReorder: async (ids) => {
      await pause(20)
      persisted.push(ids)
      setRows(Object.fromEntries(ids.map((id, order_index) => [id, { ...rows[id], order_index }])))
    },
    onReparent: async () => {},
    getTasksForParent: () => Object.values(rows).sort((a, b) => a.order_index - b.order_index)
  })
  useEffect(() => {
    document.documentElement.classList.toggle('is-dragging', dnd.dragState.isDragging)
    return () => document.documentElement.classList.remove('is-dragging')
  }, [dnd.dragState.isDragging])
  controls = {
    start(id) { flushSync(() => dnd.handleDragStart({ active: { id } } as DragStartEvent)) },
    async end(id, over) {
      capture()
      markPointerReorder()
      await dnd.handleDragEnd({ active: { id }, over: over ? { id: over } : null } as DragEndEvent)
      await pause(30)
    },
    cancel() { flushSync(() => dnd.handleDragCancel()) }
  }
  return <DndContext><div ref={ref} id="scroll" style={{ width: 360, height: 180, overflow: 'auto' }}>
    <div id="layout" style={{ width: 720, display: kind === 'kanban' ? 'grid' : 'block', gridTemplateColumns: 'repeat(2, 350px)' }}>
      {Object.values(rows).sort((a, b) => a.order_index - b.order_index).map((task) => kind === 'list'
        ? <TaskRow key={task.id} task={task} statuses={[]} allLabels={[]} isSelected={false} depth={0} isExpanded={false}
          onSelect={noop} onStatusChange={noop} onTitleChange={noop} onDelete={noop} onToggleExpanded={noop} onAddLabel={noop} onRemoveLabel={noop} onCreateLabel={noop} />
        : <KanbanCard key={task.id} task={task} statuses={[]} isSelected={false} onSelect={noop} onStatusChange={noop} onDeleteTask={noop} />)}
    </div>
  </div></DndContext>
}

async function verify(): Promise<string> {
  const recorded: Array<{ id: string; frames: Keyframe[] }> = []
  const animate = Element.prototype.animate
  Element.prototype.animate = function (frames, options) {
    const id = (this as HTMLElement).dataset.layoutTask
    if (id) recorded.push({ id, frames: frames as Keyframe[] })
    return animate.call(this, frames, options)
  }
  const rects = (): Map<string, DOMRect> => new Map([...container.querySelectorAll<HTMLElement>('[data-layout-task]')].map((element) => [element.dataset.layoutTask!, element.getBoundingClientRect()]))
  const finish = (): void => container.querySelectorAll('[data-layout-task]').forEach((element) => element.getAnimations().forEach((animation) => animation.finish()))
  for (const kind of ['list', 'kanban'] as const) {
    await render(<ReorderFixture key={kind} kind={kind} />)
    const scroll = document.getElementById('scroll')!
    scroll.scrollTop = 50
    scroll.scrollLeft = 45
    document.getElementById('layout')!.style.padding = '23px 0 0 19px'
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    controls.start('task-7')
    scroll.scrollTop = 90
    scroll.scrollLeft = 75
    await pause(30)
    const before = rects()
    recorded.length = 0
    const count = persisted.length
    await controls.end('task-7', 'task-0')
    assert(persisted.length === count + 1 && persisted.at(-1)!.join(',') === 'task-7,task-0,task-1,task-2,task-3,task-4,task-5,task-6', `${kind} drop changed persistence or order`)
    assert(recorded.length > 0, `${kind} pointer drop did not animate`)
    finish()
    const after = rects()
    for (const { id, frames } of recorded) {
      const delta = /^translate\(([-\d.]+)px, ([-\d.]+)px\)$/.exec(String(frames[0].transform))
      assert(delta, `${kind} emitted invalid animation coordinates`)
      assert(Math.abs(Number(delta[1]) - (before.get(id)!.left - after.get(id)!.left)) < 1 &&
        Math.abs(Number(delta[2]) - (before.get(id)!.top - after.get(id)!.top)) < 1, `${kind} animation includes stale scroll/reflow displacement for ${id}`)
    }
    recorded.length = 0
    controls.start('task-7')
    await controls.end('task-7', null)
    controls.start('task-7')
    await controls.end('task-7', 'task-7')
    controls.start('task-7')
    controls.cancel()
    assert(persisted.length === count + 1 && recorded.length === 0, `${kind} invalid/cancelled drops changed tasks`)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    controls.start('task-6')
    await controls.end('task-6', 'task-7')
    assert(persisted.length === count + 2 && recorded.length === 0, `${kind} keyboard reorder should persist immediately without animation`)
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = ((query) => query.includes('prefers-reduced-motion') ? { matches: true } : matchMedia(query)) as typeof window.matchMedia
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    controls.start('task-5')
    await controls.end('task-5', 'task-6')
    assert(persisted.length === count + 3 && recorded.length === 0, `${kind} reduced-motion reorder should persist without animation`)
    window.matchMedia = matchMedia
  }
  Element.prototype.animate = animate
  await render(null)

  const label = { id: 'synthetic-label', user_id: '', name: 'Existing label', color: '#abcdef' } as Label
  const created: Array<{ name: string; color: string }> = []
  const toggled: string[] = []
  const keyEvents: string[] = []
  window.addEventListener('keydown', (event) => keyEvents.push(`${event.key}:${event.code}:${(event.target as HTMLElement).tagName}`), true)
  let closes = 0
  const picker = (): ReactNode => <LabelPicker allLabels={[label]} globalLabels={[label]} assignedLabelIds={new Set()}
    onToggleLabel={(id) => toggled.push(id)} onCreateLabel={(name, color) => created.push({ name, color })} onClose={() => { closes++ }} />
  await render(picker())
  button('New label...').focus()
  await key('Enter')
  const name = container.querySelector<HTMLInputElement>('input[placeholder="Label name"]')!
  assert(name && document.activeElement === name, `New label action did not focus the name input: input=${Boolean(name)} active=${document.activeElement?.outerHTML} events=${keyEvents.join(',')} toggled=${toggled.join(',')}`)
  await text('  New pastel label  ')
  await key('Tab')
  assert(document.activeElement?.classList.contains('ui-color-swatch'), 'Tab did not reach a color button')
  const swatches = [...container.querySelectorAll<HTMLButtonElement>('.ui-color-swatch')]
  for (const swatch of swatches) {
    swatch.focus()
    await key('Enter')
    assert(created.length === 0 && swatch.isConnected && swatch.getAttribute('aria-pressed') === 'true', `Enter on ${swatch.getAttribute('aria-label')} submitted instead of selecting its color`)
  }
  const custom = container.querySelector<HTMLInputElement>('input[type="color"]')!
  const selected = custom.value
  custom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  assert(created.length === 0, 'Custom color Enter submitted a label')
  button('Create').focus()
  await key('Enter')
  assert(created.length === 1 && created[0].name === 'New pastel label' && created[0].color === selected, 'Create did not use the selected color exactly once')
  button('New label...').focus()
  await key('Enter')
  await text('From input')
  await key('Enter')
  assert(created.length === 2 && created[1].name === 'From input', 'Name input Enter did not submit once')
  await key('Enter')
  assert(toggled.join(',') === label.id, 'Search input Enter no longer toggles the highlighted label')
  await key('Escape')
  assert(closes === 1, 'Picker Escape did not close')
  await render(null)
  return `Reorder and label behavior passed: list/kanban scroll and reflow on both axes, persistence, invalid/cancelled drops, keyboard/reduced motion, ${swatches.length} native Enter swatches, input/Create submission and Escape`
}

Object.assign(window, { popupMotionResult: verify() })
