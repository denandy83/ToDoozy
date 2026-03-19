import { useState, useEffect, useCallback, useRef } from 'react'
import { LogOut, Pencil } from 'lucide-react'
import { Modal } from '../../shared/components/Modal'
import { useProjectStore, selectAllProjects, useStatusStore } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { StatusList } from '../projects/StatusList'
import { ThemeSettingsContent, type ThemeSettingsHandle } from './ThemeSettingsContent'
import { PrioritySettingsContent } from './PrioritySettingsContent'
import { LabelSettingsContent } from './LabelSettingsContent'
import type { Project } from '../../../../shared/types'

type Tab = 'general' | 'projects' | 'themes' | 'priorities' | 'labels'

interface UnifiedSettingsModalProps {
  open: boolean
  onClose: () => void
  projectId: string | null
  initialTab?: Tab
}

export function UnifiedSettingsModal({
  open,
  onClose,
  projectId,
  initialTab
}: UnifiedSettingsModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'general')
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
      setActiveTab(initialTab)
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
      // Revert preview even if just browsing
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
    { key: 'labels', label: 'Labels' }
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
      <div className={`flex gap-6 h-[500px] ${(pendingUnsaved || themeBlocked) ? 'pointer-events-none opacity-60' : ''}`}>
        {/* Left nav — fixed, no scroll */}
        <nav className="flex flex-col gap-1 min-w-[120px] flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent/12 text-accent'
                  : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {tab.label}
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
        <div className="flex-1 overflow-y-auto">
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
        </div>
      </div>
    </Modal>
  )
}

function GeneralSettings(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        General
      </p>
      <p className="text-sm font-light text-fg-secondary">
        App-wide settings will be added here — sidebar behavior, app icon, hotkeys, and more.
      </p>
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
  addToast: (toast: { message: string; variant?: 'default' | 'danger'; action?: { label: string; onClick: () => void } }) => void
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
  const nameInputRef = useRef<HTMLInputElement>(null)
  const updateProject = useProjectStore((s) => s.updateProject)

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
      {/* Project selector + rename */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Project</span>
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveName()
              if (e.key === 'Escape') { setEditingName(false); setNameValue(selectedProject?.name ?? '') }
            }}
            className="flex-1 rounded-lg border border-accent bg-background px-3 py-1.5 text-sm text-foreground outline-none"
          />
        ) : (
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => onProjectChange(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {projects.map((p) => (
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
          {/* Color */}
          <ProjectColorPicker project={selectedProject} />

          {/* Statuses */}
          <StatusList
            projectId={selectedProjectId}
            statuses={statuses}
            addToast={addToast}
          />

          {/* Delete — always last */}
          <ProjectDeleteSection
            project={selectedProject}
            onClose={onClose}
            addToast={addToast}
          />
        </div>
      )}
    </div>
  )
}

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'
]

function ProjectColorPicker({ project }: { project: Project }): React.JSX.Element {
  const [color, setColor] = useState(project.color)
  const updateProject = useProjectStore((s) => s.updateProject)

  useEffect(() => {
    setColor(project.color)
  }, [project.id, project.color])

  const handleColorChange = (c: string): void => {
    setColor(c)
    updateProject(project.id, { color: c })
  }

  return (
    <div>
      <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Color
      </label>
      <div className="flex gap-2 pl-1.5">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => handleColorChange(c)}
            className={`h-8 w-8 rounded-full transition-transform ${
              color === c
                ? 'scale-110 ring-2 ring-foreground/30 ring-offset-2 ring-offset-surface'
                : ''
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  )
}

interface ProjectDeleteSectionProps {
  project: Project
  onClose: () => void
  addToast: (toast: { message: string; variant?: 'default' | 'danger' }) => void
}

function ProjectDeleteSection({ project, onClose, addToast }: ProjectDeleteSectionProps): React.JSX.Element | null {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteProject = useProjectStore((s) => s.deleteProject)

  if (project.is_default === 1) return null

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
          onClick={() => setConfirmDelete(true)}
          className="rounded-lg border border-danger/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10"
        >
          Delete Project
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm font-light text-danger">Are you sure?</span>
          <button
            onClick={handleDelete}
            className="rounded-lg bg-danger px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white"
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
