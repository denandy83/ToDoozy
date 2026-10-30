import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('notifies meaningful assignment changes after the junction mutation without advancing metadata versions', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE tasks(id text PRIMARY KEY,updated_at timestamptz,deleted_at timestamptz);
      CREATE TABLE task_labels(task_id text REFERENCES tasks(id) ON DELETE CASCADE,label_id text,deleted_at timestamptz,PRIMARY KEY(task_id,label_id));
      CREATE TABLE events(task_id text);
      CREATE FUNCTION record_task_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.events VALUES(NEW.id); RETURN NEW; END; $$;
      CREATE TRIGGER record_task_update AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION record_task_update();
      INSERT INTO tasks VALUES('t','2026-01-01',NULL);`)
    await db.exec(readFileSync(new URL('../../migrations/20261030052324_task_label_addition_realtime.sql', import.meta.url), 'utf8'))
    const events=async()=> (await db.query<{n:number}>('SELECT count(*)::int AS n FROM events')).rows[0].n
    const before = (await db.query<{updated_at:string}>('SELECT updated_at::text FROM tasks')).rows[0].updated_at
    await db.exec("INSERT INTO task_labels VALUES('t','label',NULL)")
    expect(await events()).toBe(1)
    await db.exec("INSERT INTO task_labels VALUES('t','label',NULL) ON CONFLICT(task_id,label_id) DO UPDATE SET deleted_at=NULL")
    expect(await events()).toBe(1)
    await db.exec("UPDATE task_labels SET deleted_at=now()")
    expect(await events()).toBe(2)
    await db.exec("UPDATE task_labels SET deleted_at=now()")
    expect(await events()).toBe(2)
    await db.exec("UPDATE task_labels SET deleted_at=NULL")
    expect(await events()).toBe(3)
    const readerBefore=(await db.query("SELECT label_id FROM task_labels WHERE task_id='t' AND deleted_at IS NULL")).rows
    expect(readerBefore).toHaveLength(1)
    await db.exec("DELETE FROM task_labels WHERE task_id='t'")
    expect(await events()).toBe(4)
    expect((await db.query("SELECT label_id FROM task_labels WHERE task_id='t' AND deleted_at IS NULL")).rows).toEqual([])
    await db.exec("DELETE FROM task_labels WHERE task_id='t'")
    await db.exec("INSERT INTO task_labels VALUES('t','already-removed',now()); DELETE FROM task_labels WHERE label_id='already-removed'")
    expect(await events()).toBe(4)
    expect((await db.query<{updated_at:string}>("SELECT updated_at::text FROM tasks WHERE id='t'")).rows[0].updated_at).toBe(before)
    await db.exec(`INSERT INTO tasks SELECT 'batch-'||n,'2026-01-01',NULL FROM generate_series(1,500) n;
      INSERT INTO task_labels SELECT 'batch-'||n,'label-'||l,NULL FROM generate_series(1,500) n CROSS JOIN generate_series(1,3) l;`)
    expect(await events()).toBe(1504)
    await db.exec(`INSERT INTO task_labels SELECT 'batch-'||n,'label-'||l,NULL FROM generate_series(1,500) n CROSS JOIN generate_series(1,3) l
      ON CONFLICT(task_id,label_id) DO UPDATE SET deleted_at=NULL;`)
    expect(await events()).toBe(1504)
    await db.exec("BEGIN; DELETE FROM task_labels WHERE task_id='batch-1'; ROLLBACK;")
    expect((await db.query("SELECT * FROM task_labels WHERE task_id='batch-1'")).rows).toHaveLength(3)
    expect(await events()).toBe(1504)
    await db.exec("BEGIN; INSERT INTO task_labels VALUES('t','rollback',NULL); ROLLBACK;")
    expect((await db.query("SELECT * FROM task_labels WHERE label_id='rollback'")).rows).toHaveLength(0)
    expect(await events()).toBe(1504)
    await db.exec("DELETE FROM tasks WHERE id='batch-1'")
    expect((await db.query("SELECT * FROM task_labels WHERE task_id='batch-1'")).rows).toHaveLength(0)
    expect(await events()).toBe(1504)
    await db.exec("UPDATE tasks SET deleted_at=now() WHERE id='batch-2'")
    const deletionEvents=await events()
    await db.exec("DELETE FROM task_labels WHERE task_id='batch-2'")
    expect(await events()).toBe(deletionEvents)
  } finally { await db.close() }
}, 15000)

it('keeps junction notifications inside owner/member RLS and transaction boundaries',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE tasks(id text PRIMARY KEY,owner_id text,updated_at timestamptz,deleted_at timestamptz);
      CREATE TABLE members(task_id text,user_id text);
      CREATE TABLE task_labels(task_id text REFERENCES tasks(id) ON DELETE CASCADE,label_id text,deleted_at timestamptz,PRIMARY KEY(task_id,label_id));
      CREATE TABLE events(task_id text);
      CREATE FUNCTION record_task_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.events VALUES(NEW.id); RETURN NEW; END; $$;
      CREATE TRIGGER record_task_update AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION record_task_update();
      INSERT INTO tasks VALUES('shared','owner','2026-01-01',NULL),('private','other','2026-01-01',NULL);
      INSERT INTO members VALUES('shared','owner'),('shared','member'),('private','other');
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
      CREATE POLICY task_read ON tasks FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM members WHERE task_id=id AND user_id=current_setting('request.jwt.claim.sub')));
      CREATE POLICY task_write ON tasks FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM members WHERE task_id=id AND user_id=current_setting('request.jwt.claim.sub'))) WITH CHECK(EXISTS(SELECT 1 FROM members WHERE task_id=id AND user_id=current_setting('request.jwt.claim.sub')));
      CREATE POLICY links ON task_labels FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM members WHERE members.task_id=task_labels.task_id AND user_id=current_setting('request.jwt.claim.sub'))) WITH CHECK(EXISTS(SELECT 1 FROM members WHERE members.task_id=task_labels.task_id AND user_id=current_setting('request.jwt.claim.sub')));
      GRANT SELECT,UPDATE ON tasks TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON task_labels TO authenticated;
      GRANT SELECT ON members TO authenticated; GRANT INSERT ON events TO authenticated;`)
    await db.exec(readFileSync(new URL('../../migrations/20261030052324_task_label_addition_realtime.sql',import.meta.url),'utf8'))
    await db.exec("SET ROLE authenticated; SET request.jwt.claim.sub='owner'; INSERT INTO task_labels VALUES('shared','label',NULL)")
    await db.exec("SET request.jwt.claim.sub='member'; DELETE FROM task_labels WHERE task_id='shared'; INSERT INTO task_labels VALUES('shared','label',NULL)")
    await expect(db.exec("INSERT INTO task_labels VALUES('private','denied',NULL)")).rejects.toThrow(/row-level security/)
    await db.exec("SET request.jwt.claim.sub='outsider'; DELETE FROM task_labels WHERE task_id='shared'; UPDATE task_labels SET deleted_at=now() WHERE task_id='shared'")
    await expect(db.exec("INSERT INTO task_labels VALUES('shared','denied',NULL)")).rejects.toThrow(/row-level security/)
    await db.exec('RESET ROLE')
    expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(3)
    expect((await db.query("SELECT * FROM task_labels WHERE task_id='shared' AND deleted_at IS NULL")).rows).toHaveLength(1)
    expect((await db.query<{stamp:string}>("SELECT updated_at::text AS stamp FROM tasks WHERE id='shared'")).rows[0].stamp).toBe('2026-01-01 00:00:00+00')
  } finally {await db.close()}
},15000)
