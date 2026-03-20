import { useState, useEffect, useRef } from 'react'
import type { Project } from '../../../../shared/types'
import { useProjectStore } from '../../shared/stores'

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'
]

interface ProjectGeneralSettingsProps {
  project: Project
  onClose: () => void
  addToast: (toast: { message: string; variant?: 'default' | 'danger' }) => void
}

export function ProjectGeneralSettings({
  project,
  onClose,
  addToast
}: ProjectGeneralSettingsProps): React.JSX.Element {
  const [name, setName] = useState(project.name)
  const [color, setColor] = useState(project.color)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const updateProject = useProjectStore((s) => s.updateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync state when project changes
  useEffect(() => {
    setName(project.name)
    setColor(project.color)
  }, [project.id, project.name, project.color])

  // Autosave name with 1s debounce
  useEffect(() => {
    if (name === project.name) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (name.trim()) {
        updateProject(project.id, { name: name.trim() })
      }
    }, 1000)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [name, project.id, project.name, updateProject])

  const handleColorChange = (c: string): void => {
    setColor(c)
    updateProject(project.id, { color: c })
  }

  const handleDelete = async (): Promise<void> => {
    if (project.is_default === 1) {
      addToast({ message: 'Cannot delete the default project', variant: 'danger' })
      return
    }
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
    <div className="flex flex-col gap-6">
      <div>
        <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Color
        </label>
        <div className="flex gap-2">
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

      {project.is_default !== 1 && (
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
      )}
    </div>
  )
}
