import type { DatabaseSync } from 'node:sqlite'
import type { ActivityLogEntry, CreateActivityLogInput } from '../../shared/types'

export class ActivityLogRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): ActivityLogEntry | undefined {
    return this.db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id) as
      | ActivityLogEntry
      | undefined
  }

  findByTaskId(taskId: string): ActivityLogEntry[] {
    return this.db
      .prepare('SELECT * FROM activity_log WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as unknown as ActivityLogEntry[]
  }

  findByUserId(userId: string): ActivityLogEntry[] {
    return this.db
      .prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as ActivityLogEntry[]
  }

  create(input: CreateActivityLogInput): ActivityLogEntry {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO activity_log (id, task_id, user_id, action, old_value, new_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.task_id,
        input.user_id,
        input.action,
        input.old_value ?? null,
        input.new_value ?? null,
        now
      )
    return this.findById(input.id)!
  }

  deleteByTaskId(taskId: string): number {
    const result = this.db.prepare('DELETE FROM activity_log WHERE task_id = ?').run(taskId)
    return Number(result.changes)
  }

  getRecent(userId: string, limit: number): ActivityLogEntry[] {
    return this.db
      .prepare(
        `SELECT al.* FROM activity_log al
         INNER JOIN tasks t ON t.id = al.task_id
         INNER JOIN project_members pm ON pm.project_id = t.project_id
         WHERE pm.user_id = ?
         ORDER BY al.created_at DESC LIMIT ?`
      )
      .all(userId, limit) as unknown as ActivityLogEntry[]
  }

  getFocusStats(
    userId: string,
    projectId: string | null,
    startDate: string,
    endDate: string
  ): Array<{ date: string; minutes: number }> {
    let sql = `
      SELECT date(al.created_at) as date, al.action
      FROM activity_log al
      INNER JOIN tasks t ON t.id = al.task_id
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE al.action LIKE 'Completed % min focus session'
        AND al.created_at >= ? AND al.created_at <= ?
    `
    const params: (string | number)[] = [userId, startDate, endDate]
    if (projectId) {
      sql += ' AND t.project_id = ?'
      params.push(projectId)
    }
    sql += ' ORDER BY al.created_at ASC'

    const rows = this.db.prepare(sql).all(...params) as unknown as Array<{ date: string; action: string }>
    // Aggregate minutes by date
    const byDate: Record<string, number> = {}
    for (const row of rows) {
      const match = row.action.match(/^Completed (\d+) min focus session$/)
      if (match) {
        byDate[row.date] = (byDate[row.date] ?? 0) + Number(match[1])
      }
    }
    return Object.entries(byDate).map(([date, minutes]) => ({ date, minutes }))
  }

  getFocusTaskList(
    userId: string,
    startDate: string,
    endDate: string,
    projectIds: string[] | null
  ): Array<{ id: string; projectId: string; title: string; projectName: string; completedDate: string | null; dueDate: string | null; priority: number; focusMinutes: number }> {
    let sql = `
      SELECT t.id, t.project_id as projectId, t.title, p.name as projectName,
             t.completed_date as completedDate, t.due_date as dueDate, t.priority,
             SUM(CAST(SUBSTR(al.action, 11, INSTR(SUBSTR(al.action, 11), ' ') - 1) AS INTEGER)) as focusMinutes
      FROM activity_log al
      INNER JOIN tasks t ON t.id = al.task_id
      INNER JOIN projects p ON p.id = t.project_id
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE al.action LIKE 'Completed % min focus session'
        AND al.created_at >= ? AND al.created_at <= ?
    `
    const params: string[] = [userId, startDate, endDate]
    if (projectIds && projectIds.length > 0) {
      sql += ` AND t.project_id IN (${projectIds.map(() => '?').join(',')})`
      params.push(...projectIds)
    }
    sql += ' GROUP BY t.id ORDER BY focusMinutes DESC LIMIT 200'
    return this.db.prepare(sql).all(...params) as unknown as Array<{ id: string; projectId: string; title: string; projectName: string; completedDate: string | null; dueDate: string | null; priority: number; focusMinutes: number }>
  }

  getCookieStats(
    userId: string,
    startDate: string,
    endDate: string
  ): { earned: number; spent: number } {
    const sql = `
      SELECT al.action
      FROM activity_log al
      INNER JOIN tasks t ON t.id = al.task_id
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE al.action LIKE 'Cookie break: earned%'
        AND al.created_at >= ? AND al.created_at <= ?
    `
    const rows = this.db.prepare(sql).all(userId, startDate, endDate) as unknown as Array<{ action: string }>
    let earned = 0
    let spent = 0
    for (const row of rows) {
      const match = row.action.match(/^Cookie break: earned (\d+)m, spent (\d+)m$/)
      if (match) {
        earned += Number(match[1])
        spent += Number(match[2])
      }
    }
    return { earned, spent }
  }

  getActivityHeatmap(
    userId: string,
    startDate: string,
    endDate: string
  ): Array<{ date: string; count: number; created: number; completed: number; updated: number }> {
    return this.db
      .prepare(
        `SELECT date(al.created_at) as date,
                COUNT(*) as count,
                SUM(CASE WHEN al.action = 'created' THEN 1 ELSE 0 END) as created,
                SUM(CASE WHEN al.action = 'status_changed' AND al.new_value IN (
                  SELECT s.name FROM statuses s WHERE s.is_done = 1
                ) THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN al.action != 'created' AND NOT (al.action = 'status_changed' AND al.new_value IN (
                  SELECT s.name FROM statuses s WHERE s.is_done = 1
                )) THEN 1 ELSE 0 END) as updated
         FROM activity_log al
         INNER JOIN tasks t ON t.id = al.task_id
         INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
         WHERE al.created_at >= ? AND al.created_at <= ?
         GROUP BY date(al.created_at)
         ORDER BY date ASC`
      )
      .all(userId, startDate, endDate) as unknown as Array<{ date: string; count: number; created: number; completed: number; updated: number }>
  }
}
