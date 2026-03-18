import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  icon: LucideIcon
  label: string
  count: number
  active: boolean
  collapsed: boolean
  onClick: () => void
  shortcutHint?: string
}

export function NavItem({
  icon: Icon,
  label,
  count,
  active,
  collapsed,
  onClick,
  shortcutHint
}: NavItemProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={collapsed ? `${label}${shortcutHint ? ` (${shortcutHint})` : ''}` : undefined}
      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? 'bg-accent/12 text-foreground border border-accent/15'
          : 'border border-transparent text-muted hover:bg-foreground/6 hover:border-border/50'
      } ${collapsed ? 'justify-center px-0' : ''}`}
      role="tab"
      aria-selected={active}
    >
      <Icon size={16} className={active ? 'text-accent' : 'text-muted'} />
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
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
