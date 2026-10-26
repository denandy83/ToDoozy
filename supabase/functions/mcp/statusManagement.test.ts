import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { it } from 'vitest'

it('enforces atomic status invariants, owner access, and partial reordering', async () => {
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
CREATE TABLE projects(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
CREATE TABLE statuses(id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id), name text NOT NULL,color text,icon text,order_index integer,is_done integer,is_default integer,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,status_id uuid REFERENCES statuses(id),completed_date text,updated_at timestamptz,deleted_at timestamptz);`);
const migration=readFileSync(new URL('../../migrations/20261026075322_atomic_status_management.sql', import.meta.url),'utf8'); await db.exec(migration);
await db.exec(readFileSync(new URL('../../migrations/20261026092325_task_status_assignment_guard.sql', import.meta.url), 'utf8'));
const project='00000000-0000-0000-0000-000000000001', actor='00000000-0000-0000-0000-000000000002';
const a='00000000-0000-0000-0000-000000000003', b='00000000-0000-0000-0000-000000000004', c='00000000-0000-0000-0000-000000000005';
await db.query('INSERT INTO projects VALUES($1,$2,NULL)',[project,actor]);
const mutate=async(action,input,user=actor)=>(await db.query('SELECT manage_project_status($1,$2,$3,$4) AS result',[project,user,action,input])).rows[0].result;
await assert.rejects(mutate('create',{id:a,name:'No'},a),/Only the project owner/);
await assert.rejects(mutate('create',{id:a,name:'  '}),/blank/);
assert.equal((await mutate('create',{id:a,name:'Open',is_default:1})).is_default,1);
await assert.rejects(mutate('create',{id:c,name:'Second default',is_default:1}),/one default/);
await assert.rejects(mutate('delete',{id:a,target_id:b}),/retained/);
await mutate('create',{id:b,name:'Done',is_done:true});
await assert.rejects(mutate('create',{id:c,name:'Second Done',is_done:true}),/one done/);
await mutate('create',{id:c,name:'Testing'});
await assert.rejects(mutate('update',{id:a,is_done:true}),/one done/);
await assert.rejects(mutate('update',{id:b,is_done:false}),/retained/);
await assert.rejects(mutate('delete',{id:b,target_id:a}),/retained/);
await assert.rejects(mutate('reorder',{status_ids:[a,a,c]}),/exactly once/);
await mutate('update',{id:a,name:'Renamed'});
assert.equal((await mutate('reorder',{status_ids:[c,b,a]}))[2].name,'Renamed');
const tid='00000000-0000-0000-0000-000000000006';
await db.query('INSERT INTO tasks(id,project_id,status_id) VALUES($1,$2,$3)',[tid,project,c]);
await mutate('delete',{id:c,target_id:b});
const assertIsoCompletion = (value: unknown) => {
  assert.equal(typeof value, 'string');
  assert.match(value as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(value as string).toISOString(), value);
};
const task=(await db.query('SELECT * FROM tasks WHERE id=$1',[tid])).rows[0];assert.equal(task.status_id,b);assertIsoCompletion(task.completed_date);
await assert.rejects(mutate('reorder',{status_ids:[a,b,c]}),/exactly once/);
assert.equal((await mutate('ensure',{names:['QA',' qa ','QA','']})).created_count,1);
assert.equal((await mutate('ensure',{names:['QA']})).created_count,0);
// Missing done flag recovery sets existing tasks' completion timestamps atomically.
await db.query('UPDATE statuses SET is_done=0 WHERE id=$1',[b]);
await db.query('UPDATE tasks SET completed_date=NULL WHERE id=$1',[tid]);
await mutate('update',{id:b,is_done:true}); assertIsoCompletion((await db.query('SELECT completed_date FROM tasks WHERE id=$1',[tid])).rows[0].completed_date);
await db.exec('GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; SET ROLE authenticated');
await assert.rejects(mutate('ensure',{names:['Forged']}),/Invalid status actor/);
await db.exec('RESET ROLE');
await db.exec(`CREATE TABLE user_labels(id uuid PRIMARY KEY, name text, color text);
CREATE TABLE project_labels(project_id uuid, label_id uuid REFERENCES user_labels(id), created_at timestamptz, deleted_at timestamptz, PRIMARY KEY(project_id,label_id));
CREATE PUBLICATION supabase_realtime;`);
await db.exec(readFileSync(new URL('../../migrations/20261026075319_shared_label_realtime.sql', import.meta.url), 'utf8'));
await db.query('INSERT INTO user_labels VALUES($1,$2,$3)',[a,'Original','#fff']);
await db.query("INSERT INTO project_labels VALUES($1,$2,now(),NULL,'2026-01-01')",[project,a]);
await db.query('UPDATE user_labels SET name=$1 WHERE id=$2',['Renamed',a]);
assert.ok(new Date((await db.query<{updated_at: string}>('SELECT updated_at FROM project_labels')).rows[0].updated_at).getUTCFullYear() >= 2026);
await db.close()
}, 15000)

it('guards all task insert/upsert/copy/update assignments and status interleavings prospectively', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.sub', true)::uuid $$;
      CREATE TABLE projects(id uuid PRIMARY KEY, owner_id uuid, deleted_at timestamptz);
      CREATE TABLE project_members(project_id uuid, user_id uuid);
      CREATE TABLE statuses(id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id), name text, color text, icon text,
        order_index integer, is_done integer, is_default integer, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
      CREATE TABLE tasks(id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id), status_id uuid REFERENCES statuses(id),
        title text, completed_date text, updated_at timestamptz, deleted_at timestamptz);
      SET TIME ZONE 'Pacific/Auckland';`)
    const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
    const project = id(1), other = id(2), owner = id(3), member = id(4), open = id(5), custom = id(6), foreign = id(7)
    await db.query('INSERT INTO projects VALUES ($1,$3,NULL),($2,$3,NULL)', [project, other, owner])
    await db.query('INSERT INTO project_members VALUES ($1,$2),($1,$3)', [project, owner, member])
    await db.query(`INSERT INTO statuses(id,project_id,name,is_done,is_default) VALUES
      ($1,$4,'Open',0,1),($2,$4,'Custom',0,0),($3,$5,'Foreign',0,1)`, [open, custom, foreign, project, other])
    await db.query("INSERT INTO tasks(id,project_id,status_id,title,completed_date) VALUES($1,$2,$3,'legacy','legacy-value')", [id(8), project, foreign])
    for (const file of ['20261026075322_atomic_status_management.sql', '20261026092325_task_status_assignment_guard.sql']) {
      await db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
    }
    assert.equal((await db.query('SELECT completed_date FROM tasks WHERE id=$1', [id(8)])).rows[0].completed_date, 'legacy-value')
    const mutate = (action: string, input: object, actor = owner) => db.query('SELECT manage_project_status($1,$2,$3,$4)', [project, actor, action, input])
    const insert = (taskId: string, status: string, completion: string | null = null) => db.query(
      "INSERT INTO tasks(id,project_id,status_id,title,completed_date) VALUES($1,$2,$3,'Task',$4) ON CONFLICT(id) DO UPDATE SET status_id=excluded.status_id,completed_date=excluded.completed_date",
      [taskId, project, status, completion])
    await assert.rejects(insert(id(10), foreign), /active and belong/)
    await assert.rejects(mutate('update', { id: custom, is_done: true }, member), /Only the project owner/)
    await insert(id(10), custom, '2020-01-01T00:00:00.000Z')
    assert.equal((await db.query('SELECT completed_date FROM tasks WHERE id=$1', [id(10)])).rows[0].completed_date, null)
    await db.query('SELECT id FROM statuses WHERE id=$1 AND deleted_at IS NULL', [custom])
    await mutate('delete', { id: custom, target_id: open })
    await assert.rejects(insert(id(10), custom), /active and belong/)
    await assert.rejects(insert(id(11), custom), /active and belong/)
    assert.equal((await db.query('SELECT status_id FROM tasks WHERE id=$1', [id(10)])).rows[0].status_id, open)
    await db.query('SELECT is_done FROM statuses WHERE id=$1', [open])
    await mutate('update', { id: open, is_done: true })
    await insert(id(10), open)
    for (const taskId of [id(11), id(12), id(13), id(14)]) {
      await db.query("INSERT INTO tasks(id,project_id,status_id,title) SELECT $1,project_id,status_id,'Copy/template' FROM tasks WHERE id=$2", [taskId, id(10)])
    }
    const completions = await db.query<{ completed_date: string }>('SELECT completed_date FROM tasks WHERE id <> $1', [id(8)])
    for (const row of completions.rows) assert.equal(new Date(row.completed_date).toISOString(), row.completed_date)
    await assert.rejects(mutate('delete', { id: open, target_id: custom }), /retained/)
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated;
      GRANT SELECT ON projects,project_members,statuses TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON tasks TO authenticated;
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY member_tasks ON tasks FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM project_members WHERE project_id=tasks.project_id AND user_id=auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM project_members WHERE project_id=tasks.project_id AND user_id=auth.uid()));`)
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [member])
    await db.exec('SET ROLE authenticated')
    await insert(id(15), open)
    await db.query('UPDATE tasks SET completed_date=NULL WHERE id=$1', [id(15)])
    assert.match((await db.query<{ completed_date: string }>('SELECT completed_date FROM tasks WHERE id=$1', [id(15)])).rows[0].completed_date, /Z$/)
    await assert.rejects(mutate('update', { id: open, name: 'Forged' }, owner), /Invalid status actor/)
    await assert.rejects(insert(id(16), foreign), /active and belong/)
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(99)])
    await assert.rejects(insert(id(17), open), /row-level security/)
    await db.exec('RESET ROLE')
    await db.exec('BEGIN')
    await insert(id(18), open)
    await db.exec('COMMIT')
    await db.query('UPDATE statuses SET is_done=0 WHERE id=$1', [open])
    assert.equal((await db.query('SELECT completed_date FROM tasks WHERE id=$1', [id(18)])).rows[0].completed_date, null)
    await assert.rejects(db.query('UPDATE statuses SET deleted_at=now() WHERE id=$1', [open]), /Reassign active tasks/)
  } finally { await db.close() }
}, 15000)
