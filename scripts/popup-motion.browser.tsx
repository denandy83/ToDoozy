import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MotionPresence } from '../src/renderer/src/shared/motion/MotionPresence'
import { FilterBar } from '../src/renderer/src/shared/components/FilterBar'
import { ArchiveView } from '../src/renderer/src/features/views/ArchiveView'
import { TiptapEditor } from '../src/renderer/src/features/detail/editor/TiptapEditor'
import { useProjectStore, useTaskStore, useLabelStore } from '../src/renderer/src/shared/stores'
import { useStatusStore } from '../src/renderer/src/shared/stores/statusStore'
import type { Label, Project, Status, Task } from '../src/shared/types'
import '../src/renderer/src/assets/main.css'

const container = document.getElementById('root')!
const root = createRoot(container)
const pause = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const render = async (content: ReactNode): Promise<void> => { flushSync(() => root.render(content)); await pause() }
async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 1500
  while (!condition() && performance.now() < deadline) await pause(25)
  assert(condition(), message)
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
  assert(found, `Missing button: ${label}`)
  return found
}
async function click(element: HTMLElement, shiftKey = false): Promise<void> {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }))
  await pause()
}
const escape = async (): Promise<void> => {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await pause(40)
}
function closing(surface: HTMLElement, message: string): void {
  assert(surface.isConnected && surface.dataset.state === 'closed' && surface.inert && surface.getAttribute('aria-hidden') === 'true', message)
  const style = getComputedStyle(surface)
  assert(style.transitionProperty.includes('opacity') && parseFloat(style.transitionDuration) > 0, 'Pointer exit has no fade transition')
}

async function verify(): Promise<string> {
  await render(<MotionPresence open>{() => <div id="retained">Closing content</div>}</MotionPresence>)
  await render(<MotionPresence open={false}>{() => null}</MotionPresence>)
  const retained = document.getElementById('retained')!
  closing(retained, 'Nullable content vanished before its exit')
  await render(<MotionPresence open>{() => <div id="retained">Reopened</div>}</MotionPresence>)
  await pause(150)
  assert(document.getElementById('retained')?.textContent === 'Reopened', 'Interrupted exit removed reopened content')
  await render(<MotionPresence open={false}>{() => null}</MotionPresence>)
  await pause(150)
  assert(!document.getElementById('retained'), 'Exit did not unmount content')

  for (const [edge, instant] of [['side', false], ['side', true], ['bottom', false], ['bottom', true]] as const) {
    await render(<div className="ui-surface ui-panel" data-state="open" data-instant={instant} data-edge={edge} style={{ position: 'absolute', left: 240, top: 110, width: 400, height: 250 }}>
      <div id="viewport-child" style={{ position: 'fixed', left: 61, top: 37 }}>Viewport child</div>
    </div>)
    await pause(300)
    const rect = document.getElementById('viewport-child')!.getBoundingClientRect()
    assert(Math.abs(rect.left - 61) < 1 && Math.abs(rect.top - 37) < 1, `${edge} panel changed the fixed containing block`)
    const style = getComputedStyle(container.firstElementChild!)
    assert(style.transform === 'none' && style.translate === 'none' && style.scale === 'none', `${edge} panel retains a resting transform`)
  }
  for (const instant of [false, true]) {
    await render(<div style={{ position: 'absolute', left: 100, top: 400, width: 300 }}>
      <MotionPresence open instant={instant} origin="bottom center"><div id="centered" className="absolute left-1/2 -translate-x-1/2" style={{ width: 100 }}>Centered</div></MotionPresence>
    </div>)
    await pause(200)
    const centered = document.getElementById('centered')!
    assert(Math.abs(centered.getBoundingClientRect().left - 200) < 1, `Authored centering was lost (instant=${instant})`)
    assert(getComputedStyle(centered).transformOrigin === '50px 24px', 'Trigger origin was lost')
  }

  const project = { id: 'synthetic-project', name: 'Synthetic project', color: '#abcdef', is_archived: 0 } as Project
  const label = { id: 'synthetic-label', name: 'Synthetic label', color: '#abcdef' } as Label
  const status = { id: 'synthetic-status', project_id: project.id, name: 'Todo', color: '#abcdef' } as Status
  useProjectStore.setState({ projects: { [project.id]: project } })
  useStatusStore.setState({ statuses: { [status.id]: status } })
  useLabelStore.setState({ labels: { [label.id]: label } })
  await render(<FilterBar labels={[label]} projectId={project.id} showProjectFilter />)
  for (const name of ['Priority', 'Status', 'Due Date', 'Keyword', 'Labels', 'Projects']) {
    const trigger = button('Filter')
    trigger.focus()
    await click(trigger)
    await click(button(name))
    await pause(30)
    const picker = container.querySelector<HTMLElement>('.ui-surface[data-state="open"]')!
    assert(picker && picker.style.position === 'fixed', `${name} picker lacks shared presence`)
    assert(picker.getBoundingClientRect().left >= 0, `${name} picker lost its position`)
    if (name === 'Keyword') assert(picker.contains(document.activeElement), 'Keyword input did not receive focus')
    await click(document.body)
    closing(picker, `${name} picker lost closing content`)
    await waitFor(() => !picker.isConnected, `${name} picker remained mounted`)
  }
  await click(button('Filter'))
  await click(button('Keyword'))
  await pause(30)
  await escape()
  assert(!container.querySelector('.ui-surface'), 'Keyboard close should be immediate')
  assert(document.activeElement === button('Filter'), 'Filter focus did not return to its trigger')

  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = ((query: string) => query.includes('prefers-reduced-motion') ? { matches: true } : matchMedia(query)) as typeof window.matchMedia
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await render(null)
  await render(<MotionPresence open><div id="reduced">Reduced motion</div></MotionPresence>)
  assert(document.getElementById('reduced')?.dataset.instant === 'true', 'Reduced-motion open was animated')
  await render(<MotionPresence open={false}><div id="reduced">Reduced motion</div></MotionPresence>)
  await pause()
  assert(!document.getElementById('reduced'), 'Reduced-motion close was delayed')
  window.matchMedia = matchMedia

  const task = { id: 'synthetic-task', project_id: project.id, title: 'Synthetic archived task', is_archived: 1, status_id: status.id, priority: 0, updated_at: '2026-01-01T00:00:00Z' } as Task
  const changes: unknown[] = []
  useTaskStore.setState({ tasks: { [task.id]: task }, selectedTaskIds: new Set(), taskLabels: {},
    hydrateAllTaskLabels: async () => {}, updateTask: async (_id, input) => { changes.push(input); return task }, deleteTask: async () => { changes.push('delete'); return true } })
  await render(<ArchiveView />)
  await click(container.querySelector<HTMLElement>('.group.sticky')!)
  for (const action of ['Restore', 'Delete']) {
    const row = container.querySelector<HTMLElement>('[role="row"]')!
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 110 }))
    await pause(180)
    const menu = document.body.querySelector<HTMLElement>('.ui-menu')!
    assert(menu && menu.parentElement === document.body, 'Archive menu is missing its portal or shared presence')
    await click(button(action, menu), true)
    closing(menu, `Archive ${action} menu lost closing content`)
    await waitFor(() => !menu.isConnected, `Archive ${action} menu did not unmount`)
  }
  assert(JSON.stringify(changes) === '[{"is_archived":0},"delete"]', 'Archive actions changed behavior')

  for (const edge of ['side', 'bottom']) {
    await render(<div className="ui-surface ui-panel overflow-hidden" data-state="open" data-edge={edge} style={{ position: 'absolute', left: 300, top: 100, width: 450, height: 300 }}>
      <TiptapEditor key={edge} taskId="synthetic-task" content="[Example](https://example.invalid)" onChange={() => {}} />
    </div>)
    await pause(300)
    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')!
    editor.focus()
    const link = container.querySelector<HTMLElement>('a.tiptap-link')!
    assert(link, 'Synthetic editor link was not rendered')
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await pause(1250)
    const popover = document.body.querySelector<HTMLElement>('.ui-menu')!
    assert(popover && popover.parentElement === document.body, `${edge} link popover was not portaled`)
    const linkRect = link.getBoundingClientRect()
    const rect = popover.getBoundingClientRect()
    assert(Math.abs(rect.left - linkRect.left) < 1 && Math.abs(rect.top - linkRect.bottom - 4) < 1, `${edge} link popover has incorrect viewport coordinates`)
    await click(button('Edit', popover))
    assert(popover.contains(document.activeElement), 'Link editing lost focus')
    await click(button('Cancel', popover))
    closing(popover, 'Link popover did not retain its editing content')
    assert(popover.querySelectorAll('input').length === 2, 'Closing link content changed')
    await waitFor(() => !popover.isConnected, 'Link popover did not finish exiting')
    assert(document.activeElement === editor, 'Link focus did not return to the editor')
  }
  await render(null)
  return 'Popup behavior passed: retained exits/reopen, fixed coordinates, centering/origins, six filter pickers, archive actions, editor links, keyboard and reduced motion'
}

Object.assign(window, { popupMotionResult: verify() })
