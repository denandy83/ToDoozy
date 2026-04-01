import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database/transaction'
import type {
  Project,
  ProjectMember,
  CreateProjectInput,
  UpdateProjectInput
} from '../../shared/types'

export class ProjectRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project | undefined
  }

  findByOwnerId(ownerId: string): Project[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at ASC')
      .all(ownerId) as unknown as Project[]
  }

  findDefault(ownerId: string): Project | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE owner_id = ? AND is_default = 1')
      .get(ownerId) as unknown as Project | undefined
  }

  create(input: CreateProjectInput): Project {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, color, icon, owner_id, is_default, sidebar_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.name,
        input.description ?? null,
        input.color ?? '#888888',
        input.icon ?? 'folder',
        input.owner_id,
        input.is_default ?? 0,
        input.sidebar_order ?? 0,
        now,
        now
      )
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateProjectInput): Project | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (input.name !== undefined) {
      sets.push('name = ?')
      values.push(input.name)
    }
    if (input.description !== undefined) {
      sets.push('description = ?')
      values.push(input.description)
    }
    if (input.color !== undefined) {
      sets.push('color = ?')
      values.push(input.color)
    }
    if (input.icon !== undefined) {
      sets.push('icon = ?')
      values.push(input.icon)
    }
    if (input.sidebar_order !== undefined) {
      sets.push('sidebar_order = ?')
      values.push(String(input.sidebar_order))
    }
    if (input.is_default !== undefined) {
      sets.push('is_default = ?')
      values.push(String(input.is_default))
    }
    if (input.is_shared !== undefined) {
      sets.push('is_shared = ?')
      values.push(String(input.is_shared))
    }

    values.push(id)
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  }

  delete(id: string): boolean {
    return withTransaction(this.db, () => {
      // tasks.status_id references statuses(id) with no CASCADE.
      // Deleting the project cascades to statuses, which would fail if any task
      // (including tasks from other projects) still references those statuses.
      // Delete all such tasks first.
      this.db.prepare('DELETE FROM tasks WHERE status_id IN (SELECT id FROM statuses WHERE project_id = ?)').run(id)
      this.db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      return result.changes > 0
    })
  }

  list(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as unknown as Project[]
  }

  // Project members
  addMember(projectId: string, userId: string, role: string, invitedBy?: string): void {
    this.db
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(projectId, userId, role, invitedBy ?? null, new Date().toISOString())
  }

  updateMember(projectId: string, userId: string, updates: { display_color?: string | null; display_initials?: string | null }): void {
    const sets: string[] = []
    const values: (string | null)[] = []
    if (updates.display_color !== undefined) { sets.push('display_color = ?'); values.push(updates.display_color) }
    if (updates.display_initials !== undefined) { sets.push('display_initials = ?'); values.push(updates.display_initials) }
    if (sets.length === 0) return
    this.db.prepare(`UPDATE project_members SET ${sets.join(', ')} WHERE project_id = ? AND user_id = ?`).run(...values, projectId, userId)
  }

  removeMember(projectId: string, userId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
      .run(projectId, userId)
    return result.changes > 0
  }

  getMembers(projectId: string): ProjectMember[] {
    return this.db
      .prepare('SELECT * FROM project_members WHERE project_id = ? ORDER BY joined_at ASC')
      .all(projectId) as unknown as ProjectMember[]
  }

  getProjectsForUser(userId: string): Project[] {
    return this.db
      .prepare(
        `SELECT p.* FROM projects p
         INNER JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = ?
         ORDER BY p.sidebar_order ASC, p.created_at ASC`
      )
      .all(userId) as unknown as Project[]
  }

  updateSidebarOrder(updates: Array<{ id: string; sidebar_order: number }>): void {
    const stmt = this.db.prepare('UPDATE projects SET sidebar_order = ?, updated_at = ? WHERE id = ?')
    const now = new Date().toISOString()
    withTransaction(this.db, () => {
      for (const u of updates) {
        stmt.run(u.sidebar_order, now, u.id)
      }
    })
  }
}
