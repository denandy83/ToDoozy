import { ChevronRight } from 'lucide-react'
import { isValidElement, useRef } from 'react'
import { usePresence } from '../motion/usePresence'
import { useFocusRestore } from '../hooks/useFocusRestore'

/**
 * Shared context-menu primitives used by both ContextMenu (single task) and
 * BulkContextMenu (multi-select). One implementation, no duplication.
 */

export function Divider(): React.JSX.Element {
  return <div className="my-1 border-t border-border" />
}

/** Small uppercase group heading inside a menu (e.g. "Organize", "Schedule"). */
export function SectionLabel({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="ui-section-label px-3 pt-2 pb-0.5">
      {label}
    </div>
  )
}

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  /** Receives the click event so destructive items can detect Shift+click. */
  onClick: (e: React.MouseEvent) => void
  /** Right-aligned muted keyboard hint, display-only (no keyboard wiring). */
  shortcut?: string
  /** Red text + danger hover, for destructive actions. */
  danger?: boolean
}

export function MenuItem({ icon, label, onClick, shortcut, danger }: MenuItemProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] font-normal transition-colors ${
        danger ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-foreground/6'
      }`}
      role="menuitem"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{shortcut}</span>
      )}
    </button>
  )
}

interface FlyoutItemProps<T extends string> {
  id: T
  icon: React.ReactNode
  label: string
  activeSubmenu: T | null
  children: React.ReactNode
  onEnter: (id: T, instant?: boolean) => void
  onLeave: () => void
}

export function FlyoutItem<T extends string>({
  id,
  icon,
  label,
  activeSubmenu,
  children,
  onEnter,
  onLeave
}: FlyoutItemProps<T>): React.JSX.Element {
  const presence = usePresence(activeSubmenu === id)
  const ref = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  useFocusRestore(presence.present, submenuRef)
  const opensLeft = isValidElement<{ openLeft?: boolean }>(children) && children.props.openLeft
  return (
    <div ref={ref} className="relative" onMouseEnter={() => onEnter(id)} onMouseLeave={onLeave}>
      <button type="button"
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-[13px] font-normal transition-colors ${
          activeSubmenu === id ? 'bg-foreground/6 text-foreground' : 'text-foreground hover:bg-foreground/6'
        }`}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={activeSubmenu === id}
        onClick={() => onEnter(id, true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onEnter(id, true)
            requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('.ui-submenu-shell button')?.focus())
          }
        }}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight size={12} className="text-muted" />
      </button>
      {presence.present && <div ref={submenuRef} {...presence.props} className="ui-surface ui-menu ui-submenu-shell" style={{ transformOrigin: opensLeft ? 'left top' : 'right top' }}>{children}</div>}
    </div>
  )
}
