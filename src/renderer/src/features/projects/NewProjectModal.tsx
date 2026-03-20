import { useState } from 'react'
import { Modal } from '../../shared/components/Modal'
import { useProjectStore } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores/authStore'
import { useStatusStore } from '../../shared/stores/statusStore'

interface NewProjectModalProps {
  open: boolean
  onClose: () => void
}

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'
]

export function NewProjectModal({ open, onClose }: NewProjectModalProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createProject = useProjectStore((s) => s.createProject)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const allProjects = useProjectStore((s) => s.projects)
  const createStatus = useStatusStore((s) => s.createStatus)
  const currentUser = useAuthStore((s) => s.currentUser)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || !currentUser) return

    setLoading(true)
    setError(null)
    try {
      const id = crypto.randomUUID()
      const projectList = Object.values(allProjects)
      const maxOrder = projectList.length > 0
        ? Math.max(...projectList.map((p) => p.sidebar_order ?? 0), projectList.length - 1)
        : 0
      const project = await createProject({
        id,
        name: name.trim(),
        owner_id: currentUser.id,
        color,
        icon: 'folder',
        is_default: 0,
        sidebar_order: maxOrder + 1
      })
      await window.api.projects.addMember(id, currentUser.id, 'owner', currentUser.id)

      // Seed default statuses
      const statusDefaults = [
        { name: 'Not Started', color: '#888888', icon: 'circle', order_index: 0, is_default: 1, is_done: 0 },
        { name: 'In Progress', color: '#f59e0b', icon: 'clock', order_index: 1, is_default: 0, is_done: 0 },
        { name: 'Done', color: '#22c55e', icon: 'check-circle', order_index: 2, is_default: 0, is_done: 1 }
      ]
      for (const status of statusDefaults) {
        await createStatus({
          id: crypto.randomUUID(),
          project_id: id,
          ...status
        })
      }

      setCurrentProject(project.id)
      setName('')
      setColor(PROJECT_COLORS[0])
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = (): void => {
    setName('')
    setColor(PROJECT_COLORS[0])
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Project">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div>
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
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
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-foreground/30 ring-offset-2 ring-offset-surface' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:bg-foreground/6"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
