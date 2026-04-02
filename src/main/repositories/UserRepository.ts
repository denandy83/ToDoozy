import type { DatabaseSync } from 'node:sqlite'
import type { User, CreateUserInput, UpdateUserInput } from '../../shared/types'

export class UserRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User | undefined
  }

  findByEmail(email: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as User | undefined
  }

  create(input: CreateUserInput): User {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.email, input.display_name ?? null, input.avatar_url ?? null, now, now)
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateUserInput): User | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (input.email !== undefined) {
      sets.push('email = ?')
      values.push(input.email)
    }
    if (input.display_name !== undefined) {
      sets.push('display_name = ?')
      values.push(input.display_name)
    }
    if (input.avatar_url !== undefined) {
      sets.push('avatar_url = ?')
      values.push(input.avatar_url)
    }

    values.push(id)
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return result.changes > 0
  }

  list(): User[] {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as unknown as User[]
  }
}
