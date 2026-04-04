import { useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../shared/hooks/useFocusTrap'
import { useFocusRestore } from '../../shared/hooks/useFocusRestore'
import { useSetting } from '../../shared/stores/settingsStore'
import { useSidebarItems } from '../sidebar'

interface ShortcutRowProps {
  keys: string[]
  description: string
}

function ShortcutRow({ keys, description }: ShortcutRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm font-light text-foreground">{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-muted"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps): React.JSX.Element {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{title}</p>
      <div className="flex flex-col divide-y divide-border/50">{children}</div>
    </div>
  )
}

const NAV_NAMES: Record<string, string> = {
  'my-day': 'My Day',
  'calendar': 'Calendar',
  'views': 'Views (first saved view)',
  'projects': 'Projects (first project)',
  'archive': 'Archive',
  'templates': 'Templates'
}

function DynamicNavigationShortcuts(): React.JSX.Element {
  const items = useSidebarItems()
  return (
    <Section title="Navigation">
      {items.map((item) => (
        <ShortcutRow key={item.id} keys={['⌘', item.shortcut.replace('⌘', '')]} description={NAV_NAMES[item.id] ?? item.id} />
      ))}
      <ShortcutRow keys={['⌘', 'L']} description="Toggle kanban / list view" />
      <ShortcutRow keys={['Tab']} description="Cycle to next project" />
      <ShortcutRow keys={['Shift', 'Tab']} description="Cycle to previous project" />
    </Section>
  )
}

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const appToggleShortcut = useSetting('app_toggle_shortcut') ?? 'Cmd+Shift+B'

  useFocusRestore()
  useFocusTrap(containerRef, open)

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [onClose]
  )

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl focus:outline-none motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Keyboard Shortcuts</p>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Shortcuts content */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            <DynamicNavigationShortcuts />

            <Section title="Tasks">
              <ShortcutRow keys={['Enter']} description="Open task detail panel" />
              <ShortcutRow keys={['Space']} description="Toggle task status" />
              <ShortcutRow keys={['⌘', 'C']} description="Copy selected task title(s)" />
              <ShortcutRow keys={['Delete']} description="Delete selected task(s)" />
              <ShortcutRow keys={['Shift', 'Click']} description="Select a range of tasks" />
              <ShortcutRow keys={['⌘', 'Click']} description="Toggle individual task selection" />
              <ShortcutRow keys={['Drag']} description="Reorder tasks or make subtask" />
            </Section>

            <Section title="Detail Panel">
              <ShortcutRow keys={['Tab']} description="Cycle through fields (title → status → priority → labels → due date → description)" />
              <ShortcutRow keys={['Shift', 'Tab']} description="Reverse through fields" />
              <ShortcutRow keys={['Escape']} description="Close panel, return focus to task list" />
            </Section>

            <Section title="Global">
              <ShortcutRow keys={['⌘', 'K']} description="Open command palette" />
              <ShortcutRow keys={['?']} description="Show this shortcuts reference" />
              <ShortcutRow keys={[appToggleShortcut]} description="Show / hide ToDoozy from anywhere" />
            </Section>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
