import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('emits task updates after actual junction additions without advancing versions', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE tasks(id text PRIMARY KEY,updated_at timestamptz,deleted_at timestamptz);
      CREATE TABLE task_labels(task_id text REFERENCES tasks(id),label_id text,deleted_at timestamptz,PRIMARY KEY(task_id,label_id));
      CREATE TABLE events(task_id text);
      CREATE FUNCTION record_task_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.events VALUES(NEW.id); RETURN NEW; END; $$;
      CREATE TRIGGER record_task_update AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION record_task_update();
      INSERT INTO tasks VALUES('t','2026-01-01',NULL);`)
    await db.exec(readFileSync(new URL('../../migrations/20261026111055_task_label_addition_realtime.sql', import.meta.url), 'utf8'))
    const before = (await db.query('SELECT updated_at::text FROM tasks')).rows[0].updated_at
    await db.exec("INSERT INTO task_labels VALUES('t','label',NULL)")
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(1)
    expect((await db.query('SELECT updated_at::text FROM tasks')).rows[0].updated_at).toBe(before)
    await db.exec("INSERT INTO task_labels VALUES('t','label',NULL) ON CONFLICT(task_id,label_id) DO UPDATE SET deleted_at=NULL")
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(1)
    await db.exec("UPDATE task_labels SET deleted_at=now()")
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(1)
    await db.exec("UPDATE task_labels SET deleted_at=NULL")
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(2)
    await db.exec(`INSERT INTO tasks SELECT 'batch-'||n,'2026-01-01',NULL FROM generate_series(1,500) n;
      INSERT INTO task_labels SELECT 'batch-'||n,'label-'||l,NULL FROM generate_series(1,500) n CROSS JOIN generate_series(1,3) l;`)
    expect((await db.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(1502)
    await db.exec(`INSERT INTO task_labels SELECT 'batch-'||n,'label-'||l,NULL FROM generate_series(1,500) n CROSS JOIN generate_series(1,3) l
      ON CONFLICT(task_id,label_id) DO UPDATE SET deleted_at=NULL;`)
    expect((await db.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(1502)
    await db.exec("BEGIN; INSERT INTO task_labels VALUES('t','rollback',NULL); ROLLBACK;")
    expect((await db.query("SELECT * FROM task_labels WHERE label_id='rollback'")).rows).toHaveLength(0)
    expect((await db.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(1502)
    await db.exec(`ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
      CREATE POLICY allowed ON task_labels FOR INSERT TO authenticated WITH CHECK(label_id<>'denied');
      GRANT INSERT ON task_labels TO authenticated; GRANT SELECT,UPDATE ON tasks TO authenticated; GRANT INSERT ON events TO authenticated;
      SET ROLE authenticated;`)
    await expect(db.exec("INSERT INTO task_labels VALUES('t','denied',NULL)")).rejects.toThrow(/row-level security/)
    await db.exec('RESET ROLE')
    expect((await db.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(1502)
  } finally { await db.close() }
}, 15000)
