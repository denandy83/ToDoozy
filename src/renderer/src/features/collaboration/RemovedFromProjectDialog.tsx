import { useCallback, useEffect, useRef, useState } from 'react'
import { captureSyncProducer, requireProducerCurrent } from '../../services/syncContext'
import { hydrationContext } from '../../shared/stores/hydrationContext'
import { useDatabaseScope } from '../../shared/hooks/useDatabaseScope'
import { useAuthStore } from '../../shared/stores/authStore'
import { useDismissibleSurface } from '../../shared/motion/useDismissibleSurface'
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
  onClose: finishClose
}: RemovedFromProjectDialogProps): React.JSX.Element | null {
  const scope = useDatabaseScope()
  const initialScope = useRef(scope).current
  const active = useRef(true)
  const busy = useRef(false)
  const [working, setWorking] = useState(false)
  const removedRef = useRef(removedFromProject)
  removedRef.current = removedFromProject
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const closing = useRef<() => boolean>(() => false)
  const surface = useDismissibleSurface(() => { if (closing.current()) finishClose() })
  const onClose = useCallback(() => {
    const closingId = removedFromProject.id
    const ownerId = currentUser?.id
    closing.current = () => active.current && removedRef.current.id === closingId && window.api.sync.currentContext() === initialScope && useAuthStore.getState().currentUser?.id === ownerId
    surface.close()
  }, [surface.close, removedFromProject, currentUser?.id, initialScope])

  const { addToast } = useToast()

  if (scope !== initialScope || useAuthStore.getState().currentUser?.id !== currentUser?.id) return null
  return (
    <div {...surface.props} className="ui-surface ui-dialog ui-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="ui-modal-content w-80 rounded-lg border border-border bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-light text-foreground">
          You were removed from <span className="font-medium">{removedFromProject.name}</span>
        </h3>
        <p className="mt-2 text-[11px] text-muted">
          The owner unshared the project or removed you. Would you like to keep a local copy?
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={async () => {
              if (busy.current || scope !== initialScope || !currentUser || useAuthStore.getState().currentUser?.id !== currentUser.id) return
              busy.current = true
              setWorking(true)
              const origin = captureSyncProducer()
              const uiCurrent = (): boolean => active.current && removedRef.current.id === removedFromProject.id && window.api.sync.currentContext() === initialScope && useAuthStore.getState().currentUser?.id === currentUser.id
              const { api } = hydrationContext(origin)
              try {
                await requireProducerCurrent(origin)
                // Keep local copy with new UUID
                const oldId = removedFromProject.id
                const project = await api.projects.findById(oldId)
                if (project) {
                  const newId = crypto.randomUUID()
                  await api.projects.create({
                    id: newId,
                    name: `${project.name} (local copy)`,
                    description: project.description,
                    color: project.color,
                    icon: project.icon,
                    owner_id: currentUser.id,
                    is_default: 0
                  })
                  await api.projects.addMember(newId, currentUser.id, 'owner')
                  // Copy statuses
                  const statuses = await api.statuses.findByProjectId(oldId)
                  const statusMap: Record<string, string> = {}
                  for (const s of statuses) {
                    const nid = crypto.randomUUID()
                    statusMap[s.id] = nid
                    await api.statuses.create({ id: nid, project_id: newId, name: s.name, color: s.color, icon: s.icon, order_index: s.order_index, is_done: s.is_done, is_default: s.is_default })
                  }
                  // Copy labels to new project
                  const oldLabels = await api.labels.findByProjectId(oldId)
                  const labelMap = new Map<string, string>()
                  const copyLabel = async (id: string): Promise<string> => {
                    const mapped = labelMap.get(id)
                    if (mapped) return mapped
                    const label = await api.labels.findById(id)
                    if (!label) throw new Error('Label unavailable')
                    const owned = label.user_id === currentUser.id ? label : await api.labels.adopt(currentUser.id, label)
                    labelMap.set(id, owned.id)
                    await api.labels.addToProject(newId, owned.id)
                    return owned.id
                  }
                  for (const l of oldLabels) await copyLabel(l.id)
                  // Copy tasks
                  const tasks = (await api.tasks.findAllByProject(oldId)).filter((task) => !task.is_archived && !task.is_template)
                  const taskMap: Record<string, string> = {}
                  for (const t of tasks) {
                    const nid = crypto.randomUUID()
                    taskMap[t.id] = nid
                    await api.tasks.create({ id: nid, project_id: newId, owner_id: currentUser.id, title: t.title, description: t.description, status_id: statusMap[t.status_id] ?? t.status_id, priority: t.priority, due_date: t.due_date, parent_id: null, order_index: t.order_index, assigned_to: null, is_template: t.is_template, is_archived: t.is_archived, completed_date: t.completed_date, recurrence_rule: t.recurrence_rule, reference_url: t.reference_url })
                    // Copy task labels
                    const taskLabels = await api.tasks.getLabels(t.id)
                    for (const tl of taskLabels) {
                      await api.tasks.addLabel(nid, await copyLabel(tl.label_id))
                    }
                  }
                  for (const t of tasks) {
                    if (t.parent_id && taskMap[t.parent_id]) {
                      await api.tasks.update(taskMap[t.id], { parent_id: taskMap[t.parent_id] })
                    }
                  }
                  await api.projects.delete(oldId)
                }
                await useProjectStore.getState().hydrateProjects(currentUser.id, origin)
                await requireProducerCurrent(origin)
                if (!uiCurrent()) return
                onClose()
                addToast({ message: 'A local copy has been kept.' })
              } catch {
                if (await origin.isCurrent() && uiCurrent()) addToast({ message: 'Failed to keep project copy', variant: 'danger' })
              } finally {
                busy.current = false
                if (uiCurrent()) setWorking(false)
              }
            }}
            disabled={working}
            className="flex-1 rounded-md border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6"
          >
            Keep Copy
          </button>
          <button
            onClick={async () => {
              if (busy.current || scope !== initialScope || !currentUser || useAuthStore.getState().currentUser?.id !== currentUser.id) return
              busy.current = true
              setWorking(true)
              const origin = captureSyncProducer()
              const uiCurrent = (): boolean => active.current && removedRef.current.id === removedFromProject.id && window.api.sync.currentContext() === initialScope && useAuthStore.getState().currentUser?.id === currentUser.id
              const { api } = hydrationContext(origin)
              try {
                await requireProducerCurrent(origin)
                await api.projects.delete(removedFromProject.id)
                await useProjectStore.getState().hydrateProjects(currentUser.id, origin)
                await requireProducerCurrent(origin)
                if (!uiCurrent()) return
                onClose()
                addToast({ message: 'Project deleted.' })
              } catch {
                if (await origin.isCurrent() && uiCurrent()) addToast({ message: 'Failed to delete project', variant: 'danger' })
              } finally {
                busy.current = false
                if (uiCurrent()) setWorking(false)
              }
            }}
            disabled={working}
            className="flex-1 rounded-md bg-danger px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-danger/90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
