import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { configureLegacyArchive, pushProjectArchive as legacyArchive } from '../../../src/renderer/src/services/testFixtures/legacyProjectArchive'
import { writeProjectArchive } from '../../../src/renderer/src/services/projectArchiveSync'

it('supports the exact v1.9 action, fences metadata and equal-version conflicts, and preserves RLS', async () => {
  const db = new PGlite()
  const requests: string[] = []
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE projects(id text PRIMARY KEY, owner_id text, name text, is_archived integer, updated_at timestamptz);
      CREATE TABLE tasks(id text PRIMARY KEY,project_id text,is_archived integer,updated_at timestamptz,deleted_at timestamptz);
      INSERT INTO projects VALUES ('p','owner','Original',0,'2026-01-01T00:00:00Z');
      INSERT INTO tasks VALUES ('t','p',0,'2026-01-01T00:00:00Z',NULL);`)
    await db.exec(readFileSync(new URL('../../migrations/20261026102717_project_archive_version.sql', import.meta.url), 'utf8'))
    const client = { from(table: string) {
      let patch: Record<string, unknown> | null = null, columns = '*'
      const filters: Array<[string, unknown, string]> = []
      const chain = {
        update(value: Record<string, unknown>) { patch = value; return chain }, select(value = '*') { columns = value; return chain },
        eq(key: string, value: unknown) { filters.push([key, value, '=']); return chain },
        is(key: string, value: unknown) { filters.push([key, value, 'IS']); return chain },
        lte(key: string, value: unknown) { filters.push([key, value, '<=']); return chain },
        in(key: string, value: unknown) { filters.push([key, value, '=ANY']); return chain },
        order() { return chain }, limit() { return chain },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return (async () => {
            const params: unknown[] = []
            const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
            const quote = (key: string) => { if (!/^[a-z_]+$/.test(key)) throw new Error('Invalid fixture column'); return `"${key}"` }
            const sets = patch ? Object.entries(patch).map(([key, value]) => `${quote(key)}=${bind(value)}`).join(',') : ''
            const where = filters.map(([key, value, operator]) => operator === 'IS' ? `${quote(key)} IS NULL` : operator === '=ANY' ? `${quote(key)}=ANY(${bind(value)})` : `${quote(key)}${operator}${bind(value)}`).join(' AND ')
            const query = patch ? `UPDATE ${quote(table)} SET ${sets} WHERE ${where} RETURNING *` : `SELECT ${columns} FROM ${quote(table)} WHERE ${where}`
            requests.push(table)
            try { return { data: (await db.query(query, params)).rows, error: null } } catch (error) { return { data: null, error: { message: String(error) } } }
          })().then(resolve, reject)
        }
      }
      return chain
    } } as unknown as SupabaseClient
    configureLegacyArchive(client)
    const t10 = '2026-01-01T10:00:00.000Z', t20 = '2026-01-01T20:00:00.000Z', t30 = '2026-01-02T06:00:00.000Z'
    for (const state of [0, 1]) {
      await db.exec("TRUNCATE tasks,projects; INSERT INTO projects VALUES ('p','owner','Original',0,'2026-01-01T00:00:00Z',NULL); INSERT INTO tasks VALUES ('t','p',0,'2026-01-01T00:00:00Z',NULL)")
      await writeProjectArchive(client, 'p', state, [], t10)
      for (const table of ['projects', 'tasks']) {
        const row = (await db.query(`SELECT updated_at::text AS stamp FROM ${table}`)).rows[0]
        expect(Date.parse(String(row.stamp))).toBe(Date.parse('2026-01-01T00:00:00Z'))
      }
      const count = requests.length
      const applied = await writeProjectArchive(client, 'p', state ? 0 : 1, [], t10)
      expect(applied.is_archived).toBe(state)
      expect(requests.slice(count)).toEqual(['projects'])
      expect((await db.query('SELECT is_archived FROM tasks')).rows[0].is_archived).toBe(state)
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t20)
      await legacyArchive('p', state ? 0 : 1)
      vi.useRealTimers()
      expect((await db.query('SELECT is_archived FROM projects')).rows[0].is_archived).toBe(state ? 0 : 1)
      expect((await db.query('SELECT is_archived FROM tasks')).rows[0].is_archived).toBe(state ? 0 : 1)
      for (const table of ['projects', 'tasks']) {
        const row = (await db.query(`SELECT updated_at::text AS stamp FROM ${table}`)).rows[0]
        expect(Date.parse(String(row.stamp))).toBe(Date.parse('2026-01-01T00:00:00Z'))
      }
      const version = (await db.query('SELECT archive_updated_at::text FROM projects')).rows[0].archive_updated_at
      expect(Date.parse(String(version))).toBe(Date.parse(t20))
      await client.from('projects').update({ name: 'Metadata', updated_at: t30, is_archived: state }).eq('id', 'p')
      expect((await db.query('SELECT is_archived FROM projects')).rows[0].is_archived).toBe(state ? 0 : 1)
      await client.from('projects').update({ is_archived: state }).eq('id', 'p')
      expect((await db.query('SELECT is_archived FROM projects')).rows[0].is_archived).toBe(state ? 0 : 1)
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t10)
      await legacyArchive('p', state)
      vi.useRealTimers()
      expect((await db.query('SELECT is_archived FROM tasks')).rows[0].is_archived).toBe(state ? 0 : 1)
    }
    await db.exec(`ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_members ON projects FOR SELECT TO authenticated USING (true);
      CREATE POLICY update_owner ON projects FOR UPDATE TO authenticated
        USING (owner_id=current_setting('test.actor')) WITH CHECK (owner_id=current_setting('test.actor'));
      GRANT SELECT,UPDATE ON projects,tasks TO authenticated;
      SET ROLE authenticated; SET test.actor='member';`)
    expect((await db.query("UPDATE projects SET is_archived=1,archive_updated_at='2026-01-03' RETURNING id")).rows).toHaveLength(0)
    await expect(db.query('SELECT preserve_project_archive_version()')).rejects.toThrow(/permission denied/)
    await db.exec("SET test.actor='owner'")
    expect((await db.query("UPDATE projects SET is_archived=1,archive_updated_at='2026-01-03' RETURNING is_archived")).rows[0].is_archived).toBe(1)
  } finally { vi.useRealTimers(); await db.close() }
}, 15000)

it.each([0, 1])('keeps metadata versions independent of archive inheritance=%s', async (state) => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE projects(id text PRIMARY KEY,name text,description text,is_archived integer,updated_at timestamptz);
      CREATE TABLE tasks(id text PRIMARY KEY,project_id text,title text,description text,status_id text,is_archived integer,updated_at timestamptz,deleted_at timestamptz);
      INSERT INTO projects VALUES ('p','New','New description',${state},'2026-01-01T20:00Z');
      INSERT INTO tasks VALUES ('t','p','New','New description','new-status',${state},'2026-01-01T20:00Z',NULL);`)
    await db.exec(readFileSync(new URL('../../migrations/20261026102717_project_archive_version.sql', import.meta.url), 'utf8'))
    await db.exec(`UPDATE projects SET archive_updated_at='2026-01-01T10:00Z';
      INSERT INTO tasks VALUES ('t','p','Old','Old description','old-status',${1 - state},'2026-01-01T05:00Z',NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,status_id=excluded.status_id,is_archived=excluded.is_archived,updated_at=excluded.updated_at;
      INSERT INTO projects VALUES ('p','Old','Old description',${1 - state},'2026-01-01T05:00Z','2026-01-02T06:00Z')
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,is_archived=excluded.is_archived,updated_at=excluded.updated_at,archive_updated_at=excluded.archive_updated_at;`)
    const task = (await db.query('SELECT *,updated_at::text AS stamp FROM tasks')).rows[0]
    expect(task).toMatchObject({ title: 'New', description: 'New description', status_id: 'new-status', is_archived: state })
    expect(Date.parse(String(task.stamp))).toBe(Date.parse('2026-01-01T20:00Z'))
    const project = (await db.query('SELECT *,updated_at::text AS stamp,archive_updated_at::text AS version FROM projects')).rows[0]
    expect(project).toMatchObject({ name: 'New', description: 'New description', is_archived: 1 - state })
    expect(Date.parse(String(project.stamp))).toBe(Date.parse('2026-01-01T20:00Z'))
    expect(Date.parse(String(project.version))).toBe(Date.parse('2026-01-02T06:00Z'))
    await db.exec(`UPDATE tasks SET title='Newer metadata', updated_at='2026-01-01T21:00Z';`)
    const inherited = (await db.query('SELECT *,updated_at::text AS stamp FROM tasks')).rows[0]
    expect(inherited).toMatchObject({ title: 'Newer metadata', is_archived: 1 - state })
    expect(Date.parse(String(inherited.stamp))).toBe(Date.parse('2026-01-01T21:00Z'))
    await db.exec(`UPDATE tasks SET title='Latest metadata',updated_at='2026-01-01T22:00Z';
      UPDATE projects SET name='Stale metadata',updated_at='2026-01-01T04:00Z';`)
    expect((await db.query('SELECT title FROM tasks')).rows[0].title).toBe('Latest metadata')
    expect((await db.query('SELECT name FROM projects')).rows[0].name).toBe('New')
  } finally { await db.close() }
}, 15000)

it.each([0, 1])('inherits archive=%s on delayed INSERT/upsert and preserves metadata and later individual intent', async (state) => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE projects(id text PRIMARY KEY,owner_id text,name text,is_archived integer,updated_at timestamptz);
      CREATE TABLE statuses(id text PRIMARY KEY,project_id text,is_done integer,deleted_at timestamptz);
      CREATE TABLE tasks(id text PRIMARY KEY,project_id text,title text,status_id text,completed_date text,is_archived integer,updated_at timestamptz,deleted_at timestamptz);
      INSERT INTO projects VALUES ('p','owner','Original',${state},'2026-01-01T01:00Z');
      INSERT INTO statuses VALUES ('open','p',0,NULL),('done','p',1,NULL);`)
    await db.exec(readFileSync(new URL('../../migrations/20261026094537_task_status_assignment_guard.sql', import.meta.url), 'utf8'))
    await db.exec(readFileSync(new URL('../../migrations/20261026105740_disable_legacy_status_consistency_guard.sql', import.meta.url), 'utf8'))
    await db.exec(readFileSync(new URL('../../migrations/20261026102717_project_archive_version.sql', import.meta.url), 'utf8'))
    await db.exec(`UPDATE projects SET archive_updated_at='2026-01-01T10:00Z';
      INSERT INTO tasks VALUES ('insert','p','Pending','open',NULL,${1-state},'2026-01-01T05:00Z',NULL);
      INSERT INTO tasks VALUES ('upsert','p','Pending','done',NULL,${1-state},'2026-01-01T05:00Z',NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,is_archived=excluded.is_archived,updated_at=excluded.updated_at;
      INSERT INTO tasks VALUES ('deleted','p','Deleted','open',NULL,${1-state},'2026-01-01T05:00Z','2026-01-01T05:00Z');`)
    const rows = (await db.query('SELECT *,updated_at::text AS stamp FROM tasks ORDER BY id')).rows
    expect(rows.find((row) => row.id === 'deleted')?.is_archived).toBe(1-state)
    for (const id of ['insert', 'upsert']) {
      const row = rows.find((item) => item.id === id)!
      expect(row.is_archived).toBe(state)
      expect(Date.parse(String(row.stamp))).toBe(Date.parse('2026-01-01T05:00Z'))
    }
    expect(rows.find((row) => row.id === 'upsert')?.completed_date).toMatch(/Z$/)
    await db.exec(`UPDATE tasks SET is_archived=${1-state},updated_at='2026-01-01T12:00Z' WHERE id='insert';
      UPDATE tasks SET is_archived=${state} WHERE id='insert' AND updated_at<='2026-01-01T10:00Z';`)
    expect((await db.query("SELECT is_archived FROM tasks WHERE id='insert'")).rows[0].is_archived).toBe(1-state)
    await expect(db.exec("INSERT INTO tasks VALUES ('invalid','p','Bad','missing',NULL,0,'2026-01-01T05:00Z',NULL)")).rejects.toThrow(/Status must be active/)
    await db.exec(`ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY members_read ON tasks FOR SELECT TO authenticated USING (true);
      CREATE POLICY member_insert ON tasks FOR INSERT TO authenticated WITH CHECK (project_id='p' AND current_setting('test.actor') IN ('owner','member'));
      GRANT SELECT ON projects,statuses,tasks TO authenticated; GRANT INSERT ON tasks TO authenticated;
      SET ROLE authenticated; SET test.actor='member';
      INSERT INTO tasks VALUES ('member','p','Member pending','open',NULL,${1-state},'2026-01-01T05:00Z',NULL);`)
    expect((await db.query("SELECT is_archived FROM tasks WHERE id='member'")).rows[0].is_archived).toBe(state)
    await db.exec("SET test.actor='outsider'")
    await expect(db.exec("INSERT INTO tasks VALUES ('outsider','p','Bad','open',NULL,0,'2026-01-01T05:00Z',NULL)")).rejects.toThrow(/row-level security/)
  } finally { await db.close() }
}, 15000)
