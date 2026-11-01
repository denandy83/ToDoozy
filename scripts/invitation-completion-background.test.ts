import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Harness[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })

it('continues best-effort shared downloads after an individual task apply failure', async () => {
  const h = await makeHarness({ projectCount: 1, shared: 1, connected: false }); opened.push(h)
  const timestamp = '2030-01-01T00:00:00.000Z'
  for (const id of ['failed-task', 'valid-task']) h.remote.tasks.push({ id, project_id: 'p0', status_id: 's0', owner_id: 'u', title: id, created_at: timestamp, updated_at: timestamp })
  const apply = h.repo.tasks.applyRemoteTask.bind(h.repo.tasks)
  h.repo.tasks.applyRemoteTask = (row: { id: string }) => {
    if (row.id === 'failed-task') throw Error('Synthetic task failure')
    return apply(row)
  }
  await expect(h.services.shared.syncProjectDown('p0', 'u', await h.context())).resolves.toBeUndefined()
  expect(h.repo.tasks.findById('failed-task')).toBeUndefined()
  expect(h.repo.tasks.findById('valid-task')?.title).toBe('valid-task')
  expect(h.fixtureErrors).toEqual([])
})

it('keeps background task-label failures isolated to their project', async () => {
  const h = await makeHarness({ projectCount: 2, connected: false }); opened.push(h)
  for (let index = 0; index < 2; index++) {
    h.repo.tasks.create({ id: 'task-' + index, project_id: 'p' + index, status_id: 's' + index, owner_id: 'u', title: 'TASK' })
    const label = h.repo.labels.create({ id: 'label-' + index, user_id: 'u', name: 'LABEL ' + index })
    h.remote.user_labels.push({ ...label })
    h.remote.task_labels.push({ task_id: 'task-' + index, label_id: label.id, deleted_at: null })
  }
  const apply = h.repo.tasks.applyRemoteTaskLabels.bind(h.repo.tasks)
  h.repo.tasks.applyRemoteTaskLabels = (id: string, ...args: unknown[]) => {
    if (id === 'task-0') throw Error('Synthetic task-label failure')
    return apply(id, ...args)
  }
  await expect(h.services.personal.pullTaskLabelsForTasks(['task-0', 'task-1'], 'u', await h.context())).resolves.toBe(1)
  expect(h.repo.tasks.getLabels('task-0')).toEqual([])
  expect(h.repo.tasks.getLabels('task-1').map((link: { label_id: string }) => link.label_id)).toEqual(['label-1'])
  expect(h.fixtureErrors).toEqual([])
})

it.each([false, true])('isolates owned label-definition failure within one project (strict=%s)', async strict => {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 1, connected: false }); opened.push(h)
  const timestamp = '2030-01-01T00:00:00.000Z'
  for (let index = 0; index < 2; index++) {
    h.repo.tasks.create({ id: 'task-' + index, project_id: 'p0', status_id: 's0', owner_id: 'u', title: 'TASK' })
    h.remote.user_labels.push({ id: 'remote-label-' + index, user_id: 'u', name: 'REMOTE LABEL ' + index, color: '#123456', order_index: index, created_at: timestamp, updated_at: timestamp, deleted_at: null })
    h.remote.task_labels.push({ task_id: 'task-' + index, label_id: 'remote-label-' + index, deleted_at: null })
  }
  const apply = h.repo.labels.applyRemote.bind(h.repo.labels), attempted: string[] = []
  h.repo.labels.applyRemote = (row: { id: string }) => {
    attempted.push(row.id)
    if (row.id === 'remote-label-0') throw Error('Synthetic definition failure')
    return apply(row)
  }
  const pull = h.services.personal.pullTaskLabelsForTasks(['task-0', 'task-1'], 'u', await h.context(), 'p0', strict)
  if (strict) {
    await expect(pull).rejects.toThrow('Synthetic definition failure')
    expect(attempted).toEqual(['remote-label-0'])
    expect(h.repo.tasks.getLabels('task-1')).toEqual([])
  } else {
    await expect(pull).resolves.toBe(1)
    expect(attempted).toEqual(['remote-label-0', 'remote-label-1'])
    expect(h.repo.labels.findById('remote-label-0')).toBeUndefined()
    expect(h.repo.tasks.getLabels('task-0')).toEqual([])
    expect(h.repo.tasks.getLabels('task-1').map((link: { label_id: string }) => link.label_id)).toEqual(['remote-label-1'])
  }
  expect(h.fixtureErrors).toEqual([])
})
