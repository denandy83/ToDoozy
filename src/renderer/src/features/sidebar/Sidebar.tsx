import { useCallback, useRef } from 'react'
import {
  Sun,
  Archive,
  LayoutTemplate,
  ListTodo,
  Inbox,
  PanelLeftClose,
  PanelLeft,
  Settings,
  Palette,
  LogOut
} from 'lucide-react'
import { useViewStore } from '../../shared/stores/viewStore'
import type { ViewId } from '../../shared/stores/viewStore'
import { NavItem } from './NavItem'

interface SidebarProps {
  counts: Record<ViewId, number>
  onSettings: () => void
  onThemeSettings: () => void
  onLogout: () => void
  collapsed: boolean
  pinned: boolean
  isDragging?: boolean
  onTogglePin: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const VIEW_ITEMS: Array<{
  id: ViewId
  label: string
  icon: typeof Sun
  shortcut: string
  droppableId: string
}> = [
  { id: 'my-day', label: 'My Day', icon: Sun, shortcut: '⌘1', droppableId: 'nav-my-day' },
  { id: 'backlog', label: 'Backlog', icon: Inbox, shortcut: '⌘2', droppableId: 'nav-backlog' },
  { id: 'archive', label: 'Archive', icon: Archive, shortcut: '⌘3', droppableId: 'nav-archive' },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, shortcut: '⌘4', droppableId: 'nav-templates' }
]

export function Sidebar({
  counts,
  onSettings,
  onThemeSettings,
  onLogout,
  collapsed,
  pinned,
  isDragging,
  onTogglePin,
  onMouseEnter,
  onMouseLeave
}: SidebarProps): React.JSX.Element {
  const currentView = useViewStore((s) => s.currentView)
  const setView = useViewStore((s) => s.setView)
  const sidebarRef = useRef<HTMLElement>(null)

  const handleViewClick = useCallback(
    (view: ViewId) => {
      setView(view)
    },
    [setView]
  )

  return (
    <aside
      ref={sidebarRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`flex flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Header */}
      <div className={`flex items-center border-b border-border ${collapsed ? 'justify-center p-2' : 'gap-2 p-3'}`}>
        {!collapsed && (
          <>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15">
              <ListTodo size={14} className="text-accent" />
            </div>
            <span className="flex-1 text-[13px] font-bold tracking-tight text-foreground">
              ToDoozy
            </span>
          </>
        )}
        <button
          onClick={onTogglePin}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-foreground/6"
          title={pinned ? 'Collapse sidebar' : 'Pin sidebar'}
        >
          {pinned ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 ${collapsed ? 'p-1.5' : 'p-3'}`}>
        {!collapsed && (
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            Views
          </p>
        )}
        <div className="flex flex-col gap-0.5" role="tablist" aria-label="Views">
          {VIEW_ITEMS.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              count={counts[item.id]}
              active={currentView === item.id}
              collapsed={collapsed}
              onClick={() => handleViewClick(item.id)}
              shortcutHint={item.shortcut}
              droppableId={isDragging ? item.droppableId : undefined}
            />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div
        className={`flex items-center border-t border-border ${
          collapsed ? 'flex-col gap-1 p-1.5' : 'gap-1 p-3'
        }`}
      >
        <button
          onClick={onSettings}
          className={`flex items-center gap-2 rounded-lg text-muted transition-colors hover:bg-foreground/6 ${
            collapsed ? 'p-2' : 'flex-1 px-2 py-1.5'
          }`}
          title="Project settings"
        >
          <Settings size={14} />
          {!collapsed && (
            <span className="text-[11px] font-bold uppercase tracking-widest">Settings</span>
          )}
        </button>
        <button
          onClick={onThemeSettings}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6"
          title="Theme settings"
        >
          <Palette size={14} />
        </button>
        <button
          onClick={onLogout}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6"
          title="Log out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  )
}
