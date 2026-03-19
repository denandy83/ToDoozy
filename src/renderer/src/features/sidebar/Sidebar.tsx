import { useCallback, useRef } from 'react'
import {
  Sun,
  Moon,
  Archive,
  LayoutTemplate,
  ListTodo,
  Inbox,
  PanelLeftClose,
  PanelLeft,
  Settings
} from 'lucide-react'
import { useViewStore } from '../../shared/stores/viewStore'
import { useSettingsStore, selectCurrentTheme } from '../../shared/stores/settingsStore'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import type { ViewId } from '../../shared/stores/viewStore'
import { useLabelStore } from '../../shared/stores/labelStore'
import type { ThemeConfig } from '../../../../shared/types'
import { NavItem } from './NavItem'

interface SidebarProps {
  counts: Record<ViewId, number>
  onSettings: () => void
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
  collapsed,
  pinned,
  isDragging,
  onTogglePin,
  onMouseEnter,
  onMouseLeave
}: SidebarProps): React.JSX.Element {
  const currentView = useViewStore((s) => s.currentView)
  const setView = useViewStore((s) => s.setView)
  const currentTheme = useSettingsStore(selectCurrentTheme)
  const themes = useSettingsStore((s) => s.themes)
  const { setSetting, setCurrentTheme } = useSettingsStore()
  const sidebarRef = useRef<HTMLElement>(null)
  const isDarkMode = currentTheme?.mode === 'dark'

  const handleToggleDayNight = useCallback(async () => {
    if (!currentTheme) return
    const newMode = isDarkMode ? 'light' : 'dark'
    // Find matching theme in opposite mode
    const currentName = currentTheme.name.replace(/ (Dark|Light)$/, '')
    const match = Object.values(themes).find((t) => {
      const name = t.name.replace(/ (Dark|Light)$/, '')
      return name === currentName && t.mode === newMode
    })
    const target = match ?? Object.values(themes).find((t) => t.mode === newMode)
    if (target) {
      try {
        const config = JSON.parse(target.config) as ThemeConfig
        applyThemeConfig(config)
        await setSetting('theme_id', target.id)
        await setSetting('theme_mode', newMode)
        setCurrentTheme(target.id)
      } catch {
        // Ignore parse errors
      }
    }
  }, [currentTheme, isDarkMode, themes, setSetting, setCurrentTheme])

  const clearLabelFilters = useLabelStore((s) => s.clearLabelFilters)

  const handleViewClick = useCallback(
    (view: ViewId) => {
      clearLabelFilters()
      setView(view)
    },
    [setView, clearLabelFilters]
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
      <div className="flex flex-col gap-1 border-t border-border p-1.5">
        <button
          onClick={handleToggleDayNight}
          className={`flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6 ${
            collapsed ? 'justify-center' : ''
          }`}
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
          {!collapsed && <span className="text-[11px] font-bold uppercase tracking-widest">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
        <button
          onClick={onSettings}
          className={`flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6 ${
            collapsed ? 'justify-center' : ''
          }`}
          title="Settings"
        >
          <Settings size={14} />
          {!collapsed && <span className="text-[11px] font-bold uppercase tracking-widest">Settings</span>}
        </button>
      </div>
    </aside>
  )
}
