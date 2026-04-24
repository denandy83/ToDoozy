import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Sun,
  Moon,
  Archive,
  Calendar,
  LayoutTemplate,
  FolderOpen,
  LayoutGrid,
  Plus,
  Settings,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Users,
  Filter,
  BarChart3
} from 'lucide-react'
import { useViewStore } from '../../shared/stores/viewStore'
import { useSettingsStore, selectCurrentTheme, useSetting } from '../../shared/stores/settingsStore'
import { applyThemeConfig } from '../../shared/hooks/useThemeApplicator'
import type { ViewId } from '../../shared/stores/viewStore'
import { useLabelStore } from '../../shared/stores/labelStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useAuthStore } from '../../shared/stores/authStore'
import { useSavedViewStore, selectSavedViews, selectViewCounts } from '../../shared/stores/savedViewStore'
import { useProjectAreaStore, selectProjectAreas } from '../../shared/stores/projectAreaStore'
import type { ThemeConfig } from '../../../../shared/types'
import { useSyncStore, selectSyncStatus, selectLastSyncedAt, selectIsFirstSync, selectFirstSyncProgress, selectRealtimeConnected, selectPendingCount } from '../../shared/stores/syncStore'
import type { SyncStatus } from '../../shared/stores/syncStore'
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
  isDragging?: boolean
}

// All configurable sidebar nav items (default order)
const DEFAULT_SIDEBAR_ORDER: string[] = ['my-day', 'calendar', 'views', 'projects', 'archive', 'templates']

const NAV_ITEM_CONFIG: Record<string, { label: string; icon: typeof Sun; droppableId: string }> = {
  'my-day': { label: 'My Day', icon: Sun, droppableId: 'nav-my-day' },
  'calendar': { label: 'Calendar', icon: Calendar, droppableId: 'nav-calendar' },
  'views': { label: 'Views', icon: Filter, droppableId: 'nav-views' },
  'archive': { label: 'Archive', icon: Archive, droppableId: 'nav-archive' },
  'templates': { label: 'Templates', icon: LayoutTemplate, droppableId: 'nav-templates' }
}

/** Returns the ordered, visible nav items based on sidebar settings */
export function useSidebarItems(): Array<{ id: string; shortcut: string }> {
  const orderJson = useSetting('sidebar_order')
  const hiddenJson = useSetting('sidebar_hidden')

  return useMemo(() => {
    let order: string[] = orderJson ? JSON.parse(orderJson) as string[] : DEFAULT_SIDEBAR_ORDER
    // Ensure any new items from DEFAULT_SIDEBAR_ORDER are included
    const orderSet = new Set(order)
    for (const item of DEFAULT_SIDEBAR_ORDER) {
      if (!orderSet.has(item)) order.push(item)
    }
    // Remove items that are no longer in the default set
    order = order.filter((id) => DEFAULT_SIDEBAR_ORDER.includes(id))
    const hidden: Set<string> = new Set(hiddenJson ? JSON.parse(hiddenJson) as string[] : [])
    // My Day is always visible
    hidden.delete('my-day')

    let shortcutIndex = 1
    return order
      .filter((id) => !hidden.has(id))
      .map((id) => ({
        id,
        shortcut: `⌘${shortcutIndex++}`
      }))
  }, [orderJson, hiddenJson])
}

const MAX_VISIBLE_PROJECTS = 5

export function Sidebar({
  viewCounts,
  projectCounts,
  projects,
  onSettings,
  onHelp,
  isDragging
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

  // Sidebar items based on settings
  const sidebarNavItems = useSidebarItems()

  // Saved views
  const savedViews = useSavedViewStore(selectSavedViews)
  const savedViewCounts = useSavedViewStore(selectViewCounts)
  const { hydrate: hydrateSavedViews, updateView, reorderViews } = useSavedViewStore()
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
    if (s.excludeLabelFilters.size > 0) config.excludeLabelIds = [...s.excludeLabelFilters]
    if (s.excludeStatusFilters.size > 0) config.excludeStatusIds = [...s.excludeStatusFilters]
    if (s.excludePriorityFilters.size > 0) config.excludePriorities = [...s.excludePriorityFilters]
    if (s.excludeAssigneeFilters.size > 0) config.excludeAssigneeIds = [...s.excludeAssigneeFilters]
    if (s.excludeProjectFilters.size > 0) config.excludeProjectIds = [...s.excludeProjectFilters]
    if (s.dueDatePreset) config.dueDatePreset = s.dueDatePreset
    if (s.dueDateRange) config.dueDateRange = s.dueDateRange
    if (s.keyword) config.keyword = s.keyword
    config.filterMode = s.filterMode
    if (s.sortRules.length > 0) config.sortRules = s.sortRules
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
      if (currentView === 'saved-view' && selectedSavedViewId === viewId) return
      guardNavigation(() => { clearLabelFilters(); setSelectedSavedView(viewId) })
    },
    [currentView, selectedSavedViewId, setSelectedSavedView, clearLabelFilters, guardNavigation]
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

  // Saved view context menu (right-click color picker)
  const [viewContextMenu, setViewContextMenu] = useState<{ viewId: string; x: number; y: number } | null>(null)
  const viewContextRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!viewContextMenu) return
    const handler = (e: MouseEvent): void => {
      if (viewContextRef.current && !viewContextRef.current.contains(e.target as Node)) {
        setViewContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [viewContextMenu])

  const handleViewContextMenu = useCallback((e: React.MouseEvent, viewId: string) => {
    e.preventDefault()
    setViewContextMenu({ viewId, x: e.clientX, y: e.clientY })
  }, [])

  const handleChangeViewColor = useCallback(async (viewId: string, color: string) => {
    await updateView(viewId, { color })
    setViewContextMenu(null)
  }, [updateView])

  // Render the projects section inline in the sidebar order
  const renderProjectsSection = (): React.JSX.Element => (
    <div key="projects" className="mt-1 flex flex-col gap-0.5">
      <div className="group/projects flex items-center gap-3 rounded-lg px-2.5 py-2">
        <div className="flex flex-1 items-center gap-3">
          <LayoutGrid size={16} className="text-muted" />
          <span className="flex-1 select-none text-[13px] font-light tracking-tight text-muted">Projects</span>
        </div>
        <button onClick={() => { setAddingArea(true); setTimeout(() => addAreaRef.current?.focus(), 0) }}
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted/0 transition-colors group-hover/projects:text-muted hover:text-foreground hover:bg-foreground/6"
          title="New folder" aria-label="New folder" tabIndex={-1}>
          <Plus size={8} /><span className="text-[7px] font-bold uppercase tracking-wider">Folder</span>
        </button>
        <button onClick={() => { setAddingProject(true); setTimeout(() => addProjectRef.current?.focus(), 0) }}
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted/0 transition-colors group-hover/projects:text-muted hover:text-foreground hover:bg-foreground/6"
          title="New project" aria-label="New project" tabIndex={-1}>
          <Plus size={10} /><span className="text-[8px] font-bold uppercase tracking-wider">Add</span>
        </button>
      </div>
      <div className="flex flex-col gap-0.5 pl-4">
        {addingArea && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background p-2">
            <input ref={addAreaRef} type="text" value={newAreaName} onChange={(e) => setNewAreaName(e.target.value)} tabIndex={-1}
              onKeyDown={(e) => { if (e.key === 'Enter' && newAreaName.trim()) handleCreateArea(); if (e.key === 'Escape') { e.stopPropagation(); setAddingArea(false); setNewAreaName('') } }}
              placeholder="Folder name..." className="flex-1 bg-transparent text-[12px] font-light text-foreground placeholder:text-muted/40 focus:outline-none" />
          </div>
        )}
        {addingProject && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2">
            <input ref={addProjectRef} type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} tabIndex={-1}
              onKeyDown={(e) => { if (e.key === 'Enter' && newProjectName.trim()) handleCreateProject(); if (e.key === 'Escape') { e.stopPropagation(); setAddingProject(false); setNewProjectName(''); setNewProjectColor('#6366f1') } }}
              placeholder="Project name..." className="w-full bg-transparent text-[12px] font-light text-foreground placeholder:text-muted/40 focus:outline-none" />
            <div className="flex items-center gap-1">
              {['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'].map((c) => (
                <button key={c} type="button" onMouseDown={(e) => { e.preventDefault(); setNewProjectColor(c) }}
                  className={`h-4 w-4 rounded-full ${newProjectColor === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        )}
        {sidebarItems.map((si) => {
          if (si.type === 'area') {
            const area = si.data
            const areaProjects = visibleProjects.filter((p) => p.area_id === area.id)
            return (
              <div key={`area-${area.id}`} className="mt-1">
                <button onClick={() => toggleAreaCollapsed(area.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/6">
                  <FolderOpen size={12} className="flex-shrink-0 text-muted" />
                  <span className="flex-1 text-[13px] font-light tracking-tight text-muted">{area.name}</span>
                  {/* no count for folders */}
                  {area.is_collapsed === 1 ? <ChevronDown size={12} className="text-muted/50" /> : <ChevronUp size={12} className="text-muted/50" />}
                </button>
                {area.is_collapsed === 0 && (
                  <div className="relative flex flex-col gap-0.5 pl-5">
                    <div className="absolute left-[16px] top-0 bottom-1 w-px bg-muted/40" />
                    {areaProjects.map((project) => (
                      <ProjectNavItem key={project.id} project={project} count={projectCounts[project.id] ?? 0}
                        active={currentView === 'project' && selectedProjectId === project.id}
                        onClick={() => handleProjectClick(project.id)} isDragging={isDragging} />
                    ))}
                  </div>
                )}
              </div>
            )
          }
          const project = si.data as Project
          return (
            <ProjectNavItem key={project.id} project={project} count={projectCounts[project.id] ?? 0}
              active={currentView === 'project' && selectedProjectId === project.id}
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
    </div>
  )

  // Render a nav item for "views" section (special — expands saved views list)
  const [viewsExpanded, setViewsExpanded] = useState(false)
  const MAX_VISIBLE_VIEWS = 5
  const viewSortSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleViewDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = savedViews.findIndex((v) => v.id === active.id)
    const newIndex = savedViews.findIndex((v) => v.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(savedViews, oldIndex, newIndex)
    reorderViews(reordered.map((v) => v.id))
  }, [savedViews, reorderViews])

  const renderViewsSection = (_shortcut: string): React.JSX.Element => {
    const visibleViews = viewsExpanded ? savedViews : savedViews.slice(0, MAX_VISIBLE_VIEWS)
    const hasMoreViews = savedViews.length > MAX_VISIBLE_VIEWS

    return (
      <div key="views" className="flex flex-col gap-0.5">
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
          <button onClick={() => setSavedViewsCollapsed(!savedViewsCollapsed)} className="text-muted" tabIndex={-1}>
            {savedViewsCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
        {!savedViewsCollapsed && savedViews.length > 0 && (
          <div className="flex flex-col gap-0.5 pl-4">
            <DndContext sensors={viewSortSensors} collisionDetection={closestCenter} onDragEnd={handleViewDragEnd}>
              <SortableContext items={visibleViews.map((v) => v.id)} strategy={verticalListSortingStrategy}>
                {visibleViews.map((view) => (
                  <SortableViewItem
                    key={view.id}
                    view={view}
                    count={savedViewCounts[view.id] ?? 0}
                    active={currentView === 'saved-view' && selectedSavedViewId === view.id}
                    onClick={() => handleSavedViewClick(view.id)}
                    onContextMenu={(e) => handleViewContextMenu(e, view.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {hasMoreViews && (
              <button onClick={() => setViewsExpanded(!viewsExpanded)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground" tabIndex={-1}>
                {viewsExpanded ? (<><ChevronUp size={12} />Less</>) : (<><ChevronDown size={12} />More</>)}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      ref={sidebarRef}
      tabIndex={-1}
      className="flex w-56 flex-col border-r border-border bg-surface select-none"
    >
      {/* Header */}
      <div className="flex h-[57px] items-center gap-2 border-b border-border px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
          <img src={appIcon} alt="ToDoozy" className="h-6 w-6" />
        </div>
        <span className="flex-1 text-[13px] font-bold tracking-tight text-foreground">
          ToDoozy
        </span>
        <SyncStatusIcon />
        {/* Light/Dark mode toggle — iOS-style sun/moon */}
        <button
          onClick={handleToggleDayNight}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-foreground/6"
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          tabIndex={-1}
        >
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3">
        {/* Dynamic nav items based on sidebar_order + sidebar_hidden */}
        <div className="flex flex-col gap-0.5" role="tablist" aria-label="Views">
          {sidebarNavItems.map((item) => {
            // "views" is a special section
            if (item.id === 'views') return renderViewsSection(item.shortcut)
            if (item.id === 'projects') return renderProjectsSection()
            const config = NAV_ITEM_CONFIG[item.id]
            if (!config) return null
            return (
              <NavItem
                key={item.id}
                icon={config.icon}
                label={config.label}
                count={viewCounts[item.id as keyof typeof viewCounts] ?? 0}
                active={currentView === item.id}
                collapsed={false}
                onClick={() => handleViewClick(item.id as ViewId)}
                shortcutHint={item.shortcut}
                droppableId={isDragging ? config.droppableId : undefined}
              />
            )
          })}
        </div>
      </nav>

      {/* Footer — Stats, Help, Settings, MCP */}
      <div className="flex flex-col gap-1 border-t border-border p-1.5">
        <button
          onClick={() => handleViewClick('stats')}
          className={`flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6 ${
            currentView === 'stats' ? 'bg-accent/12 text-foreground' : ''
          }`}
          title="Stats"
          tabIndex={-1}
        >
          <BarChart3 size={14} />
          <span className="text-[11px] font-bold uppercase tracking-widest">Stats</span>
        </button>
        <button
          onClick={onHelp}
          className="flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6"
          title="Keyboard shortcuts (?)"
          tabIndex={-1}
        >
          <HelpCircle size={14} strokeWidth={1.5} />
          <span className="text-[11px] font-bold uppercase tracking-widest">Shortcuts</span>
        </button>
        <button
          onClick={onSettings}
          className="flex items-center gap-2 rounded-lg p-2 text-muted transition-colors hover:bg-foreground/6"
          title="Settings"
          tabIndex={-1}
        >
          <Settings size={14} />
          <span className="text-[11px] font-bold uppercase tracking-widest">Settings</span>
        </button>
      </div>

      {/* Saved view context menu (color picker) */}
      {viewContextMenu && (
        <div
          ref={viewContextRef}
          className="fixed z-[100] rounded-lg border border-border bg-surface p-2 shadow-lg"
          style={{ left: viewContextMenu.x, top: viewContextMenu.y }}
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted mb-1.5">Color</div>
          <div className="flex flex-wrap gap-1" style={{ maxWidth: 120 }}>
            {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#6366f1', '#e11d48'].map((c) => (
              <button
                key={c}
                onClick={() => handleChangeViewColor(viewContextMenu.viewId, c)}
                className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: c, border: savedViews.find((v) => v.id === viewContextMenu.viewId)?.color === c ? '2px solid var(--foreground)' : '2px solid transparent' }}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

const STUCK_QUEUE_MS = 60 * 1000
const STALENESS_TICK_MS = 30 * 1000

type StaleReason = 'offline' | 'realtime-down' | 'queue-stuck'

function SyncStatusIcon(): React.JSX.Element {
  const syncStatus = useSyncStore(selectSyncStatus)
  const lastSyncedAt = useSyncStore(selectLastSyncedAt)
  const errorMessage = useSyncStore((s) => s.errorMessage)
  const isFirstSync = useSyncStore(selectIsFirstSync)
  const firstSyncProgress = useSyncStore(selectFirstSyncProgress)
  const realtimeConnected = useSyncStore(selectRealtimeConnected)
  const pendingCount = useSyncStore(selectPendingCount)
  const [showTooltip, setShowTooltip] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [, setTick] = useState(0)

  // Track browser online/offline events with a 3s debounce on offline transitions
  // so the UI doesn't flash red for sub-second network hiccups.
  useEffect(() => {
    const OFFLINE_DEBOUNCE_MS = 3000
    let pendingOffline: ReturnType<typeof setTimeout> | null = null

    const goOnline = (): void => {
      if (pendingOffline) {
        clearTimeout(pendingOffline)
        pendingOffline = null
      }
      setIsOnline(true)
    }
    const goOffline = (): void => {
      if (pendingOffline) return
      pendingOffline = setTimeout(() => {
        pendingOffline = null
        if (!navigator.onLine) setIsOnline(false)
      }, OFFLINE_DEBOUNCE_MS)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      if (pendingOffline) clearTimeout(pendingOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Re-evaluate staleness on a timer so the dot flips without needing an unrelated render
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), STALENESS_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Sync is stale (red) when:
  //  - the device is offline,
  //  - the Supabase Realtime channel is down, or
  //  - local writes are queued and the queue hasn't drained in the last minute.
  // An idle session with Realtime up and no pending work is NOT stale regardless of elapsed time.
  let staleReason: StaleReason | null = null
  if (!isOnline) staleReason = 'offline'
  else if (!realtimeConnected) staleReason = 'realtime-down'
  else if (
    pendingCount > 0
    && lastSyncedAt
    && Date.now() - new Date(lastSyncedAt).getTime() > STUCK_QUEUE_MS
  ) staleReason = 'queue-stuck'

  const isStale = staleReason !== null
  const effectiveStatus: SyncStatus = isStale ? 'error' : syncStatus

  const formatTime = (iso: string | null): string => {
    if (!iso) return 'Never'
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const dotColor: Record<SyncStatus, string> = {
    synced: '#22c55e',
    syncing: '#3b82f6',
    offline: '#f97316',
    error: '#ef4444'
  }

  const statusLabel: Record<SyncStatus, string> = {
    synced: 'Synced',
    syncing: 'Syncing...',
    offline: 'Offline',
    error: 'Sync error'
  }

  const staleLabel: Record<StaleReason, string> = {
    'offline': 'Offline',
    'realtime-down': 'Supabase unreachable',
    'queue-stuck': 'Sync stuck'
  }
  const staleMessage: Record<StaleReason, string> = {
    'offline': 'No internet connection — changes will sync when you reconnect',
    'realtime-down': 'Lost connection to Supabase — check your network or re-login',
    'queue-stuck': `${pendingCount} local change${pendingCount === 1 ? '' : 's'} haven't uploaded — check your connection`
  }

  const effectiveLabel = staleReason ? staleLabel[staleReason] : statusLabel[syncStatus]
  const effectiveMessage = errorMessage ?? (staleReason ? staleMessage[staleReason] : null)

  return (
    <div className="relative">
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        onBlur={() => setShowTooltip(false)}
        className="flex items-center rounded p-1 text-muted transition-colors hover:bg-foreground/6"
        title={effectiveLabel}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${effectiveStatus === 'syncing' ? 'animate-pulse' : ''} ${effectiveStatus === 'error' ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: dotColor[effectiveStatus] }}
        />
      </button>
      {showTooltip && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-border bg-surface p-2 shadow-lg">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            {effectiveLabel}
          </div>
          {effectiveMessage && (
            <div className="mt-1 rounded bg-danger/10 px-2 py-1 text-[10px] font-light text-danger">
              {effectiveMessage}
            </div>
          )}
          {isFirstSync && (
            <div className="mt-1">
              <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${firstSyncProgress}%` }}
                />
              </div>
              <div className="mt-0.5 text-[9px] font-light text-muted">{firstSyncProgress}%</div>
            </div>
          )}
          <div className="mt-1 text-[9px] font-light text-muted">
            Last synced: {formatTime(lastSyncedAt)}
          </div>
        </div>
      )}
    </div>
  )
}

interface ProjectNavItemProps {
  project: Project
  count: number
  active: boolean
  onClick: () => void
  shortcutHint?: string
  isDragging?: boolean
}

interface SortableViewItemProps {
  view: { id: string; name: string; color: string }
  count: number
  active: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function SortableViewItem({ view, count, active, onClick, onContextMenu }: SortableViewItemProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id })
  const [mouseDown, setMouseDown] = useState(false)
  const grabbing = isDragging || mouseDown
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onMouseDown={(e) => { setMouseDown(true); listeners?.onMouseDown?.(e) }}
      onMouseUp={() => setMouseDown(false)}
      onContextMenu={onContextMenu}
      className={`${grabbing ? '[&_*]:cursor-grabbing [&]:cursor-grabbing' : '[&_*]:cursor-grab [&]:cursor-grab'}`}
    >
      <NavItem
        label={view.name}
        count={count}
        active={active}
        collapsed={false}
        onClick={onClick}
        colorDot={view.color}
      />
    </div>
  )
}

function ProjectNavItem({
  project,
  count,
  active,
  onClick,
  isDragging
}: ProjectNavItemProps): React.JSX.Element {
  const memberCount = useProjectStore((s) => s.members[project.id]?.length ?? 0)
  const droppableId = isDragging ? `nav-project-${project.id}` : undefined
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId ?? `nav-project-${project.id}`,
    disabled: !droppableId
  })

  return (
    <button
      ref={droppableId ? setNodeRef : undefined}
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? 'bg-accent/12 text-foreground border border-accent/15'
          : 'border border-transparent text-muted hover:bg-foreground/6 hover:border-border/50'
      } ${
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
      <span className="flex-1 truncate text-[13px] font-light tracking-tight">
        {project.name}
      </span>
      {memberCount > 1 && (
        <Users size={12} className="flex-shrink-0 text-muted/50" />
      )}
      {count > 0 && (
        <span className="text-[10px] font-bold tabular-nums text-muted/50">{count}</span>
      )}
    </button>
  )
}
