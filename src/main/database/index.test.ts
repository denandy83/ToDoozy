import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDatabase, initDatabase } from './index'
import { LabelRepository } from '../repositories/LabelRepository'
import { TaskRepository } from '../repositories/TaskRepository'
import { getLastLocalWriteAt, resetLocalWriteTracker } from './writeTracker'

vi.mock('electron', () => ({
  app: { getPath: () => { throw new Error('Tests must not access user data') } }
}))

describe('native database write-tracking wrapper', () => {
  let labels: LabelRepository
  let tasks: TaskRepository

  beforeEach(() => {
    vi.stubEnv('TODOOZY_DEV_DB', ':memory:')
    initDatabase()
    const db = getDatabase()
    const now = '2026-10-26T00:00:00.000Z'
    db.prepare('INSERT INTO users (id,email,created_at,updated_at) VALUES (?,?,?,?)')
      .run('owner', 'synthetic@example.invalid', now, now)
    db.prepare('INSERT INTO projects (id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('project', 'owner', 'Synthetic project', now, now)
    db.prepare('INSERT INTO statuses (id,project_id,name,order_index,is_done,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('status', 'project', 'Todo', 0, 0, 1, now, now)
    labels = new LabelRepository(db)
    tasks = new TaskRepository(db)
    labels.create({ id: 'label', user_id: 'owner', name: 'Synthetic label' })
    tasks.create({ id: 'task', project_id: 'project', owner_id: 'owner', title: 'Synthetic task', status_id: 'status' })
    resetLocalWriteTracker()
  })

  afterEach(() => {
    closeDatabase()
    resetLocalWriteTracker()
    vi.unstubAllEnvs()
  })

  it('forwards native transaction accessors and preserves write attribution', () => {
    const db = getDatabase()
    expect(db.isTransaction).toBe(false)
    db.exec('BEGIN')
    expect(db.isTransaction).toBe(true)
    expect(db.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    expect(getLastLocalWriteAt()).toBe(0)
    db.exec('COMMIT')
    expect(db.isTransaction).toBe(false)
    expect(getLastLocalWriteAt()).toBeGreaterThan(0)
    resetLocalWriteTracker()
    db.prepare('UPDATE tasks SET title=? WHERE id=?').run('Edited', 'task')
    expect(tasks.findById('task')?.title).toBe('Edited')
    expect(getLastLocalWriteAt()).toBeGreaterThan(0)
  })

  it('creates and attaches a project label through the wrapper', () => {
    labels.create({ id: 'new-label', user_id: 'owner', name: 'New label', project_id: 'project' })
    expect(labels.findByProjectId('project').map((label) => label.id)).toEqual(['new-label'])
    expect(getDatabase().isTransaction).toBe(false)
  })

  it('adds a task label and its project association through the wrapper', () => {
    tasks.addLabel('task', 'label')
    expect(labels.findByTaskId('task').map((label) => label.id)).toEqual(['label'])
    expect(tasks.getLabelState('task')).toEqual([
      expect.objectContaining({ label_id: 'label', deleted_at: null, sync_pending: 1 })
    ])
  })

  it('removes a task label through the wrapper', () => {
    tasks.addLabel('task', 'label')
    expect(tasks.removeLabel('task', 'label')).toBe(true)
    expect(labels.findByTaskId('task')).toEqual([])
    expect(tasks.getLabelState('task')[0]).toEqual(expect.objectContaining({
      deleted_at: expect.any(String), sync_pending: 1
    }))
  })

  it('imports a remote assignment and its project association through the wrapper', () => {
    expect(tasks.applyRemoteTaskLabels('task', ['label'])).toBe(1)
    expect(labels.findByTaskId('task').map((label) => label.id)).toEqual(['label'])
    expect(tasks.getLabelState('task')).toEqual([
      expect.objectContaining({ label_id: 'label', deleted_at: null, sync_pending: 0 })
    ])
  })
})
