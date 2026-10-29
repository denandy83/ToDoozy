import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { DndContext, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useLayoutMotion } from '../src/renderer/src/shared/motion/useLayoutMotion'
import { subscribeMotionInput } from '../src/renderer/src/shared/motion/motion'
import { useDragAndDrop } from '../src/renderer/src/features/tasks/useDragAndDrop'
import { TaskRow } from '../src/renderer/src/features/tasks/TaskRow'
import { KanbanCard } from '../src/renderer/src/features/tasks/KanbanCard'
import { LabelPicker } from '../src/renderer/src/shared/components/LabelPicker'
import { Sidebar } from '../src/renderer/src/features/sidebar/Sidebar'
import { useSavedViewStore } from '../src/renderer/src/shared/stores/savedViewStore'
import type { Label, Task, Status, SavedView } from '../src/shared/types'
import '../src/renderer/src/assets/main.css'

const container = document.getElementById('root')!
const root = createRoot(container)
const pause = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const render = async (content: ReactNode): Promise<void> => { flushSync(() => root.render(content)); await pause(30) }
const noop = (): void => {}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const ipc = (window as unknown as { require: (name: string) => { ipcRenderer: { invoke: (channel: string, value: unknown) => Promise<void> } } }).require('electron').ipcRenderer
const key = async (value: string): Promise<void> => { await ipc.invoke('verify:keyboard', value); await pause(30) }
const text = async (value: string): Promise<void> => { await ipc.invoke('verify:text', value); await pause(30) }
const viewport = async (width: number, height: number): Promise<void> => { await ipc.invoke('verify:viewport', { width, height }); await pause(50) }
async function click(element: HTMLElement): Promise<void> {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  element.click()
  await pause(30)
}
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
const dropEffects: string[] = []
let failNext = false
let controls: { start(id: string): void; end(id: string, over: string | null): Promise<void>; cancel(): void; edit(id: string, status: string): void }
const statuses = [
  { id: 'todo', name: 'Todo', color: '#888888', is_default: 1, is_done: 0, order_index: 0 },
  { id: 'done', name: 'Done', color: '#22c55e', is_default: 0, is_done: 1, order_index: 1 }
] as Status[]
function ReorderFixture({ kind }: { kind: 'list' | 'kanban' }): React.JSX.Element {
  const [rows, setRows] = useState(tasks)
  const ref = useRef<HTMLDivElement>(null)
  const animateDrop = useLayoutMotion(ref)
  const edit = (id: string, status: string): void => setRows((current) => ({ ...current, [id]: { ...current[id], status_id: status } }))
  useEffect(subscribeMotionInput, [])
  const dnd = useDragAndDrop({ tasks: rows,
    onReorder: async (ids) => {
      await pause(20)
      if (failNext) { failNext = false; throw new Error('Synthetic persistence failure') }
      persisted.push(ids)
      setRows(Object.fromEntries(ids.map((id, order_index) => [id, { ...rows[id], order_index }])))
    },
    onReparent: async () => { dropEffects.push('reparent') },
    onStatusChange: async (id, status) => { dropEffects.push('status'); edit(id, status) },
    onMoveToView: async () => { dropEffects.push('navigation') },
    onBucketDrop: async () => { dropEffects.push('bucket') },
    onCalendarDayDrop: async () => { dropEffects.push('calendar') },
    getTasksForParent: () => Object.values(rows).sort((a, b) => a.order_index - b.order_index)
  })
  useEffect(() => {
    document.documentElement.classList.toggle('is-dragging', dnd.dragState.isDragging)
    return () => document.documentElement.classList.remove('is-dragging')
  }, [dnd.dragState.isDragging])
  controls = {
    start(id) { flushSync(() => dnd.handleDragStart({ active: { id } } as DragStartEvent)) },
    async end(id, over) {
      await animateDrop(() => dnd.handleDragEnd({ active: { id }, over: over ? { id: over } : null } as DragEndEvent))
      await pause(30)
    },
    cancel() { flushSync(() => dnd.handleDragCancel()) },
    edit(id, status) { flushSync(() => edit(id, status)) }
  }
  return <DndContext><div ref={ref} id="scroll" style={{ width: 360, height: 180, overflow: 'auto' }}>
    <div id="layout" style={{ width: 720, minHeight: 720, display: kind === 'kanban' ? 'grid' : 'block', gridTemplateColumns: 'repeat(2, 350px)' }}>
      {Object.values(rows).sort((a, b) => a.order_index - b.order_index).map((task) => kind === 'list'
        ? <TaskRow key={task.id} task={task} statuses={statuses} allLabels={[]} isSelected={false} depth={0} isExpanded={false}
          onSelect={noop} onStatusChange={edit} onTitleChange={noop} onDelete={noop} onToggleExpanded={noop} onAddLabel={noop} onRemoveLabel={noop} onCreateLabel={noop} />
        : <KanbanCard key={task.id} task={task} statuses={statuses} isSelected={false} onSelect={noop} onStatusChange={edit} onDeleteTask={noop} />)}
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
    scroll.scrollTop += 100
    scroll.scrollLeft += 100
    await pause(30)
    if (kind === 'list') {
      const statusButton = [...container.querySelectorAll<HTMLButtonElement>('[aria-label^="Status:"]')].find((element) => {
        const rect = element.getBoundingClientRect()
        const bounds = scroll.getBoundingClientRect()
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom
      })!
      assert(statusButton, 'List has no visible status control')
      const oldStatus = statusButton.getAttribute('aria-label')
      await click(statusButton)
      assert(statusButton.getAttribute('aria-label') !== oldStatus, 'Status click did not edit the task')
    } else {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      controls.edit('task-0', 'done')
    }
    assert(recorded.length === 0, `${kind} post-settlement scroll/status edit reused drop geometry`)
    for (const over of [null, 'task-7', 'unknown-target', 'kanban-column-todo']) {
      controls.start('task-7')
      await controls.end('task-7', over)
      scroll.scrollTop -= 10
      scroll.scrollLeft -= 10
      await pause(20)
      controls.edit('task-0', 'done')
      assert(persisted.length === count + 1 && recorded.length === 0, `${kind} invalid/self drop armed a later edit`)
    }
    controls.start('task-7')
    controls.cancel()
    scroll.scrollTop -= 10
    controls.edit('task-1', 'done')
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
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    controls.start('task-4')
    const scrollingDrop = controls.end('task-4', 'task-5')
    scroll.scrollTop -= 20
    scroll.scrollLeft += 20
    await scrollingDrop
    assert(persisted.length === count + 4 && recorded.length === 0, `${kind} reused geometry after scrolling during persistence`)
    controls.start('task-3')
    const interruptedDrop = controls.end('task-3', 'task-4')
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    controls.edit('task-2', 'done')
    await interruptedDrop
    assert(persisted.length === count + 5 && recorded.length === 0, `${kind} animated an unrelated edit during persistence`)
    failNext = true
    controls.start('task-2')
    let failed = false
    try { await controls.end('task-2', 'task-3') } catch { failed = true }
    controls.edit('task-1', 'todo')
    assert(failed && persisted.length === count + 5 && recorded.length === 0, `${kind} failed persistence armed an animation`)
    const effects = dropEffects.length
    for (const over of ['nav-my-day', 'kanban-column-done', 'kanban-column-__bucket_in-progress', 'calendar-day-2026-10-30']) {
      controls.start('task-7')
      await controls.end('task-7', over)
      scroll.scrollLeft += 5
      controls.edit('task-0', 'todo')
      assert(recorded.length === 0, `${kind} drop action armed a later task edit`)
    }
    assert(dropEffects.slice(effects).join(',') === 'navigation,status,bucket,calendar', `${kind} drop callbacks changed`)
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

  const colorWrites: Array<{ id: string; color: string }> = []
  const savedView = { id: 'synthetic-view', name: 'Synthetic saved view', color: '#6366f1', filter_config: '{}', order_index: 0 } as SavedView
  useSavedViewStore.setState({ views: [savedView], updateView: async (id, updates) => {
    colorWrites.push({ id, color: updates.color! })
    useSavedViewStore.setState((state) => ({ views: state.views.map((view) => view.id === id ? { ...view, ...updates } : view) }))
  } })
  await render(<Sidebar projects={[]} projectCounts={{}} viewCounts={{ 'my-day': 0, archive: 0, templates: 0 }} onSettings={noop} onHelp={noop} />)
  const menu = (): HTMLElement | null => container.querySelector('[aria-label="Saved view colors"]')
  const inside = (element: HTMLElement, message: string): void => {
    const rect = element.getBoundingClientRect()
    assert(rect.left >= 7 && rect.top >= 7 && rect.right <= innerWidth - 7 && rect.bottom <= innerHeight - 7, message)
  }
  const openMenu = async (x: number, y: number): Promise<HTMLElement> => {
    const target = [...container.querySelectorAll('span')].find((element) => element.textContent === savedView.name)!
    assert(target, 'Saved view is missing from the sidebar')
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y }))
    await pause(200)
    assert(menu(), 'Saved view context menu did not open')
    return menu()!
  }
  for (const [width, height, x, y] of [[1024, 768, 40, 650], [1024, 768, 1000, 750], [240, 180, 230, 170], [180, 160, 170, 150]]) {
    await viewport(width, height)
    const popup = await openMenu(x, y)
    inside(popup, `Saved view popup escaped ${width}x${height} viewport`)
    const choices = [...popup.querySelectorAll<HTMLButtonElement>('.ui-color-swatch')]
    assert(choices.length === swatches.length, 'Saved view popup lost vivid or pastel choices')
    for (const choice of [...choices, popup.querySelector<HTMLInputElement>('input[type="color"]')!]) {
      choice.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      await pause()
      inside(choice, `${choice.getAttribute('aria-label')} is unreachable in ${width}x${height}`)
      const bounds = choice.getBoundingClientRect()
      assert(choice.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)), 'Color control is clipped by its popup')
    }
    if (height < 200) assert(popup.scrollHeight > popup.clientHeight, 'Small-window popup did not allow vertical scrolling')
    const pastel = popup.querySelector<HTMLButtonElement>('[role="group"][aria-label="Pastel colors"] button')!
    pastel.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    await click(pastel)
    await pause(150)
    assert(!menu() && colorWrites.at(-1)?.id === savedView.id && colorWrites.at(-1)?.color === '#c8bce7', 'Pastel selection did not update the saved view and close')
    const customPopup = await openMenu(x, y)
    const customInput = customPopup.querySelector<HTMLInputElement>('input[type="color"]')!
    customInput.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    inside(customInput, 'Custom color control is unreachable')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(customInput, '#123456')
    customInput.dispatchEvent(new Event('input', { bubbles: true }))
    customInput.dispatchEvent(new Event('change', { bubbles: true }))
    await pause(180)
    assert(!menu() && colorWrites.at(-1)?.color === '#123456', 'Custom color selection did not persist and close')
  }
  await viewport(1024, 768)
  const resizingMenu = await openMenu(1000, 750)
  await viewport(180, 160)
  inside(resizingMenu, 'Open saved view popup escaped after resizing')
  const customAfterResize = resizingMenu.querySelector<HTMLInputElement>('input[type="color"]')!
  customAfterResize.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  inside(customAfterResize, 'Custom color is unreachable after resizing')
  await render(null)
  return `Drop, label and sidebar behavior passed: scoped list/kanban motion on both axes, post-settlement status edits, invalid/self/cancelled/failed drops, in-flight scroll/input, persistence, keyboard/reduced motion, ${swatches.length} native swatches, bottom/right and small-window saved-view colors`
}

Object.assign(window, { popupMotionResult: verify() })
