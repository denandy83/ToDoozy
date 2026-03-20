import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus, Settings, Folder } from 'lucide-react'
import { useProjectStore, selectAllProjects, selectCurrentProject } from '../../shared/stores'

interface ProjectSwitcherProps {
  onNewProject: () => void
  onProjectSettings: (projectId: string) => void
}

export function ProjectSwitcher({
  onNewProject,
  onProjectSettings
}: ProjectSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const projects = useProjectStore(selectAllProjects)
  const currentProject = useProjectStore(selectCurrentProject)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-foreground/6 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ backgroundColor: currentProject?.color ?? '#888' }}
        >
          <Folder size={14} className="text-accent-fg" />
        </div>
        <span className="flex-1 truncate text-sm font-light text-foreground">
          {currentProject?.name ?? 'Select Project'}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-full min-w-[200px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100">
          <div className="max-h-64 overflow-y-auto py-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setCurrentProject(project.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/6 ${
                  project.id === currentProject?.id
                    ? 'bg-accent/12 border-l-2 border-accent/15'
                    : ''
                }`}
              >
                <div
                  className="flex h-5 w-5 items-center justify-center rounded"
                  style={{ backgroundColor: project.color }}
                >
                  <Folder size={12} className="text-accent-fg" />
                </div>
                <span className="flex-1 truncate text-sm font-light">{project.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onProjectSettings(project.id)
                    setOpen(false)
                  }}
                  className="rounded p-1 opacity-0 transition-opacity hover:bg-foreground/6 group-hover:opacity-100 [.group:hover>&]:opacity-100"
                  title="Project settings"
                >
                  <Settings size={12} className="text-muted" />
                </button>
              </button>
            ))}
          </div>

          <div className="border-t border-border py-1">
            <button
              onClick={() => {
                onNewProject()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/6"
            >
              <Plus size={14} className="text-muted" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted">
                New Project
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
