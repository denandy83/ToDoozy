import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { LogOut, Pencil, Plus, X, Check } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Modal } from '../../shared/components/Modal'
import { useProjectStore, selectAllProjects, useStatusStore } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import { useToast } from '../../shared/components/Toast'
import { StatusList } from '../projects/StatusList'
import { ThemeSettingsContent, type ThemeSettingsHandle } from './ThemeSettingsContent'
import { PrioritySettingsContent } from './PrioritySettingsContent'
import { LabelSettingsContent } from './LabelSettingsContent'
import { ShortcutRecorder, AppToggleShortcutRecorder } from './ShortcutRecorder'
import { McpSettingsContent } from './McpSettingsContent'
import { TimerSettingsContent } from './TimerSettingsContent'
import { NotificationsSettingsContent } from './NotificationsSettingsContent'
import { HelpSettingsContent } from '../help/HelpSettingsContent'
import type { Project } from '../../../../shared/types'
import { MemberSettings } from '../collaboration/MemberSettings'

type Tab = 'general' | 'projects' | 'themes' | 'priorities' | 'labels' | 'mcp' | 'timer' | 'notifications' | 'whatsnew' | 'help'

interface UnifiedSettingsModalProps {
  open: boolean
  onClose: () => void
  projectId: string | null
  initialTab?: string
}

export function UnifiedSettingsModal({
  open,
  onClose,
  projectId,
  initialTab
}: UnifiedSettingsModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<Tab>((initialTab as Tab) ?? 'general')
  const projects = useProjectStore(selectAllProjects)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId)
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const statuses = useStatusesByProject(selectedProjectId ?? '')
  const hydrateStatuses = useStatusStore((s) => s.hydrateStatuses)
  const logout = useAuthStore((s) => s.logout)
  const { addToast } = useToast()
  const themeRef = useRef<ThemeSettingsHandle>(null)
  const [themeDirty, setThemeDirty] = useState(false)
  const [pendingUnsaved, setPendingUnsaved] = useState(false)
  const [themeBlocked, setThemeBlocked] = useState(false)
  const [shake, setShake] = useState(false)

  // Sync selected project when modal opens or projectId changes
  useEffect(() => {
    if (open && projectId) {
      setSelectedProjectId(projectId)
    }
  }, [open, projectId])

  useEffect(() => {
    if (open && selectedProjectId) {
      hydrateStatuses(selectedProjectId)
    }
  }, [open, selectedProjectId, hydrateStatuses])

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab as Tab)
    }
  }, [open, initialTab])

  const triggerShake = useCallback(() => {
    setShake(true)
    setTimeout(() => setShake(false), 300)
  }, [])

  const showUnsavedThemeToast = useCallback((onDone: () => void): void => {
    if (pendingUnsaved) {
      triggerShake()
      return
    }
    setPendingUnsaved(true)
    triggerShake()
    addToast({
      message: 'Unsaved theme changes',
      persistent: true,
      actions: [
        {
          label: 'Apply',
          variant: 'accent',
          onClick: async () => {
            await themeRef.current?.apply()
            setPendingUnsaved(false)
            onDone()
          }
        },
        {
          label: 'Discard',
          variant: 'danger',
          onClick: () => {
            themeRef.current?.revert()
            setPendingUnsaved(false)
            onDone()
          }
        },
        {
          label: 'Cancel',
          variant: 'muted',
          onClick: () => {
            setPendingUnsaved(false)
          }
        }
      ]
    })
  }, [addToast, pendingUnsaved, triggerShake])

  const handleTabChange = useCallback((tab: Tab): void => {
    if (activeTab === 'themes' && tab !== 'themes') {
      if (themeDirty) {
        showUnsavedThemeToast(() => setActiveTab(tab))
        return
      }
      // Revert preview even if just browsing (no color edits)
      themeRef.current?.revert()
    }
    setActiveTab(tab)
  }, [activeTab, themeDirty, showUnsavedThemeToast])

  const handleClose = useCallback((): void => {
    if (activeTab === 'themes') {
      if (themeDirty) {
        showUnsavedThemeToast(() => {
          setActiveTab('general')
          onClose()
        })
        return
      }
      themeRef.current?.revert()
    }
    setActiveTab('general')
    onClose()
  }, [onClose, activeTab, themeDirty, showUnsavedThemeToast])

  const handleLogout = useCallback(async (): Promise<void> => {
    await logout()
    handleClose()
  }, [logout, handleClose])

  const handleProjectChange = useCallback((id: string) => {
    setSelectedProjectId(id)
  }, [])

  if (!open) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'projects', label: 'Projects' },
    { key: 'themes', label: 'Themes' },
    { key: 'priorities', label: 'Priorities' },
    { key: 'labels', label: 'Labels' },
    { key: 'mcp', label: 'MCP' },
    { key: 'timer', label: 'Timer' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'whatsnew', label: "What's New" },
    { key: 'help', label: 'Help' }
  ]

  return (
    <Modal open={open} onClose={handleClose} title="Settings" size="large" className={shake ? 'modal-shake' : ''}>
      {/* Block interaction when a persistent toast is active */}
      {(pendingUnsaved || themeBlocked) && (
        <div
          className="absolute inset-0 z-10 cursor-not-allowed"
          onClick={(e) => { e.stopPropagation(); triggerShake() }}
        />
      )}
      <div className={`flex gap-6 h-[600px] ${(pendingUnsaved || themeBlocked) ? 'pointer-events-none opacity-60' : ''}`}>
        {/* Left nav — fixed, no scroll */}
        <nav className="flex flex-col gap-1 min-w-[120px] flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`relative rounded-lg px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent/12 text-accent'
                  : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {tab.label}
              {tab.key === 'whatsnew' && <WhatsNewDot />}
            </button>
          ))}

          <div className="mt-auto">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10"
            >
              <LogOut size={12} />
              Logout
            </button>
          </div>
        </nav>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto pr-3">
          {activeTab === 'general' && (
            <GeneralSettings />
          )}
          {activeTab === 'projects' && (
            <ProjectsTab
              projects={projects}
              selectedProject={selectedProject}
              selectedProjectId={selectedProjectId}
              statuses={statuses}
              onProjectChange={handleProjectChange}
              onClose={handleClose}
              addToast={addToast}
            />
          )}
          {activeTab === 'themes' && (
            <ThemeSettingsContent ref={themeRef} onDirtyChange={setThemeDirty} onBlockingChange={setThemeBlocked} />
          )}
          {activeTab === 'priorities' && (
            <PrioritySettingsContent />
          )}
          {activeTab === 'labels' && (
            <LabelSettingsContent />
          )}
          {activeTab === 'mcp' && (
            <McpSettingsContent />
          )}
          {activeTab === 'timer' && (
            <TimerSettingsContent />
          )}
          {activeTab === 'notifications' && (
            <NotificationsSettingsContent />
          )}
          {activeTab === 'whatsnew' && (
            <WhatsNewContent />
          )}
          {activeTab === 'help' && (
            <HelpSettingsContent />
          )}
        </div>
      </div>
    </Modal>
  )
}

function GeneralSettings(): React.JSX.Element {
  const addPosition = useSetting('new_task_position') ?? 'top'
  const { setSetting } = useSettingsStore()
  const projects = useProjectStore(selectAllProjects)
  const dateFormat = useSetting('date_format') ?? 'dd/mm/yyyy'
  const quickAddDefaultProject = useSetting('quickadd_default_project') ?? ''
  const myDayDefaultProject = useSetting('myday_default_project') ?? ''

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        General
      </p>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Default task position</p>
          <p className="text-[10px] text-muted">Where tasks appear when created or moved to a status group</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('new_task_position', 'top')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              addPosition === 'top'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Top
          </button>
          <button
            onClick={() => setSetting('new_task_position', 'bottom')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              addPosition === 'bottom'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Bottom
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Date format</p>
          <p className="text-[10px] text-muted">How dates are displayed throughout the app</p>
        </div>
        <select
          value={dateFormat}
          onChange={(e) => setSetting('date_format', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          <option value="dd/mm/yyyy">DD/MM/YYYY</option>
          <option value="mm/dd/yyyy">MM/DD/YYYY</option>
          <option value="yyyy/mm/dd">YYYY/MM/DD</option>
        </select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Quick-add default My Day</p>
          <p className="text-[10px] text-muted">Auto-check "My Day" when using the quick-add window</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('quickadd_default_myday', 'true')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              (useSetting('quickadd_default_myday') ?? 'true') === 'true'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => setSetting('quickadd_default_myday', 'false')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              (useSetting('quickadd_default_myday') ?? 'true') === 'false'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Quick-add default project</p>
          <p className="text-[10px] text-muted">Pre-selected project when opening quick-add</p>
        </div>
        <select
          value={quickAddDefaultProject || (projects.find((p) => p.is_default === 1)?.id ?? projects[0]?.id ?? '')}
          onChange={(e) => setSetting('quickadd_default_project', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">My Day default project</p>
          <p className="text-[10px] text-muted">Pre-selected project when adding tasks in My Day</p>
        </div>
        <select
          value={myDayDefaultProject || (projects.find((p) => p.is_default === 1)?.id ?? projects[0]?.id ?? '')}
          onChange={(e) => setSetting('myday_default_project', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Shift+click to delete</p>
          <p className="text-[10px] text-muted">Hold Shift while clicking delete to skip confirmation</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('shift_delete_enabled', 'true')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              (useSetting('shift_delete_enabled') ?? 'false') === 'true'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => setSetting('shift_delete_enabled', 'false')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              (useSetting('shift_delete_enabled') ?? 'false') === 'false'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Click opens detail panel</p>
          <p className="text-[10px] text-muted">Open the detail panel when clicking a task. When off, use double-click or Enter.</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('click_opens_detail', 'true')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              (useSetting('click_opens_detail') ?? 'true') === 'true'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => setSetting('click_opens_detail', 'false')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              (useSetting('click_opens_detail') ?? 'true') === 'false'
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>

      <LaunchAtLoginSetting />
      <AutoArchiveSetting />
      <ShortcutRecorder />
      <AppToggleShortcutRecorder />
    </div>
  )
}

function WhatsNewDot(): React.JSX.Element | null {
  const whatsNew = useSetting('whats_new') ?? ''
  const lastSeen = useSetting('whats_new_seen') ?? ''

  if (!whatsNew) return null
  // Compare the first ## version header to see if there's new content
  const firstHeader = whatsNew.split('\n').find((l) => l.startsWith('## ')) ?? ''
  if (lastSeen === firstHeader) return null

  return (
    <span className="absolute right-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-accent" />
  )
}

function WhatsNewContent(): React.JSX.Element {
  const whatsNew = useSetting('whats_new') ?? ''
  const { setSetting } = useSettingsStore()

  // Mark as seen when the tab is viewed
  useEffect(() => {
    if (whatsNew) {
      const firstLine = whatsNew.split('\n').find((l) => l.startsWith('## ')) ?? ''
      setSetting('whats_new_seen', firstLine)
    }
  }, [whatsNew, setSetting])

  // Parse version-based changelog: ## vX.Y.Z headers with flat bullet items
  const sections = useMemo(() => {
    if (!whatsNew) return []
    const result: Array<{
      version: string
      items: Array<{ title: string; desc: string }>
    }> = []

    let currentSection: (typeof result)[0] | null = null

    for (const line of whatsNew.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === '---') continue

      // ## vX.Y.Z header
      if (trimmed.startsWith('## ')) {
        if (currentSection) result.push(currentSection)
        currentSection = { version: trimmed.slice(3).trim(), items: [] }
        continue
      }

      // - **Title** — Description
      if (trimmed.startsWith('- ') && currentSection) {
        const content = trimmed.slice(2)
        const boldMatch = content.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/)
        if (boldMatch) {
          currentSection.items.push({ title: boldMatch[1], desc: boldMatch[2] })
        } else {
          currentSection.items.push({ title: content.replace(/\*\*/g, ''), desc: '' })
        }
      }
    }

    if (currentSection) result.push(currentSection)
    return result
  }, [whatsNew])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{"What's New"}</p>

      {sections.length > 0 ? (
        sections.map((section) => (
          <div key={section.version} className="flex flex-col gap-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent">
              {section.version}
            </p>
            {section.items.map((item, j) => (
              <div key={j} className="flex flex-col gap-0.5 py-1.5 border-b border-border/30 last:border-0">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                {item.desc && <p className="text-sm font-light text-muted">{item.desc}</p>}
              </div>
            ))}
          </div>
        ))
      ) : (
        <p className="text-sm font-light text-muted">No updates yet.</p>
      )}
    </div>
  )
}

function LaunchAtLoginSetting(): React.JSX.Element {
  const [openAtLogin, setOpenAtLogin] = useState(false)

  useEffect(() => {
    window.api.app.getLoginItemSettings().then((settings) => {
      setOpenAtLogin(settings.openAtLogin)
    })
  }, [])

  const toggle = (value: boolean): void => {
    setOpenAtLogin(value)
    window.api.app.setLoginItemSettings(value)
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-light text-foreground">Launch at login</p>
        <p className="text-[10px] text-muted">Start ToDoozy automatically when you log into your Mac</p>
      </div>
      <div className="flex rounded-lg border border-border overflow-hidden">
        <button
          onClick={() => toggle(true)}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            openAtLogin
              ? 'bg-accent/12 text-accent'
              : 'text-muted hover:bg-foreground/6'
          }`}
        >
          On
        </button>
        <button
          onClick={() => toggle(false)}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            !openAtLogin
              ? 'bg-accent/12 text-accent'
              : 'text-muted hover:bg-foreground/6'
          }`}
        >
          Off
        </button>
      </div>
    </div>
  )
}

function AutoArchiveSetting(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const enabledSetting = useSetting('auto_archive_enabled') ?? 'false'
  const valueSetting = useSetting('auto_archive_value') ?? '3'
  const unitSetting = useSetting('auto_archive_unit') ?? 'days'
  const enabled = enabledSetting === 'true'

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-light text-foreground">Auto-archive after done</p>
        <p className="text-[10px] text-muted">Automatically archive tasks after being done for a set time</p>
      </div>
      <div className="flex items-center gap-2">
        {enabled && (
          <>
            <input
              type="number"
              min={1}
              max={999}
              value={valueSetting}
              onChange={(e) => setSetting('auto_archive_value', e.target.value)}
              className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <select
              value={unitSetting}
              onChange={(e) => setSetting('auto_archive_unit', e.target.value)}
              className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
            >
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </>
        )}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('auto_archive_enabled', 'true')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              enabled
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => setSetting('auto_archive_enabled', 'false')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              !enabled
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>
    </div>
  )
}

interface ProjectsTabProps {
  projects: Project[]
  selectedProject: Project | null
  selectedProjectId: string | null
  statuses: import('../../../../shared/types').Status[]
  onProjectChange: (id: string) => void
  onClose: () => void
  addToast: ReturnType<typeof useToast>['addToast']
}

function ProjectsTab({
  projects,
  selectedProject,
  selectedProjectId,
  statuses,
  onProjectChange,
  onClose,
  addToast
}: ProjectsTabProps): React.JSX.Element {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(selectedProject?.name ?? '')
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#6366f1')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const newProjectInputRef = useRef<HTMLInputElement>(null)
  const updateProject = useProjectStore((s) => s.updateProject)
  const createProject = useProjectStore((s) => s.createProject)
  const createStatus = useStatusStore((s) => s.createStatus)
  const currentUser = useAuthStore((s) => s.currentUser)

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.sidebar_order - b.sidebar_order),
    [projects]
  )
  const projectIds = useMemo(() => sortedProjects.map((p) => p.id), [sortedProjects])

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 }
  })
  const sensors = useSensors(pointerSensor)

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = sortedProjects.findIndex((p) => p.id === active.id)
      const newIndex = sortedProjects.findIndex((p) => p.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = [...sortedProjects]
      const [moved] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, moved)

      const updates = reordered.map((p, i) => ({ id: p.id, sidebar_order: i }))
      await window.api.projects.updateSidebarOrder(updates)

      // Refresh projects from DB
      const userId = useProjectStore.getState().currentProjectId
      if (userId) {
        // Re-hydrate to pick up new sidebar_order values
        // Use a simple approach: update local state directly
        for (const u of updates) {
          const proj = useProjectStore.getState().projects[u.id]
          if (proj) {
            useProjectStore.setState((state) => ({
              projects: {
                ...state.projects,
                [u.id]: { ...proj, sidebar_order: u.sidebar_order }
              }
            }))
          }
        }
      }
    },
    [sortedProjects]
  )

  useEffect(() => {
    if (addingProject) newProjectInputRef.current?.focus()
  }, [addingProject])

  const handleAddProject = useCallback(async () => {
    const name = newProjectName.trim()
    if (!name || !currentUser) return
    const id = crypto.randomUUID()
    const maxOrder = sortedProjects.reduce((max, p) => Math.max(max, p.sidebar_order ?? 0, sortedProjects.length - 1), 0)
    const project = await createProject({
      id,
      name,
      owner_id: currentUser.id,
      color: newProjectColor,
      icon: 'folder',
      is_default: 0,
      sidebar_order: maxOrder + 1
    })
    await window.api.projects.addMember(id, currentUser.id, 'owner', currentUser.id)
    // Seed default statuses
    for (const s of [
      { name: 'Not Started', color: '#888888', icon: 'circle', order_index: 0, is_default: 1, is_done: 0 },
      { name: 'In Progress', color: '#f59e0b', icon: 'clock', order_index: 1, is_default: 0, is_done: 0 },
      { name: 'Done', color: '#22c55e', icon: 'check-circle', order_index: 2, is_default: 0, is_done: 1 }
    ]) {
      await createStatus({ id: crypto.randomUUID(), project_id: id, ...s })
    }
    onProjectChange(project.id)
    setNewProjectName('')
    setNewProjectColor('#6366f1')
    setAddingProject(false)
  }, [newProjectName, newProjectColor, currentUser, sortedProjects, createProject, createStatus, onProjectChange])

  useEffect(() => {
    setNameValue(selectedProject?.name ?? '')
    setEditingName(false)
  }, [selectedProject?.id, selectedProject?.name])

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  const handleSaveName = useCallback(() => {
    const trimmed = nameValue.trim()
    if (trimmed && selectedProjectId && trimmed !== selectedProject?.name) {
      updateProject(selectedProjectId, { name: trimmed })
    }
    setEditingName(false)
  }, [nameValue, selectedProjectId, selectedProject?.name, updateProject])

  return (
    <div className="flex flex-col gap-6">
      {/* Header: Project title + Add */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Project
        </p>
        <button
          onClick={() => setAddingProject(true)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {/* Add project form */}
      {addingProject && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
          <input
            ref={newProjectInputRef}
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddProject()
              if (e.key === 'Escape') { e.stopPropagation(); setAddingProject(false) }
            }}
            placeholder="Project name"
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted">Color</span>
              {['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewProjectColor(c)}
                  className={`h-5 w-5 rounded-full ${newProjectColor === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setAddingProject(false)} className="rounded p-1.5 text-muted transition-colors hover:bg-foreground/6">
                <X size={14} />
              </button>
              <button onClick={handleAddProject} disabled={!newProjectName.trim()} className="rounded p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-50">
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project selector: color dot + dropdown + pencil */}
      <div className="flex items-center gap-3">
        {selectedProject && (
          <ProjectColorPicker project={selectedProject} />
        )}
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveName()
              if (e.key === 'Escape') { e.stopPropagation(); setEditingName(false); setNameValue(selectedProject?.name ?? '') }
            }}
            className="flex-1 rounded-lg border border-accent bg-background px-3 py-1.5 text-sm text-foreground outline-none"
          />
        ) : (
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => onProjectChange(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {sortedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => setEditingName(!editingName)}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          title="Rename project"
        >
          <Pencil size={12} />
        </button>
      </div>

      {/* Selected project settings */}
      {selectedProject && selectedProjectId && (
        <div className="flex flex-col gap-6">

          {/* Statuses */}
          <StatusList
            projectId={selectedProjectId}
            statuses={statuses}
          />

          {/* Sidebar order */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
              Sidebar Order
            </p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-0.5">
                  {sortedProjects.map((p) => (
                    <SortableProjectRow
                      key={p.id}
                      project={p}
                      isSelected={p.id === selectedProjectId}
                      onClick={() => onProjectChange(p.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* Members — only for shared projects */}
          {selectedProject.is_shared === 1 && (
            <MemberSettings project={selectedProject} onToast={(msg) => addToast({ message: msg })} />
          )}

          {/* Delete — always last */}
          <ProjectDeleteSection
            project={selectedProject}
            isLastProject={sortedProjects.length <= 1}
            onClose={onClose}
            addToast={addToast}
          />
        </div>
      )}
    </div>
  )
}

function SortableProjectRow({
  project,
  isSelected,
  onClick
}: {
  project: Project
  isSelected: boolean
  onClick: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id
  })

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
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors cursor-pointer ${
        isSelected ? 'bg-accent/12 border border-accent/15' : 'border border-transparent hover:bg-foreground/6'
      }`}
      onClick={onClick}
    >
      <div
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
      />
      <span className="flex-1 truncate text-sm font-light text-foreground">
        {project.name}
      </span>
    </div>
  )
}

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'
]

function ProjectColorPicker({ project }: { project: Project }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const updateProject = useProjectStore((s) => s.updateProject)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="h-6 w-6 rounded-full ring-2 ring-transparent transition-all hover:ring-foreground/20"
        style={{ backgroundColor: project.color }}
        title="Change color"
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-lg">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { updateProject(project.id, { color: c }); setOpen(false) }}
              className={`h-5 w-5 rounded-full transition-transform ${
                project.color === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-surface' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ProjectDeleteSectionProps {
  project: Project
  isLastProject: boolean
  onClose: () => void
  addToast: (toast: { message: string; variant?: 'default' | 'danger' }) => void
}

function ProjectDeleteSection({ project, isLastProject, onClose, addToast }: ProjectDeleteSectionProps): React.JSX.Element | null {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteProject = useProjectStore((s) => s.deleteProject)

  const handleDelete = async (): Promise<void> => {
    try {
      await deleteProject(project.id)
      addToast({ message: `Deleted "${project.name}"`, variant: 'danger' })
      onClose()
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete project',
        variant: 'danger'
      })
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      {!confirmDelete ? (
        <button
          onClick={(e) => { if (!isLastProject) { e.shiftKey ? handleDelete() : setConfirmDelete(true) } }}
          className={`rounded-lg border border-danger/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors ${isLastProject ? 'opacity-30' : 'hover:bg-danger/10'}`}
          title={isLastProject ? "Can't delete the last project" : "Delete project (Shift+click to skip confirmation)"}
        >
          Delete Project
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm font-light text-danger">Are you sure?</span>
          <button
            onClick={handleDelete}
            className="rounded-lg bg-danger px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg"
          >
            Confirm Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:bg-foreground/6"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
