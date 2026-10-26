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
CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,status_id uuid REFERENCES statuses(id),completed_date timestamptz,updated_at timestamptz,deleted_at timestamptz);`);
const migration=readFileSync(new URL('../../migrations/20261025222717_atomic_status_management.sql', import.meta.url),'utf8'); await db.exec(migration);
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
const task=(await db.query('SELECT * FROM tasks WHERE id=$1',[tid])).rows[0];assert.equal(task.status_id,b);assert.ok(task.completed_date);
await assert.rejects(mutate('reorder',{status_ids:[a,b,c]}),/exactly once/);
assert.equal((await mutate('ensure',{names:['QA',' qa ','QA','']})).created_count,1);
assert.equal((await mutate('ensure',{names:['QA']})).created_count,0);
// Missing done flag recovery sets existing tasks' completion timestamps atomically.
await db.query('UPDATE statuses SET is_done=0 WHERE id=$1',[b]);
await db.query('UPDATE tasks SET completed_date=NULL WHERE id=$1',[tid]);
await mutate('update',{id:b,is_done:true}); assert.ok((await db.query('SELECT completed_date FROM tasks WHERE id=$1',[tid])).rows[0].completed_date);
await db.exec('GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; SET ROLE authenticated');
await assert.rejects(mutate('ensure',{names:['Forged']}),/Invalid status actor/);
await db.exec('RESET ROLE');
await db.exec(`CREATE TABLE user_labels(id uuid PRIMARY KEY, name text, color text);
CREATE TABLE project_labels(project_id uuid, label_id uuid REFERENCES user_labels(id), created_at timestamptz, deleted_at timestamptz, PRIMARY KEY(project_id,label_id));
CREATE PUBLICATION supabase_realtime;`);
await db.exec(readFileSync(new URL('../../migrations/20261025222225_shared_label_realtime.sql', import.meta.url), 'utf8'));
await db.query('INSERT INTO user_labels VALUES($1,$2,$3)',[a,'Original','#fff']);
await db.query("INSERT INTO project_labels VALUES($1,$2,now(),NULL,'2026-01-01')",[project,a]);
await db.query('UPDATE user_labels SET name=$1 WHERE id=$2',['Renamed',a]);
assert.ok(new Date((await db.query<{updated_at: string}>('SELECT updated_at FROM project_labels')).rows[0].updated_at).getUTCFullYear() >= 2026);
await db.close()
}, 15000)
