import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrations } from '../database/migrations'
import { createRepositories } from './index'

it('does not rewrite already-matching tasks when equal archive metadata is pulled again', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
    for (const migrate of migrations) migrate(db)
    const repos = createRepositories(db)
    repos.users.create({ id: 'u', email: 'u@example.invalid', display_name: null, avatar_url: null })
    repos.projects.create({ id: 'p', owner_id: 'u', name: 'Project' })
    repos.statuses.create({ id: 'open', project_id: 'p', name: 'Open', is_default: 1 })
    repos.tasks.create({ id: 't', project_id: 'p', owner_id: 'u', status_id: 'open', title: 'Task' })
    const project = repos.projects.findById('p')!
    const remote = { ...project, is_archived: 1, archive_updated_at: '2099-01-01T00:00:00.000Z' }
    repos.projects.applyRemote(remote)
    expect(repos.tasks.findById('t')!.is_archived).toBe(1)
    const changes = (): number => (db.prepare('SELECT total_changes() AS count').get() as { count: number }).count
    const before = changes()
    repos.projects.applyRemote(remote)
    expect(changes() - before).toBe(0)
  } finally { db.close() }
})
