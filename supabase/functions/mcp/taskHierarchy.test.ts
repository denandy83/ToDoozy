import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('guards direct server writes against cycles, foreign parents and split subtrees without rewriting legacy rows', async () => {
  const db=new PGlite()
  const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  try {
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,parent_id uuid,deleted_at timestamptz,title text)')
    await db.query('INSERT INTO tasks VALUES($1,$2,NULL,NULL,$3)',[id(9),id(1),'Untouched legacy'])
    await db.exec(readFileSync(new URL('../../migrations/20261030221433_task_hierarchy_guard.sql',import.meta.url),'utf8'))
    await db.exec('GRANT SELECT,INSERT,UPDATE ON tasks TO authenticated; SET ROLE authenticated')
    await db.query('INSERT INTO tasks VALUES($1,$2,NULL,NULL,$3)',[id(10),id(1),'Root'])
    await db.query('INSERT INTO tasks VALUES($1,$2,$3,NULL,$4)',[id(11),id(1),id(10),'Child'])
    await expect(db.query('UPDATE tasks SET parent_id=$1 WHERE id=$2',[id(11),id(10)])).rejects.toThrow(/ancestor/)
    await expect(db.query('INSERT INTO tasks VALUES($1,$2,$3,NULL,$4)',[id(12),id(2),id(10),'Foreign'])).rejects.toThrow(/same project/)
    await expect(db.query('UPDATE tasks SET project_id=$1 WHERE id=$2',[id(2),id(10)])).rejects.toThrow(/subtree/)
    expect((await db.query('SELECT title FROM tasks WHERE id=$1',[id(9)])).rows[0].title).toBe('Untouched legacy')
    await db.query('UPDATE tasks SET title=$1 WHERE id=$2',['Ordinary edit',id(11)])
    expect((await db.query('SELECT parent_id FROM tasks WHERE id=$1',[id(10)])).rows[0].parent_id).toBeNull()
  } finally { await db.close() }
},15000)

it('checks authenticated visibility and service-role graph writes without granting direct trigger execution',async()=>{
  const db=new PGlite()
  const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,parent_id uuid,deleted_at timestamptz,title text);
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY project_scope ON tasks TO authenticated
        USING(project_id=nullif(current_setting('request.jwt.claim.project',true),'')::uuid)
        WITH CHECK(project_id=nullif(current_setting('request.jwt.claim.project',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE ON tasks TO authenticated,service_role;`)
    await db.exec(readFileSync(new URL('../../migrations/20261030221433_task_hierarchy_guard.sql',import.meta.url),'utf8'))
    await db.query('INSERT INTO tasks VALUES($1,$2,NULL,NULL,$3)',[id(10),id(1),'Own root'])
    await db.query('INSERT INTO tasks VALUES($1,$2,NULL,NULL,$3)',[id(20),id(2),'Foreign root'])
    await db.query("SELECT set_config('request.jwt.claim.project',$1,false)",[id(1)])
    await db.exec('SET ROLE authenticated')
    expect((await db.query('SELECT id FROM tasks')).rows).toHaveLength(1)
    await expect(db.query('INSERT INTO tasks VALUES($1,$2,$3,NULL,$4)',[id(11),id(1),id(20),'Hidden parent'])).rejects.toThrow(/same project/)
    await db.query('INSERT INTO tasks VALUES($1,$2,$3,NULL,$4)',[id(11),id(1),id(10),'Own child'])
    await expect(db.query('SELECT guard_task_parent()')).rejects.toThrow(/permission denied/)
    await db.exec('RESET ROLE; SET ROLE service_role')
    await expect(db.query('INSERT INTO tasks VALUES($1,$2,$3,NULL,$4)',[id(21),id(2),id(10),'Service foreign parent'])).rejects.toThrow(/same project/)
    await expect(db.query('UPDATE tasks SET parent_id=$1 WHERE id=$2',[id(11),id(10)])).rejects.toThrow(/ancestor/)
    await db.exec('RESET ROLE; SET ROLE anon')
    await expect(db.query('SELECT * FROM tasks')).rejects.toThrow(/permission denied/)
  } finally { await db.close() }
},15000)

it('holds old/new project advisory locks until transaction end and rolls back a multi-statement cycle',async()=>{
  const db=new PGlite()
  const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  try {
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,parent_id uuid,deleted_at timestamptz,title text)')
    await db.exec(readFileSync(new URL('../../migrations/20261030221433_task_hierarchy_guard.sql',import.meta.url),'utf8'))
    await db.query('INSERT INTO tasks VALUES($1,$3,NULL,NULL,$4),($2,$3,NULL,NULL,$5)',[id(10),id(11),id(1),'A','B'])
    await db.exec('BEGIN')
    await db.query('UPDATE tasks SET project_id=$1 WHERE id=$2',[id(2),id(10)])
    const locks=await db.query<{mode:string;granted:boolean}>("SELECT mode,granted FROM pg_locks WHERE locktype='advisory'")
    expect(locks.rows).toHaveLength(2)
    expect(locks.rows.every(lock=>lock.granted&&lock.mode==='ExclusiveLock')).toBe(true)
    await db.exec('ROLLBACK')
    expect((await db.query("SELECT 1 FROM pg_locks WHERE locktype='advisory'")).rows).toHaveLength(0)
    await db.exec('BEGIN')
    await db.query('UPDATE tasks SET parent_id=$1 WHERE id=$2',[id(11),id(10)])
    await expect(db.query('UPDATE tasks SET parent_id=$1 WHERE id=$2',[id(10),id(11)])).rejects.toThrow(/ancestor/)
    await db.exec('ROLLBACK')
    expect((await db.query<{parent_id:string|null}>('SELECT parent_id FROM tasks')).rows.every(row=>row.parent_id===null)).toBe(true)
  } finally { await db.close() }
},15000)

it('validates a tombstone restoration before making a child of a deleted parent active',async()=>{
  const db=new PGlite()
  const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  try {
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,parent_id uuid,deleted_at timestamptz,title text)')
    await db.exec(readFileSync(new URL('../../migrations/20261030221433_task_hierarchy_guard.sql',import.meta.url),'utf8'))
    await db.query('INSERT INTO tasks VALUES($1,$2,NULL,NULL,$3)',[id(10),id(1),'Parent'])
    await db.query('INSERT INTO tasks VALUES($1,$2,$3,NULL,$4)',[id(11),id(1),id(10),'Child'])
    await db.query('UPDATE tasks SET deleted_at=now() WHERE id IN ($1,$2)',[id(10),id(11)])
    await expect(db.query('UPDATE tasks SET deleted_at=NULL WHERE id=$1',[id(11)])).rejects.toThrow(/active task/)
    expect((await db.query<{deleted_at:unknown}>('SELECT deleted_at FROM tasks WHERE id=$1',[id(11)])).rows[0].deleted_at).not.toBeNull()
  } finally { await db.close() }
},15000)
