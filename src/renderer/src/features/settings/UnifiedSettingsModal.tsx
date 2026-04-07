import { useState, useEffect, useCallback, useRef } from 'react'
import { LogOut } from 'lucide-react'
import { Modal } from '../../shared/components/Modal'
import { useProjectStore, selectAllProjects, useStatusStore, useStatusesByProject, useAuthStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { GeneralSettingsContent } from './GeneralSettingsContent'
import { ProjectsSettingsContent } from './ProjectsSettingsContent'
import { AppearanceSettingsContent, type AppearanceSettingsHandle } from './AppearanceSettingsContent'
import { LabelSettingsContent } from './LabelSettingsContent'
import { TimerSettingsContent } from './TimerSettingsContent'
import { IntegrationsSettingsContent } from './IntegrationsSettingsContent'
import { AboutSettingsContent } from './AboutSettingsContent'
import { WhatsNewDot } from './WhatsNewSettingsContent'

type Tab = 'general' | 'projects' | 'appearance' | 'labels' | 'timer' | 'integrations' | 'about'

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
  const appearanceRef = useRef<AppearanceSettingsHandle>(null)
  const [pendingUnsaved, setPendingUnsaved] = useState(false)
  const [themeBlocked, setThemeBlocked] = useState(false)
  const [shake, setShake] = useState(false)
  const [themeDirty, setThemeDirty] = useState(false)

  useEffect(() => { if (open && projectId) setSelectedProjectId(projectId) }, [open, projectId])
  useEffect(() => { if (open && selectedProjectId) hydrateStatuses(selectedProjectId) }, [open, selectedProjectId, hydrateStatuses])
  useEffect(() => { if (open && initialTab) setActiveTab(initialTab as Tab) }, [open, initialTab])

  const triggerShake = useCallback(() => { setShake(true); setTimeout(() => setShake(false), 300) }, [])

  const showUnsavedThemeToast = useCallback((onDone: () => void): void => {
    if (pendingUnsaved) { triggerShake(); return }
    setPendingUnsaved(true)
    triggerShake()
    addToast({
      message: 'Unsaved theme changes',
      persistent: true,
      actions: [
        { label: 'Apply', variant: 'accent', onClick: async () => { await appearanceRef.current?.themeRef.current?.apply(); setPendingUnsaved(false); onDone() } },
        { label: 'Discard', variant: 'danger', onClick: () => { appearanceRef.current?.themeRef.current?.revert(); setPendingUnsaved(false); onDone() } },
        { label: 'Cancel', variant: 'muted', onClick: () => { setPendingUnsaved(false) } }
      ]
    })
  }, [addToast, pendingUnsaved, triggerShake])

  const handleTabChange = useCallback((tab: Tab): void => {
    if (activeTab === 'appearance' && tab !== 'appearance') {
      if (themeDirty) { showUnsavedThemeToast(() => setActiveTab(tab)); return }
      appearanceRef.current?.themeRef.current?.revert()
    }
    setActiveTab(tab)
  }, [activeTab, themeDirty, showUnsavedThemeToast])

  const handleClose = useCallback((): void => {
    if (activeTab === 'appearance' && themeDirty) {
      showUnsavedThemeToast(() => { setActiveTab('general'); onClose() })
      return
    }
    if (activeTab === 'appearance') appearanceRef.current?.themeRef.current?.revert()
    setActiveTab('general')
    onClose()
  }, [onClose, activeTab, themeDirty, showUnsavedThemeToast])

  const handleLogout = useCallback(async () => { await logout(); handleClose() }, [logout, handleClose])
  const handleProjectChange = useCallback((id: string) => setSelectedProjectId(id), [])

  if (!open) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' }, { key: 'projects', label: 'Projects' },
    { key: 'appearance', label: 'Appearance' }, { key: 'labels', label: 'Labels' },
    { key: 'timer', label: 'Timer' }, { key: 'integrations', label: 'Integrations' }, { key: 'about', label: 'About' }
  ]

  return (
    <Modal open={open} onClose={handleClose} title="Settings" size="large" className={shake ? 'modal-shake' : ''}>
      {(pendingUnsaved || themeBlocked) && (
        <div className="absolute inset-0 z-10 cursor-not-allowed" onClick={(e) => { e.stopPropagation(); triggerShake() }} />
      )}
      <div className={`flex gap-6 h-[600px] ${(pendingUnsaved || themeBlocked) ? 'pointer-events-none opacity-60' : ''}`}>
        <nav className="flex flex-col gap-1 min-w-[120px] flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`relative rounded-lg px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest transition-colors ${
                activeTab === tab.key ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {tab.label}
              {tab.key === 'about' && <WhatsNewDot />}
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
        <div className="flex-1 overflow-y-auto pr-3">
          {activeTab === 'general' && <GeneralSettingsContent />}
          {activeTab === 'projects' && (
            <ProjectsSettingsContent
              projects={projects}
              selectedProject={selectedProject}
              selectedProjectId={selectedProjectId}
              statuses={statuses}
              onProjectChange={handleProjectChange}
              onClose={handleClose}
            />
          )}
          {activeTab === 'appearance' && (
            <AppearanceSettingsContent
              ref={appearanceRef}
              onDirtyChange={setThemeDirty}
              onBlockingChange={setThemeBlocked}
              onThemeSubtabLeave={showUnsavedThemeToast}
            />
          )}
          {activeTab === 'labels' && <LabelSettingsContent />}
          {activeTab === 'timer' && <TimerSettingsContent />}
          {activeTab === 'integrations' && <IntegrationsSettingsContent />}
          {activeTab === 'about' && <AboutSettingsContent />}
        </div>
      </div>
    </Modal>
  )
}
