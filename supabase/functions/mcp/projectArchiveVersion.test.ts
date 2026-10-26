import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps archive actions independent from metadata updates and preserves owner RLS', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE projects(id integer PRIMARY KEY, owner_id text, name text, is_archived integer, updated_at timestamptz);
      INSERT INTO projects VALUES (1,'owner','Original',0,'2026-01-01T00:00:00Z');`)
    await db.exec(readFileSync(new URL('../../migrations/20261026102717_project_archive_version.sql', import.meta.url), 'utf8'))
    expect((await db.query('SELECT archive_updated_at FROM projects')).rows[0].archive_updated_at).toBeNull()
    await db.exec(`UPDATE projects SET is_archived=1, archive_updated_at='2026-01-01T10:00:00Z', updated_at='2026-01-01T10:00:00Z';
      UPDATE projects SET name='Renamed', is_archived=0, archive_updated_at=NULL, updated_at='2026-01-01T20:00:00Z';`)
    expect((await db.query('SELECT name,is_archived,archive_updated_at::text FROM projects')).rows[0]).toMatchObject({ name: 'Renamed', is_archived: 1 })
    await db.exec(`UPDATE projects SET is_archived=0, archive_updated_at='2026-01-01T15:00:00Z', updated_at='2026-01-01T15:00:00Z'`)
    let row = (await db.query('SELECT is_archived,archive_updated_at::text,updated_at::text FROM projects')).rows[0]
    expect(row.is_archived).toBe(0)
    expect(Date.parse(String(row.archive_updated_at))).toBe(Date.parse('2026-01-01T15:00:00Z'))
    expect(Date.parse(String(row.updated_at))).toBe(Date.parse('2026-01-01T20:00:00Z'))
    await db.exec(`UPDATE projects SET is_archived=1, archive_updated_at='2026-01-01T10:00:00Z';`)
    row = (await db.query('SELECT is_archived FROM projects')).rows[0]
    expect(row.is_archived).toBe(0)
    await db.exec(`ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_members ON projects FOR SELECT TO authenticated USING (true);
      CREATE POLICY update_owner ON projects FOR UPDATE TO authenticated
        USING (owner_id=current_setting('test.actor')) WITH CHECK (owner_id=current_setting('test.actor'));
      GRANT SELECT, UPDATE ON projects TO authenticated;
      SET ROLE authenticated; SET test.actor='member';`)
    const denied = await db.query("UPDATE projects SET is_archived=1,archive_updated_at='2026-01-02' RETURNING id")
    expect(denied.rows).toHaveLength(0)
    await db.exec("SET test.actor='owner'")
    const allowed = await db.query("UPDATE projects SET is_archived=1,archive_updated_at='2026-01-02' RETURNING is_archived")
    expect(allowed.rows[0].is_archived).toBe(1)
    await expect(db.query('SELECT preserve_project_archive_version()')).rejects.toThrow(/permission denied/)
  } finally { await db.close() }
}, 15000)
