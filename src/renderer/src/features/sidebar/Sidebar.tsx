import { useCallback, useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  Sun,
  Moon,
  Archive,
  LayoutTemplate,
  FolderOpen,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Settings,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useViewStore } from '../../shared/stores/viewStore'
import { useSettingsStore, selectCurrentTheme } from '../../shared/stores/settingsStore'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import type { ViewId } from '../../shared/stores/viewStore'
import { useLabelStore } from '../../shared/stores/labelStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useAuthStore } from '../../shared/stores/authStore'
import type { ThemeConfig } from '../../../../shared/types'
import appIcon from '../../assets/icon.png'
import type { Project } from '../../../../shared/types'
import { NavItem } from './NavItem'

interface SidebarProps {
  viewCounts: { 'my-day': number; archive: number; templates: number }
  projectCounts: Record<string, number>
  projects: Project[]
  onSettings: () => void
  onNewProject?: () => void
  collapsed: boolean
  pinned: boolean
  isDragging?: boolean
  onTogglePin: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const TOP_VIEW_ITEMS: Array<{
  id: ViewId
  label: string
  icon: typeof Sun
  shortcut: string
  droppableId: string
}> = [
  { id: 'my-day', label: 'My Day', icon: Sun, shortcut: '⌘1', droppableId: 'nav-my-day' }
]

const BOTTOM_VIEW_ITEMS: Array<{
  id: ViewId
  label: string
  icon: typeof Sun
  shortcut: string
  droppableId: string
}> = [
  { id: 'archive', label: 'Archive', icon: Archive, shortcut: '⌘3', droppableId: 'nav-archive' },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, shortcut: '⌘4', droppableId: 'nav-templates' }
]

const MAX_VISIBLE_PROJECTS = 5

export function Sidebar({
  viewCounts,
  projectCounts,
  projects,
  onSettings,
  collapsed,
  pinned,
  isDragging,
  onTogglePin,
  onMouseEnter,
  onMouseLeave
}: SidebarProps): React.JSX.Element {
  const currentView = useViewStore((s) => s.currentView)
  const selectedProjectId = useViewStore((s) => s.selectedProjectId)
  const setView = useViewStore((s) => s.setView)
  const setSelectedProject = useViewStore((s) => s.setSelectedProject)
  const currentTheme = useSettingsStore(selectCurrentTheme)
  const themes = useSettingsStore((s) => s.themes)
  const { setSetting, setCurrentTheme } = useSettingsStore()
  const sidebarRef = useRef<HTMLElement>(null)
  const isDarkMode = currentTheme?.mode === 'dark'
  const [projectsExpanded, setProjectsExpanded] = useState(false)
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const addProjectRef = useRef<HTMLInputElement>(null)
  const createProject = useProjectStore((s) => s.createProject)
  const createStatus = useStatusStore((s) => s.createStatus)
  const currentUser = useAuthStore((s) => s.currentUser)

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim()
    if (!name || !currentUser) return
    const id = crypto.randomUUID()
    const maxOrder = projects.reduce((max, p) => Math.max(max, p.sidebar_order ?? 0, projects.length - 1), 0)
    const project = await createProject({
      id, name, owner_id: currentUser.id, color: '#6366f1', icon: 'folder', is_default: 0, sidebar_order: maxOrder + 1
    })
    await window.api.projects.addMember(id, currentUser.id, 'owner', currentUser.id)
    for (const s of [
      { name: 'Not Started', color: '#888888', icon: 'circle', order_index: 0, is_default: 1, is_done: 0 },
      { name: 'In Progress', color: '#f59e0b', icon: 'clock', order_index: 1, is_default: 0, is_done: 0 },
      { name: 'Done', color: '#22c55e', icon: 'check-circle', order_index: 2, is_default: 0, is_done: 1 }
    ]) {
      await createStatus({ id: crypto.randomUUID(), project_id: id, ...s })
    }
    useLabelStore.getState().clearLabelFilters()
    setSelectedProject(project.id)
    setAddingProject(false)
    setNewProjectName('')
  }, [newProjectName, currentUser, projects, createProject, createStatus, setSelectedProject])

  // Auto-expand projects when the selected project is beyond the visible top 5
  useEffect(() => {
    if (currentView !== 'project' || !selectedProjectId) return
    const idx = projects.findIndex((p) => p.id === selectedProjectId)
    if (idx >= MAX_VISIBLE_PROJECTS && !projectsExpanded) {
      setProjectsExpanded(true)
    }
  }, [currentView, selectedProjectId, projects, projectsExpanded])

  const handleToggleDayNight = useCallback(async () => {
    if (!currentTheme) return
    const newMode = isDarkMode ? 'light' : 'dark'
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

  const handleProjectClick = useCallback(
    (projectId: string) => {
      clearLabelFilters()
      setSelectedProject(projectId)
    },
    [setSelectedProject, clearLabelFilters]
  )

  const sortedProjects = projects
  const visibleProjects = projectsExpanded
    ? sortedProjects
    : sortedProjects.slice(0, MAX_VISIBLE_PROJECTS)
  const hasMoreProjects = sortedProjects.length > MAX_VISIBLE_PROJECTS

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
              <img src={appIcon} alt="ToDoozy" className="h-5 w-5" />
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
      <nav className={`flex-1 overflow-y-auto ${collapsed ? 'p-1.5' : 'p-3'}`}>
        {/* My Day */}
        <div className="flex flex-col gap-0.5" role="tablist" aria-label="Views">
          {TOP_VIEW_ITEMS.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              count={viewCounts[item.id as keyof typeof viewCounts] ?? 0}
              active={currentView === item.id}
              collapsed={collapsed}
              onClick={() => handleViewClick(item.id)}
              shortcutHint={item.shortcut}
              droppableId={isDragging ? item.droppableId : undefined}
            />
          ))}
        </div>

        {/* Projects — header as nav item, projects indented */}
        <div className="mt-1 flex flex-col gap-0.5">
          {!collapsed ? (
            <div className="group/projects flex items-center gap-3 rounded-lg px-2.5 py-2">
              <FolderOpen size={16} className="text-muted" />
              <span className="flex-1 text-[13px] font-light tracking-tight text-muted">Projects</span>
              <button
                onClick={() => { setAddingProject(true); setTimeout(() => addProjectRef.current?.focus(), 0) }}
                className="rounded p-0.5 text-muted/0 transition-colors group-hover/projects:text-muted hover:text-foreground hover:bg-foreground/6"
                title="New project"
                aria-label="New project"
              >
                <Plus size={14} />
              </button>
            </div>
          ) : (
            <div className="flex justify-center rounded-lg px-0 py-2">
              <FolderOpen size={16} className="text-muted" />
            </div>
          )}
          {!collapsed && (
            <div className="flex flex-col gap-0.5 pl-4">
              {addingProject && (
                <input
                  ref={addProjectRef}
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProjectName.trim()) {
                      handleCreateProject()
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setAddingProject(false)
                      setNewProjectName('')
                    }
                  }}
                  onBlur={() => { setAddingProject(false); setNewProjectName('') }}
                  placeholder="Project name..."
                  className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-[13px] font-light tracking-tight text-foreground placeholder:text-muted/40 focus:border-accent focus:outline-none"
                />
              )}
              {visibleProjects.map((project) => (
                <ProjectNavItem
                  key={project.id}
                  project={project}
                  count={projectCounts[project.id] ?? 0}
                  active={currentView === 'project' && selectedProjectId === project.id}
                  collapsed={collapsed}
                  onClick={() => handleProjectClick(project.id)}
                  isDragging={isDragging}
                />
              ))}
              {hasMoreProjects && (
                <button
                  onClick={() => setProjectsExpanded(!projectsExpanded)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground"
                >
                  {projectsExpanded ? (
                    <>
                      <ChevronUp size={12} />
                      Less
                    </>
                  ) : (
                    <>
                      <ChevronDown size={12} />
                      More
                    </>
                  )}
                </button>
              )}
            </div>
          )}
          {collapsed && (
            <div className="flex flex-col gap-0.5">
              {visibleProjects.map((project) => (
                <ProjectNavItem
                  key={project.id}
                  project={project}
                  count={projectCounts[project.id] ?? 0}
                  active={currentView === 'project' && selectedProjectId === project.id}
                  collapsed={collapsed}
                  onClick={() => handleProjectClick(project.id)}
                  isDragging={isDragging}
                />
              ))}
            </div>
          )}
        </div>

        {/* Archive & Templates */}
        <div className="mt-1" />
        <div className="flex flex-col gap-0.5">
          {BOTTOM_VIEW_ITEMS.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              count={viewCounts[item.id as keyof typeof viewCounts] ?? 0}
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

interface ProjectNavItemProps {
  project: Project
  count: number
  active: boolean
  collapsed: boolean
  onClick: () => void
  shortcutHint?: string
  isDragging?: boolean
}

function ProjectNavItem({
  project,
  count,
  active,
  collapsed,
  onClick,
  shortcutHint,
  isDragging
}: ProjectNavItemProps): React.JSX.Element {
  const droppableId = isDragging ? `nav-project-${project.id}` : undefined
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId ?? `nav-project-${project.id}`,
    disabled: !droppableId
  })

  return (
    <button
      ref={droppableId ? setNodeRef : undefined}
      onClick={onClick}
      title={collapsed ? `${project.name}${shortcutHint ? ` (${shortcutHint})` : ''}` : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? 'bg-accent/12 text-foreground border border-accent/15'
          : 'border border-transparent text-muted hover:bg-foreground/6 hover:border-border/50'
      } ${collapsed ? 'justify-center px-0' : ''} ${
        isOver ? 'bg-accent/15 border-accent/30 scale-[1.02]' : ''
      }`}
      role="tab"
      aria-selected={active}
    >
      <div
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-[13px] font-light tracking-tight">
            {project.name}
          </span>
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
