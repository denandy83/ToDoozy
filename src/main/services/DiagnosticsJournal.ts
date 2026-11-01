import { DatabaseSync } from 'node:sqlite'
import { validateTrafficSummary, type TrafficSummary } from '../../shared/supabaseTelemetry'

/** Local aggregate history only. No cloud writes, request bodies or URL values. */
export class DiagnosticsJournal {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS traffic(id INTEGER PRIMARY KEY, recorded_at TEXT NOT NULL, summary TEXT NOT NULL)')
  }
  append(value: unknown, appVersion: string): void {
    const summary = { ...validateTrafficSummary(value), appVersion }
    this.db.prepare('INSERT INTO traffic(recorded_at,summary) VALUES(?,?)').run(new Date().toISOString(),JSON.stringify(summary))
    this.db.prepare('DELETE FROM traffic WHERE recorded_at < ?').run(new Date(Date.now()-7*86400_000).toISOString())
    this.db.exec('DELETE FROM traffic WHERE id NOT IN (SELECT id FROM traffic ORDER BY id DESC LIMIT 10080)')
  }
  recent(): TrafficSummary[] {
    return (this.db.prepare('SELECT summary FROM traffic WHERE recorded_at >= ? ORDER BY id DESC LIMIT 100').all(new Date(Date.now()-7*86400_000).toISOString()) as Array<{summary:string}>)
      .reverse().map(({summary})=>JSON.parse(summary) as TrafficSummary)
  }
}
