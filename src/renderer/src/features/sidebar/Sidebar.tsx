import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { useDroppable } from '@dnd-kit/core'
import {
  Sun,
  Moon,
  Archive,
  Calendar,
  LayoutTemplate,
  FolderOpen,
  LayoutGrid,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Settings,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Users,
  Filter,
  BarChart3
} from 'lucide-react'
import { useViewStore } from '../../shared/stores/viewStore'
import { useSettingsStore, selectCurrentTheme } from '../../shared/stores/settingsStore'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import type { ViewId } from '../../shared/stores/viewStore'
import { useLabelStore } from '../../shared/stores/labelStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useAuthStore } from '../../shared/stores/authStore'
import { useSavedViewStore, selectSavedViews, selectViewCounts } from '../../shared/stores/savedViewStore'
import { useProjectAreaStore, selectProjectAreas } from '../../shared/stores/projectAreaStore'
import type { ThemeConfig } from '../../../../shared/types'
import appIcon from '../../assets/icon.png'
import type { Project } from '../../../../shared/types'
import { NavItem } from './NavItem'

interface SidebarProps {
  viewCounts: { 'my-day': number; archive: number; templates: number }
  projectCounts: Record<string, number>
  projects: Project[]
  onSettings: () => void
  onHelp: () => void
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
  { id: 'my-day', label: 'My Day', icon: Sun, shortcut: '⌘1', droppableId: 'nav-my-day' },
  { id: 'calendar', label: 'Calendar', icon: Calendar, shortcut: '⌘2', droppableId: 'nav-calendar' },
  { id: 'stats', label: 'Stats', icon: BarChart3, shortcut: '⌘3', droppableId: 'nav-stats' }
]

const BOTTOM_VIEW_ITEMS: Array<{
  id: ViewId
  label: string
  icon: typeof Sun
  shortcut: string
  droppableId: string
}> = [
  { id: 'archive', label: 'Archive', icon: Archive, shortcut: '⌘5', droppableId: 'nav-archive' },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, shortcut: '⌘6', droppableId: 'nav-templates' }
]

const MAX_VISIBLE_PROJECTS = 5

export function Sidebar({
  viewCounts,
  projectCounts,
  projects,
  onSettings,
  onHelp,
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
  const [newProjectColor, setNewProjectColor] = useState('#6366f1')
  const addProjectRef = useRef<HTMLInputElement>(null)
  const createProject = useProjectStore((s) => s.createProject)
  const createStatus = useStatusStore((s) => s.createStatus)
  const currentUser = useAuthStore((s) => s.currentUser)

  // Saved views
  const savedViews = useSavedViewStore(selectSavedViews)
  const savedViewCounts = useSavedViewStore(selectViewCounts)
  const { hydrate: hydrateSavedViews } = useSavedViewStore()
  const selectedSavedViewId = useViewStore((s) => s.selectedSavedViewId)
  const setSelectedSavedView = useViewStore((s) => s.setSelectedSavedView)
  const [savedViewsCollapsed, setSavedViewsCollapsed] = useState(false)
  const { addToast } = useToast()

  // Check if the active saved view has unsaved filter changes
  const getSavedViewDirtyState = useCallback((): { dirty: boolean; viewId: string | null; currentConfig: string } => {
    const { activeViewFilterConfig } = useSavedViewStore.getState()
    if (!activeViewFilterConfig || currentView !== 'saved-view') return { dirty: false, viewId: null, currentConfig: '' }
    const s = useLabelStore.getState()
    const config: Record<string, unknown> = {}
    if (s.activeLabelFilters.size > 0) config.labelIds = [...s.activeLabelFilters]
    if (s.assigneeFilters.size > 0) config.assigneeIds = [...s.assigneeFilters]
    if (s.priorityFilters.size > 0) config.priorities = [...s.priorityFilters]
    if (s.statusFilters.size > 0) config.statusIds = [...s.statusFilters]
    if (s.projectFilters.size > 0) config.projectIds = [...s.projectFilters]
    if (s.dueDatePreset) config.dueDatePreset = s.dueDatePreset
    if (s.dueDateRange) config.dueDateRange = s.dueDateRange
    if (s.keyword) config.keyword = s.keyword
    config.filterMode = s.filterMode
    const currentConfig = JSON.stringify(config)
    return { dirty: currentConfig !== activeViewFilterConfig, viewId: selectedSavedViewId, currentConfig }
  }, [currentView, selectedSavedViewId])

  /** Wraps a navigation callback — if saved view has unsaved filters, shows confirm toast first */
  const guardNavigation = useCallback((onNavigate: () => void): void => {
    const { dirty, viewId, currentConfig } = getSavedViewDirtyState()
    if (!dirty) { onNavigate(); return }
    addToast({
      message: 'Unsaved filter changes',
      persistent: true,
      actions: [
        {
          label: 'Save',
          variant: 'accent',
          onClick: async () => {
            if (viewId) await useSavedViewStore.getState().updateView(viewId, { filter_config: currentConfig })
            useSavedViewStore.getState().setActiveViewFilterConfig(null)
            onNavigate()
          }
        },
        {
          label: 'Discard',
          variant: 'danger',
          onClick: () => {
            useSavedViewStore.getState().setActiveViewFilterConfig(null)
            onNavigate()
          }
        }
      ]
    })
  }, [getSavedViewDirtyState, addToast])

  // Project areas
  const projectAreas = useProjectAreaStore(selectProjectAreas)
  const { hydrate: hydrateAreas, createArea, toggleCollapsed: toggleAreaCollapsed } = useProjectAreaStore()
  const [addingArea, setAddingArea] = useState(false)
  const [newAreaName, setNewAreaName] = useState('')
  const addAreaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (currentUser?.id) {
      hydrateSavedViews(currentUser.id)
      hydrateAreas(currentUser.id)
    }
  }, [currentUser?.id, hydrateSavedViews, hydrateAreas])

  const handleCreateArea = useCallback(async () => {
    const name = newAreaName.trim()
    if (!name || !currentUser) return
    await createArea(currentUser.id, name)
    setAddingArea(false)
    setNewAreaName('')
  }, [newAreaName, currentUser, createArea])

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim()
    if (!name || !currentUser) return
    const id = crypto.randomUUID()
    const maxOrder = projects.reduce((max, p) => Math.max(max, p.sidebar_order ?? 0, projects.length - 1), 0)
    const project = await createProject({
      id, name, owner_id: currentUser.id, color: newProjectColor, icon: 'folder', is_default: 0, sidebar_order: maxOrder + 1
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
    setNewProjectColor('#6366f1')
  }, [newProjectName, newProjectColor, currentUser, projects, createProject, createStatus, setSelectedProject])

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
      guardNavigation(() => { clearLabelFilters(); setView(view) })
    },
    [setView, clearLabelFilters, guardNavigation]
  )

  const handleSavedViewClick = useCallback(
    (viewId: string) => {
      guardNavigation(() => { clearLabelFilters(); setSelectedSavedView(viewId) })
    },
    [setSelectedSavedView, clearLabelFilters, guardNavigation]
  )

  const { createView: createSavedView } = useSavedViewStore()
  const handleCreateSavedView = useCallback(async () => {
    if (!currentUser) return
    guardNavigation(async () => {
      const view = await createSavedView(currentUser.id, 'New View', JSON.stringify({ filterMode: 'hide' }))
      clearLabelFilters()
      setSelectedSavedView(view.id)
    })
  }, [currentUser, createSavedView, clearLabelFilters, setSelectedSavedView, guardNavigation])

  const handleProjectClick = useCallback(
    (projectId: string) => {
      guardNavigation(() => {
        clearLabelFilters()
        setSelectedProject(projectId)
        useTaskStore.setState({ selectedTaskIds: new Set(), lastSelectedTaskId: null, showDetailPanel: false })
      })
    },
    [setSelectedProject, clearLabelFilters, guardNavigation]
  )

  const sortedProjects = projects
  const visibleProjects = projectsExpanded
    ? sortedProjects
    : sortedProjects.slice(0, MAX_VISIBLE_PROJECTS)
  const hasMoreProjects = sortedProjects.length > MAX_VISIBLE_PROJECTS

  // Build interleaved sidebar list: ungrouped projects and areas share a unified sidebar_order
  type SidebarItem = { type: 'project'; data: Project; order: number } | { type: 'area'; data: typeof projectAreas[0]; order: number }
  const sidebarItems = useMemo((): SidebarItem[] => {
    const items: SidebarItem[] = []
    for (const p of visibleProjects.filter((p) => !p.area_id)) {
      items.push({ type: 'project', data: p, order: p.sidebar_order })
    }
    for (const a of projectAreas) {
      items.push({ type: 'area', data: a, order: a.sidebar_order })
    }
    return items.sort((a, b) => a.order - b.order)
  }, [visibleProjects, projectAreas])

  return (
    <aside
      ref={sidebarRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      tabIndex={-1}
      className={`flex flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Header */}
      <div className={`flex h-[57px] items-center border-b border-border ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'}`}>
        {!collapsed && (
          <>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <img src={appIcon} alt="ToDoozy" className="h-6 w-6" />
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
          tabIndex={-1}
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

        {/* Views */}
        <div className="mt-1 flex flex-col gap-0.5">
          {!collapsed ? (
            <div className="group/savedviews flex items-center gap-3 rounded-lg px-2.5 py-2">
              <button
                onClick={() => setSavedViewsCollapsed(!savedViewsCollapsed)}
                className="flex flex-1 items-center gap-3 text-left"
              >
                <Filter size={16} className="text-muted" />
                <span className="flex-1 text-[13px] font-light tracking-tight text-muted">Views</span>
              </button>
              <button
                onClick={handleCreateSavedView}
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted/0 transition-colors group-hover/savedviews:text-muted hover:text-foreground hover:bg-foreground/6"
                title="New saved view"
              >
                <Plus size={10} />
                Add
              </button>
              {savedViewsCollapsed ? <ChevronDown size={12} className="text-muted" /> : <ChevronUp size={12} className="text-muted" />}
            </div>
          ) : (
            <div className="flex justify-center rounded-lg px-0 py-2">
              <Filter size={16} className="text-muted" />
            </div>
          )}
          {!collapsed && !savedViewsCollapsed && savedViews.length > 0 && (
            <div className="flex flex-col gap-0.5 pl-[38px]">
              {savedViews.map((view) => (
                <NavItem
                  key={view.id}
                  label={view.name}
                  count={savedViewCounts[view.id] ?? 0}
                  active={currentView === 'saved-view' && selectedSavedViewId === view.id}
                  collapsed={collapsed}
                  onClick={() => handleSavedViewClick(view.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Projects — header with Add buttons, projects grouped by area */}
        <div className="mt-1 flex flex-col gap-0.5">
          {!collapsed ? (
            <div className="group/projects flex items-center gap-3 rounded-lg px-2.5 py-2">
              <div className="flex flex-1 items-center gap-3">
                <LayoutGrid size={16} className="text-muted" />
                <span className="flex-1 select-none text-[13px] font-light tracking-tight text-muted">Projects</span>
              </div>
              <button
                onClick={() => { setAddingArea(true); setTimeout(() => addAreaRef.current?.focus(), 0) }}
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted/0 transition-colors group-hover/projects:text-muted hover:text-foreground hover:bg-foreground/6"
                title="New folder"
                aria-label="New folder"
                tabIndex={-1}
              >
                <Plus size={8} />
                <span className="text-[7px] font-bold uppercase tracking-wider">Folder</span>
              </button>
              <button
                onClick={() => { setAddingProject(true); setTimeout(() => addProjectRef.current?.focus(), 0) }}
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted/0 transition-colors group-hover/projects:text-muted hover:text-foreground hover:bg-foreground/6"
                title="New project"
                aria-label="New project"
                tabIndex={-1}
              >
                <Plus size={10} />
                <span className="text-[8px] font-bold uppercase tracking-wider">Add</span>
              </button>
            </div>
          ) : (
            <div className="flex justify-center rounded-lg px-0 py-2">
              <LayoutGrid size={16} className="text-muted" />
            </div>
          )}
          {!collapsed && (
            <div className="flex flex-col gap-0.5 pl-4">
              {/* New area input */}
              {addingArea && (
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background p-2">
                  <input
                    ref={addAreaRef}
                    type="text"
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                    tabIndex={-1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newAreaName.trim()) handleCreateArea()
                      if (e.key === 'Escape') { e.stopPropagation(); setAddingArea(false); setNewAreaName('') }
                    }}
                    placeholder="Folder name..."
                    className="flex-1 bg-transparent text-[12px] font-light text-foreground placeholder:text-muted/40 focus:outline-none"
                  />
                </div>
              )}

              {/* New project input */}
              {addingProject && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2">
                  <input
                    ref={addProjectRef}
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    tabIndex={-1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newProjectName.trim()) handleCreateProject()
                      if (e.key === 'Escape') { e.stopPropagation(); setAddingProject(false); setNewProjectName(''); setNewProjectColor('#6366f1') }
                    }}
                    placeholder="Project name..."
                    className="w-full bg-transparent text-[12px] font-light text-foreground placeholder:text-muted/40 focus:outline-none"
                  />
                  <div className="flex items-center gap-1">
                    {['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'].map((c) => (
                      <button key={c} type="button" onMouseDown={(e) => { e.preventDefault(); setNewProjectColor(c) }}
                        className={`h-4 w-4 rounded-full ${newProjectColor === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : ''}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Interleaved: ungrouped projects and area groups in unified sidebar_order */}
              {sidebarItems.map((item) => {
                if (item.type === 'area') {
                  const area = item.data
                  const areaProjects = visibleProjects.filter((p) => p.area_id === area.id)
                  return (
                    <div key={`area-${area.id}`} className="mt-1">
                      <button
                        onClick={() => toggleAreaCollapsed(area.id)}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/6"
                      >
                        <FolderOpen size={12} className="flex-shrink-0 text-muted" />
                        <span className="flex-1 text-[13px] font-light tracking-tight text-muted">{area.name}</span>
                        {areaProjects.length > 0 && (
                          <span className="text-[10px] font-bold tabular-nums text-muted/60">{areaProjects.length}</span>
                        )}
                        {area.is_collapsed === 1 ? <ChevronDown size={12} className="text-muted/50" /> : <ChevronUp size={12} className="text-muted/50" />}
                      </button>
                      {area.is_collapsed === 0 && (
                        <div className="flex flex-col gap-0.5 pl-5">
                          {areaProjects.map((project) => (
                            <ProjectNavItem key={project.id} project={project} count={projectCounts[project.id] ?? 0}
                              active={currentView === 'project' && selectedProjectId === project.id} collapsed={collapsed}
                              onClick={() => handleProjectClick(project.id)} isDragging={isDragging} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                const project = item.data as Project
                return (
                  <ProjectNavItem key={project.id} project={project} count={projectCounts[project.id] ?? 0}
                    active={currentView === 'project' && selectedProjectId === project.id} collapsed={collapsed}
                    onClick={() => handleProjectClick(project.id)} isDragging={isDragging} />
                )
              })}

              {hasMoreProjects && (
                <button onClick={() => setProjectsExpanded(!projectsExpanded)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground" tabIndex={-1}>
                  {projectsExpanded ? (<><ChevronUp size={12} />Less</>) : (<><ChevronDown size={12} />More</>)}
                </button>
              )}
            </div>
          )}
          {collapsed && (
            <div className="flex flex-col gap-0.5">
              {visibleProjects.map((project) => (
                <ProjectNavItem key={project.id} project={project} count={projectCounts[project.id] ?? 0}
                  active={currentView === 'project' && selectedProjectId === project.id} collapsed={collapsed}
                  onClick={() => handleProjectClick(project.id)} isDragging={isDragging} />
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
          tabIndex={-1}
        >
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
          {!collapsed && <span className="text-[11px] font-bold uppercase tracking-widest">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
        <button
          onClick={onHelp}
          className={`flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6 ${
            collapsed ? 'justify-center' : ''
          }`}
          title="Keyboard shortcuts & help (?)"
          tabIndex={-1}
        >
          <HelpCircle size={14} strokeWidth={1.5} />
          {!collapsed && <span className="text-[11px] font-bold uppercase tracking-widest">Help</span>}
        </button>
        <button
          onClick={onSettings}
          className={`flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6 ${
            collapsed ? 'justify-center' : ''
          }`}
          title="Settings"
          tabIndex={-1}
        >
          <Settings size={14} />
          {!collapsed && <span className="text-[11px] font-bold uppercase tracking-widest">Settings</span>}
        </button>
        <McpIndicator collapsed={collapsed} />
      </div>
    </aside>
  )
}

function McpIndicator({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<{ running: boolean; instanceCount: number } | null>(null)

  useEffect(() => {
    const check = (): void => {
      window.api.mcp.isRunning().then(setStatus).catch(() => setStatus({ running: false, instanceCount: 0 }))
    }
    check()
    const interval = setInterval(check, 15_000)
    return () => clearInterval(interval)
  }, [])

  if (status === null) return <></>

  const label = status.running
    ? status.instanceCount > 1
      ? `MCP (${status.instanceCount})`
      : 'MCP'
    : 'MCP Offline'

  const tooltip = status.running
    ? `MCP server running (${status.instanceCount} instance${status.instanceCount > 1 ? 's' : ''})`
    : 'MCP server not running — restart Claude Code or Desktop to reconnect'

  return (
    <div
      className={`flex items-center gap-2 rounded-lg p-2 ${collapsed ? 'justify-center' : ''}`}
      title={tooltip}
    >
      <div className={`h-2 w-2 rounded-full ${status.running ? 'bg-success' : 'bg-danger animate-pulse'}`} />
      {!collapsed && (
        <span className={`text-[9px] font-bold uppercase tracking-wider ${status.running ? 'text-success/60' : 'text-danger/60'}`}>
          {label}
        </span>
      )}
    </div>
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
      tabIndex={-1}
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
          {project.is_shared === 1 && (
            <Users size={12} className="flex-shrink-0 text-muted/50" />
          )}
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
