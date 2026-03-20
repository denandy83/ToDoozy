import { useState, useEffect, useCallback } from 'react'
import { Modal } from '../../shared/components/Modal'
import { useProjectStore, selectAllProjects, useStatusStore } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { StatusList } from './StatusList'
import { ProjectGeneralSettings } from './ProjectGeneralSettings'

type Tab = 'general' | 'statuses'

interface ProjectSettingsModalProps {
  open: boolean
  onClose: () => void
  projectId: string | null
}

export function ProjectSettingsModal({
  open,
  onClose,
  projectId
}: ProjectSettingsModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const projects = useProjectStore(selectAllProjects)
  const project = projects.find((p) => p.id === projectId) ?? null
  const statuses = useStatusesByProject(projectId ?? '')
  const hydrateStatuses = useStatusStore((s) => s.hydrateStatuses)
  const { addToast } = useToast()

  useEffect(() => {
    if (open && projectId) {
      hydrateStatuses(projectId)
    }
  }, [open, projectId, hydrateStatuses])

  const handleClose = useCallback((): void => {
    setActiveTab('general')
    onClose()
  }, [onClose])

  if (!project || !projectId) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'statuses', label: 'Statuses' }
  ]

  return (
    <Modal open={open} onClose={handleClose} title="Project Settings">
      <div className="flex gap-6">
        <nav className="flex flex-col gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent/12 text-accent'
                  : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-h-[300px] flex-1">
          {activeTab === 'general' && (
            <ProjectGeneralSettings
              project={project}
              onClose={handleClose}
              addToast={addToast}
            />
          )}
          {activeTab === 'statuses' && (
            <StatusList
              projectId={projectId}
              statuses={statuses}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
