import { useState } from 'react'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useAuthStore } from '../../shared/stores/authStore'
import { useToast } from '../../shared/components/Toast'

export function ArchivedProjectsList(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const restore = useProjectStore((s) => s.unarchiveProject)
  const userId = useAuthStore((s) => s.currentUser?.id)
  const [restoring, setRestoring] = useState<string | null>(null)
  const { addToast } = useToast()
  const archived = Object.values(projects).filter((p) => p.is_archived === 1 && !p.deleted_at)
  return (
    <section className="mb-6 border-b border-border pb-4">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Archived projects</h3>
      {archived.length === 0 && <p className="text-xs text-muted">No archived projects.</p>}
      {archived.map((project) => (
        <div key={project.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span>{project.name}</span>
          {project.owner_id === userId ? (
            <button disabled={restoring !== null} className="rounded border border-border px-3 py-1 disabled:opacity-50"
              onClick={async () => {
                setRestoring(project.id)
                try {
                  await restore(project.id)
                  addToast({ message: `“${project.name}” restored` })
                } catch (error) {
                  addToast({ message: error instanceof Error ? error.message : 'Restore failed', variant: 'danger' })
                } finally { setRestoring(null) }
              }}>Restore</button>
          ) : <span className="text-xs text-muted">Only the owner can restore</span>}
        </div>
      ))}
    </section>
  )
}
