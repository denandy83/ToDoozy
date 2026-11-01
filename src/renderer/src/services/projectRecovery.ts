import { requireProducerCurrent, type SyncProducer, type SyncContext } from './syncContext'
import type { Label } from '../../../shared/types'

const recoveries = new Map<string, Promise<void>>()
const recoveryKey = (projectId: string): string => JSON.stringify([window.api.sync.currentContext(), projectId])
export function isProjectRecoveryActive(projectId: string): boolean { return recoveries.has(recoveryKey(projectId)) }

async function snapshotOwnedLabel(userId: string, id: string, origin: SyncProducer | SyncContext): Promise<Label> {
  const label = await origin.api.labels.snapshotOwned(userId, id)
  const { useLabelStore } = await import('../shared/stores/labelStore')
  const { useTaskStore } = await import('../shared/stores/taskStore')
  if (!await origin.isCurrent()) throw new Error('Sync account or database changed')
  origin.assertCurrent()
  useLabelStore.setState(state => {
    const labels = { ...state.labels, [label.id]: label }
    delete labels[id]
    return { labels, projectLabels: Object.fromEntries(Object.entries(state.projectLabels).map(([projectId, ids]) => [projectId, new Set([...ids].map(value => value === id ? label.id : value))])) }
  })
  useTaskStore.setState(state => ({ taskLabels: Object.fromEntries(Object.entries(state.taskLabels).map(([taskId, labels]) => [taskId, labels.map(value => value.id === id ? label : value)])) }))
  return label
}

export async function hydrateProjectLabel(label: Label, userId: string, context: SyncContext): Promise<void> {
  const local = await context.api.labels.findById(label.id)
  if (local?.user_id === userId && label.user_id && label.user_id !== userId) await snapshotOwnedLabel(userId, local.id, context)
  await context.api.labels.applyRemote(label)
}

async function ownedSnapshot(label: Label, origin: SyncProducer): Promise<{ label: Label; previousId: string | null }> {
  const userId = origin.userId!
  const candidate = await origin.api.labels.findByName(userId, label.name)
  if (candidate) {
    let owned = false
    try {
      const client = await origin.client()
      if (client) {
        const { data, error } = await client.from('user_labels').select('id,user_id').eq('id', candidate.id).eq('user_id', userId)
        if (error) throw error
        owned = data?.some(row => row.id === candidate.id && row.user_id === userId) ?? false
      }
    } catch { await requireProducerCurrent(origin) }
    await requireProducerCurrent(origin)
    if (owned) return { label: candidate, previousId: candidate.id }
    const label = await snapshotOwnedLabel(userId, candidate.id, origin)
    return { label, previousId: candidate.id }
  }
  return { label: await origin.api.labels.create({ id: crypto.randomUUID(), user_id: userId, name: label.name, color: label.color }), previousId: null }
}

export async function recoverProject(projectId: string, keepCopy: boolean, origin: SyncProducer, before?: () => Promise<void>): Promise<boolean> {
  origin.assertCurrent()
  const key = recoveryKey(projectId)
  if (recoveries.has(key)) return false
  const run = async (): Promise<void> => {
    await requireProducerCurrent(origin)
    if (before) await before()
    await requireProducerCurrent(origin)
    const { api } = origin
    const project = await api.projects.findById(projectId)
    if (project && keepCopy) {
      const newId = crypto.randomUUID()
      await api.projects.create({ id: newId, name: `${project.name} (local copy)`, description: project.description, color: project.color, icon: project.icon, owner_id: origin.userId!, is_default: 0 })
      await api.projects.addMember(newId, origin.userId!, 'owner')
      const statuses = await api.statuses.findByProjectId(projectId)
      const statusMap = new Map<string, string>()
      for (const status of statuses) {
        const id = crypto.randomUUID()
        statusMap.set(status.id, id)
        await api.statuses.create({ id, project_id: newId, name: status.name, color: status.color, icon: status.icon, order_index: status.order_index, is_done: status.is_done, is_default: status.is_default })
      }
      const labelMap = new Map<string, string>()
      const copyLabel = async (id: string): Promise<string> => {
        const mapped = labelMap.get(id)
        if (mapped) return mapped
        const label = await api.labels.findById(id)
        if (!label) throw new Error('Label unavailable')
        const snapshot = await ownedSnapshot(label, origin)
        const owned = snapshot.label
        if (snapshot.previousId) labelMap.set(snapshot.previousId, owned.id)
        labelMap.set(id, owned.id)
        labelMap.set(owned.id, owned.id)
        await api.labels.addToProject(newId, owned.id)
        return owned.id
      }
      for (const label of await api.labels.findByProjectId(projectId)) await copyLabel(label.id)
      const tasks = (await api.tasks.findAllByProject(projectId)).filter(task => !task.is_archived && !task.is_template)
      const taskMap = new Map<string, string>()
      for (const task of tasks) {
        const id = crypto.randomUUID()
        taskMap.set(task.id, id)
        await api.tasks.create({ id, project_id: newId, owner_id: origin.userId!, title: task.title, description: task.description, status_id: statusMap.get(task.status_id) ?? task.status_id, priority: task.priority, due_date: task.due_date, parent_id: null, order_index: task.order_index, assigned_to: null, is_template: task.is_template, is_archived: task.is_archived, completed_date: task.completed_date, recurrence_rule: task.recurrence_rule, reference_url: task.reference_url })
        for (const link of await api.tasks.getLabels(task.id)) await api.tasks.addLabel(id, await copyLabel(link.label_id))
      }
      for (const task of tasks) if (task.parent_id && taskMap.has(task.parent_id)) await api.tasks.update(taskMap.get(task.id)!, { parent_id: taskMap.get(task.parent_id)! })
    }
    if (project) await api.projects.delete(projectId)
    const { useProjectStore } = await import('../shared/stores/projectStore')
    await useProjectStore.getState().hydrateProjects(origin.userId!, origin)
    await requireProducerCurrent(origin)
    if (before) useProjectStore.setState(state => ({ removal: state.removal?.id === projectId ? null : state.removal }))
  }
  const pending = run().catch(async error => {
    if (await origin.isCurrent()) {
      const project = await origin.api.projects.findById(projectId)
      const removed = !before || !(await origin.api.projects.getMembers(projectId)).some(member => member.user_id === origin.userId)
      if (project && removed) {
        const { useProjectStore } = await import('../shared/stores/projectStore')
        origin.assertCurrent()
        useProjectStore.setState(state => ({ removal: state.removal ?? { id: projectId, name: project.name, ownerId: origin.userId!, scope: window.api.sync.currentContext() } }))
      }
    }
    throw error
  }).finally(() => { if (recoveries.get(key) === pending) recoveries.delete(key) })
  recoveries.set(key, pending)
  await pending
  return true
}
