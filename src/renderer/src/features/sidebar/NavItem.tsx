import { useDroppable } from '@dnd-kit/core'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  icon?: LucideIcon
  label: string
  count: number
  active: boolean
  collapsed: boolean
  onClick: () => void
  shortcutHint?: string
  droppableId?: string
  colorDot?: string
}

export function NavItem({
  icon: Icon,
  label,
  count,
  active,
  collapsed,
  onClick,
  shortcutHint,
  droppableId,
  colorDot
}: NavItemProps): React.JSX.Element {
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId ?? `nav-${label.toLowerCase().replace(/\s+/g, '-')}`,
    disabled: !droppableId
  })

  return (
    <button
      ref={droppableId ? setNodeRef : undefined}
      onClick={onClick}
      title={collapsed ? `${label}${shortcutHint ? ` (${shortcutHint})` : ''}` : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? 'bg-accent/12 text-foreground border border-accent/15'
          : 'border border-transparent text-muted hover:bg-foreground/6 hover:border-border/50'
      } ${collapsed ? 'justify-center px-0' : ''} ${
        isOver ? 'bg-accent/15 border-accent/30 scale-[1.02]' : ''
      }`}
      role="tab"
      aria-selected={active}
      tabIndex={-1}
    >
      {colorDot && (
        <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: colorDot }} />
      )}
      {Icon && <Icon size={16} className={active || isOver ? 'text-accent' : 'text-muted'} />}
      {!collapsed && (
        <>
          <span className="flex-1 text-[13px] font-light tracking-tight">{label}</span>
          {count > 0 && (
            <span
              className={`text-[10px] font-bold tabular-nums ${
                active ? 'text-accent' : 'text-muted/60'
              }`}
            >
              {count}
            </span>
          )}
        </>
      )}
      {collapsed && count > 0 && (
        <span
          className={`absolute bottom-0.5 right-0.5 text-[8px] font-bold tabular-nums leading-none ${
            active ? 'text-accent' : 'text-muted/60'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
