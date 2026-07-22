import { useProjectStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import type { User } from '../../../../shared/types'
import type { RemovedFromProject } from './useSharedProjectRealtime'

interface RemovedFromProjectDialogProps {
  removedFromProject: RemovedFromProject
  currentUser: User | null
  onClose: () => void
}

/**
 * Dialog shown when the current user is removed from (or unshared out of) a
 * shared project via Realtime. Offers to keep a full local copy of the project
 * or delete it. Extracted verbatim from AppLayout (Story #107).
 */
export function RemovedFromProjectDialog({
  removedFromProject,
  currentUser,
  onClose
}: RemovedFromProjectDialogProps): React.JSX.Element {
  const { addToast } = useToast()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg border border-border bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-light text-foreground">
          You were removed from <span className="font-medium">{removedFromProject.name}</span>
        </h3>
        <p className="mt-2 text-[11px] text-muted">
          The owner unshared the project or removed you. Would you like to keep a local copy?
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={async () => {
              if (!currentUser) return
              // Keep local copy with new UUID
              const oldId = removedFromProject.id
              const project = await window.api.projects.findById(oldId)
              if (project) {
                const newId = crypto.randomUUID()
                await window.api.projects.create({
                  id: newId,
                  name: `${project.name} (local copy)`,
                  description: project.description,
                  color: project.color,
                  icon: project.icon,
                  owner_id: currentUser.id,
                  is_default: 0
                })
                await window.api.projects.addMember(newId, currentUser.id, 'owner')
                // Copy statuses
                const statuses = await window.api.statuses.findByProjectId(oldId)
                const statusMap: Record<string, string> = {}
                for (const s of statuses) {
                  const nid = crypto.randomUUID()
                  statusMap[s.id] = nid
                  await window.api.statuses.create({ id: nid, project_id: newId, name: s.name, color: s.color, icon: s.icon, order_index: s.order_index, is_done: s.is_done, is_default: s.is_default })
                }
                // Copy labels to new project
                const oldLabels = await window.api.labels.findByProjectId(oldId)
                for (const l of oldLabels) {
                  await window.api.labels.addToProject(newId, l.id).catch(() => {})
                }
                // Copy tasks
                const tasks = await window.api.tasks.findByProjectId(oldId)
                const taskMap: Record<string, string> = {}
                for (const t of tasks) {
                  const nid = crypto.randomUUID()
                  taskMap[t.id] = nid
                  await window.api.tasks.create({ id: nid, project_id: newId, owner_id: currentUser.id, title: t.title, description: t.description, status_id: statusMap[t.status_id] ?? t.status_id, priority: t.priority, due_date: t.due_date, parent_id: null, order_index: t.order_index, assigned_to: null, is_template: t.is_template, is_archived: t.is_archived, completed_date: t.completed_date, recurrence_rule: t.recurrence_rule, reference_url: t.reference_url })
                  // Copy task labels
                  const taskLabels = await window.api.tasks.getLabels(t.id)
                  for (const tl of taskLabels) {
                    await window.api.tasks.addLabel(nid, tl.label_id).catch(() => {})
                  }
                }
                for (const t of tasks) {
                  if (t.parent_id && taskMap[t.parent_id]) {
                    await window.api.tasks.update(taskMap[t.id], { parent_id: taskMap[t.parent_id] })
                  }
                }
                await window.api.projects.delete(oldId)
              }
              await useProjectStore.getState().hydrateProjects(currentUser.id)
              onClose()
              addToast({ message: 'A local copy has been kept.' })
            }}
            className="flex-1 rounded-md border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6"
          >
            Keep Copy
          </button>
          <button
            onClick={async () => {
              if (!currentUser) return
              await window.api.projects.delete(removedFromProject.id)
              await useProjectStore.getState().hydrateProjects(currentUser.id)
              onClose()
              addToast({ message: 'Project deleted.' })
            }}
            className="flex-1 rounded-md bg-danger px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-danger/90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
