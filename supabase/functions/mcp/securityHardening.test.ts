import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz DEFAULT now());
    CREATE TABLE projects(id uuid PRIMARY KEY,owner_id uuid NOT NULL,name text,description text,color text,icon text,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE project_members(project_id uuid,user_id uuid,role text,joined_at timestamptz,display_color text,display_initials text,PRIMARY KEY(project_id,user_id));
    CREATE TABLE project_invites(token uuid PRIMARY KEY,project_id uuid,target_email text,status text,expires_at timestamptz,accepted_by uuid);
    CREATE TABLE tasks(id uuid PRIMARY KEY,status_id uuid);
    CREATE TABLE user_settings(id uuid PRIMARY KEY,user_id uuid,value text);
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_invites ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_membership ON project_members FOR SELECT USING(user_id=auth.uid());
    CREATE POLICY own_project ON projects FOR SELECT USING(owner_id=auth.uid() OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=projects.id AND m.user_id=auth.uid()));
    CREATE POLICY "Authenticated users can read invites" ON project_invites FOR SELECT USING(auth.uid() IS NOT NULL);
    CREATE POLICY "Invite can be accepted" ON project_invites FOR UPDATE USING(auth.uid() IS NOT NULL) WITH CHECK(status='accepted' AND accepted_by=auth.uid());
    CREATE POLICY own_settings ON user_settings FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE VIEW user_profiles AS SELECT id,email FROM auth.users;
    GRANT SELECT,INSERT,UPDATE,DELETE ON projects,project_members,project_invites TO anon,authenticated,service_role;`)
  for (const name of ['001_rename_shared_tables', '20260427000000_share_project_explicit_owner', '20260429010000_get_user_profiles_rpc']) {
    const text = readFileSync(new URL(`../../migrations/${name}.sql`, import.meta.url), 'utf8')
    for (const match of text.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g)) await db.exec(match[0])
  }
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$3),($2,$4)', [id(1),id(2),'alice@example.invalid','bob@example.invalid'])
  await db.query("INSERT INTO projects(id,owner_id,name) VALUES($1,$2,'Private')", [id(10),id(2)])
  await db.query("INSERT INTO project_members(project_id,user_id,role,joined_at) VALUES($1,$2,'owner',now())", [id(10),id(2)])
  await db.query("INSERT INTO project_invites VALUES($1,$2,'bob@example.invalid','pending',now()+interval '1 day',NULL)", [id(20),id(10)])
})
afterEach(async () => { await db.close() })

async function as<T>(role: string, user: string | null, action: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user ?? ''])
  await db.exec(`SET ROLE ${role}`)
  try { return await action() } finally { await db.exec('RESET ROLE') }
}
async function harden(): Promise<void> {
  await db.exec(readFileSync(new URL('../../migrations/20261030213612_security_performance_hardening.sql', import.meta.url),'utf8'))
}

it('reproduces the old anonymous ownership exploit and rejects it after migration', async () => {
  const attack = () => db.query('SELECT share_project($1,$2,NULL,$3,$4,$5)', [id(10),'Forged','#fff','folder',id(1)])
  await as('anon',null,attack)
  expect((await db.query('SELECT role FROM project_members WHERE user_id=$1',[id(1)])).rows).toHaveLength(1)
  await db.query('DELETE FROM project_members WHERE user_id=$1',[id(1)])
  await harden()
  await expect(as('anon',null,attack)).rejects.toThrow(/permission denied/)
  await expect(as('authenticated',id(1),attack)).rejects.toThrow(/Only the project owner/)
  expect((await db.query('SELECT role FROM project_members WHERE user_id=$1',[id(1)])).rows).toHaveLength(0)
  await as('authenticated',id(2),()=>db.query('SELECT share_project($1,$2)',[id(10),'Owner rename']))
  await as('service_role',null,()=>db.query('SELECT share_project($1,$2,NULL,$3,$4,$5)',[id(11),'MCP create','#fff','folder',id(1)]))
  await expect(as('service_role',null,()=>db.query('SELECT share_project($1,$2,NULL,$3,$4,$5)',[id(10),'Wrong owner','#fff','folder',id(1)]))).rejects.toThrow(/Only the project owner/)
  expect((await db.query('SELECT name FROM projects WHERE id=$1',[id(10)])).rows[0].name).toBe('Owner rename')
},15000)

it('prevents invite enumeration and wrong recipients while preserving targeted and untargeted acceptance', async () => {
  await harden()
  await expect(as('anon',null,()=>db.query('SELECT * FROM get_pending_invites_for_email($1)',['bob@example.invalid']))).rejects.toThrow(/permission denied/)
  await expect(as('authenticated',id(1),()=>db.query('SELECT * FROM get_pending_invites_for_email($1)',['bob@example.invalid']))).rejects.toThrow(/own pending/)
  expect((await as('authenticated',id(1),()=>db.query('SELECT token FROM project_invites'))).rows).toHaveLength(0)
  expect((await as('authenticated',id(2),()=>db.query('SELECT * FROM get_pending_invites_for_email($1)',[' BOB@example.invalid ']))).rows).toHaveLength(1)
  await expect(as('authenticated',id(1),()=>db.query('SELECT accept_invite($1)',[id(20)]))).rejects.toThrow(/another user/)
  expect((await db.query('SELECT status FROM project_invites')).rows[0].status).toBe('pending')
  await as('authenticated',id(2),()=>db.query('SELECT accept_invite($1)',[id(20)]))
  await expect(as('authenticated',id(2),()=>db.query('SELECT accept_invite($1)',[id(20)]))).rejects.toThrow(/unavailable/)
  await db.query("INSERT INTO project_invites VALUES($1,$2,NULL,'pending',now()+interval '1 day',NULL)",[id(21),id(10)])
  await as('authenticated',id(1),()=>db.query('SELECT accept_invite($1)',[id(21)]))
  expect((await db.query('SELECT role FROM project_members WHERE user_id=$1',[id(1)])).rows[0].role).toBe('member')
},15000)

it('limits profile visibility to self/shared members and explicitly grants RLS-protected tables', async () => {
  await harden()
  await expect(as('anon',null,()=>db.query('SELECT * FROM get_user_profiles($1)',[[id(2)]]))).rejects.toThrow(/permission denied/)
  expect((await as('authenticated',id(1),()=>db.query('SELECT * FROM get_user_profiles($1)',[[id(2)]]))).rows).toHaveLength(0)
  await db.query("INSERT INTO project_members(project_id,user_id,role,joined_at) VALUES($1,$2,'member',now())",[id(10),id(1)])
  expect((await as('authenticated',id(1),()=>db.query('SELECT * FROM get_user_profiles($1)',[[id(2)]]))).rows).toHaveLength(1)
  await as('authenticated',id(1),()=>db.query('INSERT INTO user_settings VALUES($1,$2,$3)',[id(30),id(1),'mine']))
  expect((await as('authenticated',id(2),()=>db.query('SELECT * FROM user_settings'))).rows).toHaveLength(0)
  await expect(as('authenticated',id(2),()=>db.query('INSERT INTO user_settings VALUES($1,$2,$3)',[id(31),id(1),'forged']))).rejects.toThrow(/row-level security/)
},15000)

it('preserves policy string-literal semantics while caching auth lookups', async () => {
  await db.exec(`ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON user_settings TO authenticated;
    DROP POLICY own_settings ON user_settings;
    CREATE POLICY literal_guard ON user_settings FOR SELECT TO authenticated
      USING(user_id=auth.uid() AND value <> 'auth.uid()');`)
  await db.query('INSERT INTO user_settings VALUES($1,$3,$4),($2,$3,$5)',
    [id(40),id(41),id(1),'auth.uid()','ordinary'])
  const visible = () => as('authenticated',id(1),()=>db.query('SELECT id FROM user_settings ORDER BY id'))
  const before = (await visible()).rows
  expect(before).toEqual([{id:id(41)}])
  await harden()
  expect((await visible()).rows).toEqual(before)
},15000)

it('requires a verified recipient email and leaves a rejected invite unconsumed', async () => {
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[id(1)])
  await db.query("INSERT INTO project_invites VALUES($1,$2,'alice@example.invalid','pending',now()+interval '1 day',NULL)", [id(22),id(10)])
  await harden()
  await expect(as('authenticated',id(1),()=>db.query('SELECT * FROM get_pending_invites_for_email($1)',['alice@example.invalid']))).rejects.toThrow()
  await expect(as('authenticated',id(1),()=>db.query('SELECT accept_invite($1)',[id(22)]))).rejects.toThrow()
  expect((await db.query('SELECT status,accepted_by FROM project_invites WHERE token=$1',[id(22)])).rows).toEqual([{status:'pending',accepted_by:null}])
  expect((await db.query('SELECT user_id FROM project_members WHERE project_id=$1 AND user_id=$2',[id(10),id(1)])).rows).toHaveLength(0)
  await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[id(1)])
  expect((await as('authenticated',id(1),()=>db.query('SELECT * FROM get_pending_invites_for_email($1)',['alice@example.invalid']))).rows).toHaveLength(1)
  await as('authenticated',id(1),()=>db.query('SELECT accept_invite($1)',[id(22)]))
  expect((await db.query('SELECT accepted_by FROM project_invites WHERE token=$1',[id(22)])).rows[0].accepted_by).toBe(id(1))
},15000)

it('does not disclose unrelated profile ids and revokes profile access with membership removal', async () => {
  await harden()
  const profiles = () => as('authenticated',id(1),()=>db.query('SELECT * FROM get_user_profiles($1)',[[id(1),id(2),id(999)]]))
  expect((await profiles()).rows.map((row) => row.id)).toEqual([id(1)])
  await db.query("INSERT INTO project_members(project_id,user_id,role,joined_at) VALUES($1,$2,'member',now())",[id(10),id(1)])
  expect((await profiles()).rows.map((row) => row.id).sort()).toEqual([id(1),id(2)])
  await db.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[id(10),id(1)])
  expect((await profiles()).rows.map((row) => row.id)).toEqual([id(1)])
},15000)

it('does not let ordinary members promote themselves through display-settings updates', async () => {
  // Exact deployed helper/policy logic from the read-only catalog snapshot.
  await db.exec(`CREATE FUNCTION public.is_project_member(p_project_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM project_members WHERE project_id=p_project_id AND user_id=auth.uid())
    $$;
    DROP POLICY own_membership ON project_members;
    CREATE POLICY "Members can view project members" ON project_members FOR SELECT
      USING(is_project_member(project_id));
    CREATE POLICY "Members can update display settings" ON project_members FOR UPDATE
      USING(is_project_member(project_id)) WITH CHECK(is_project_member(project_id));`)
  await db.query("INSERT INTO project_members(project_id,user_id,role,joined_at) VALUES($1,$2,'member',now())",[id(10),id(1)])
  await harden()
  try {
    await as('authenticated',id(1),()=>db.query("UPDATE project_members SET role='owner' WHERE project_id=$1 AND user_id=$2",[id(10),id(1)]))
  } catch { /* A permission/RLS/trigger rejection is an acceptable denial. */ }
  expect((await db.query('SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2',[id(10),id(1)])).rows[0].role).toBe('member')
  await as('authenticated',id(1),()=>db.query('UPDATE project_members SET display_color=$1,display_initials=$2 WHERE project_id=$3 AND user_id=$4', ['#123456','AC',id(10),id(1)]))
  expect((await db.query('SELECT display_color,display_initials FROM project_members WHERE project_id=$1 AND user_id=$2',[id(10),id(1)])).rows).toEqual([{display_color:'#123456',display_initials:'AC'}])
  for (const column of ['role','project_id','user_id']) {
    const value = column==='role' ? 'owner' : id(99)
    await expect(as('authenticated',id(1),()=>db.query(`UPDATE project_members SET ${column}=$1 WHERE project_id=$2 AND user_id=$3`,[value,id(10),id(1)]))).rejects.toThrow()
  }
  await as('authenticated',id(1),()=>db.query('UPDATE project_members SET display_initials=$1 WHERE project_id=$2 AND user_id=$3',['FORGED',id(10),id(2)]))
  expect((await db.query('SELECT display_initials FROM project_members WHERE project_id=$1 AND user_id=$2',[id(10),id(2)])).rows[0].display_initials).toBe(null)
},15000)

it('rejects an ordinary member inserting an owner identity into another project', async () => {
  // Exact deployed insert policy and owner helper, with a private second project.
  await db.exec(`CREATE FUNCTION public.is_project_owner(p_project_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM project_members WHERE project_id=p_project_id AND user_id=auth.uid() AND role='owner')
    $$;
    CREATE POLICY "Owner can add members" ON project_members FOR INSERT
      WITH CHECK(is_project_owner(project_id));`)
  await db.query("INSERT INTO projects(id,owner_id,name) VALUES($1,$2,'Other private')",[id(11),id(2)])
  await db.query("INSERT INTO project_members(project_id,user_id,role,joined_at) VALUES($1,$3,'member',now()),($2,$4,'owner',now())",[id(10),id(11),id(1),id(2)])
  await harden()
  await expect(as('authenticated',id(1),()=>db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'owner')",[id(11),id(1)]))).rejects.toThrow(/row-level security/)
  expect((await db.query('SELECT user_id FROM project_members WHERE project_id=$1 AND user_id=$2',[id(11),id(1)])).rows).toHaveLength(0)
  // The true owner can still add a normal member.
  await as('authenticated',id(2),()=>db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'member')",[id(11),id(1)]))
  expect((await db.query('SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2',[id(11),id(1)])).rows[0].role).toBe('member')
},15000)

it('grants clean-reset API-key management without granting another user access', async () => {
  await db.exec(`CREATE TABLE api_keys(id uuid PRIMARY KEY,user_id uuid NOT NULL,key_hash text NOT NULL,name text);
    ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can manage own keys" ON api_keys FOR ALL
      USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());`)
  const createKey = () => db.query('INSERT INTO api_keys VALUES($1,$2,$3,$4)',[id(50),id(1),'a'.repeat(64),'Synthetic'])
  await expect(as('authenticated',id(1),createKey)).rejects.toThrow(/permission denied/)
  await harden()
  await as('authenticated',id(1),createKey)
  expect((await as('authenticated',id(1),()=>db.query('SELECT id FROM api_keys'))).rows).toEqual([{id:id(50)}])
  expect((await as('authenticated',id(2),()=>db.query('SELECT id FROM api_keys'))).rows).toHaveLength(0)
  await as('authenticated',id(2),()=>db.query('DELETE FROM api_keys WHERE id=$1',[id(50)]))
  expect((await db.query('SELECT id FROM api_keys')).rows).toHaveLength(1)
  await as('authenticated',id(1),()=>db.query('DELETE FROM api_keys WHERE id=$1',[id(50)]))
  expect((await db.query('SELECT id FROM api_keys')).rows).toHaveLength(0)
},15000)

it('preserves intentionally public release-note reads without client write privileges', async () => {
  // Existing production policy intent, on a table with no implicit grants.
  await db.exec(`CREATE TABLE release_notes(version text PRIMARY KEY,content text);
    ALTER TABLE release_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Release notes readable by anon" ON release_notes FOR SELECT TO anon USING(true);
    CREATE POLICY "Release notes are readable by authenticated users" ON release_notes FOR SELECT TO authenticated USING(true);
    CREATE POLICY "Release notes writable by service_role only" ON release_notes FOR ALL TO service_role USING(true) WITH CHECK(true);
    INSERT INTO release_notes VALUES('synthetic-v1','Public announcement');`)
  await expect(as('anon',null,()=>db.query('SELECT version FROM release_notes'))).rejects.toThrow(/permission denied/)
  await harden()
  expect((await as('anon',null,()=>db.query('SELECT version FROM release_notes'))).rows).toEqual([{version:'synthetic-v1'}])
  expect((await as('authenticated',id(1),()=>db.query('SELECT version FROM release_notes'))).rows).toHaveLength(1)
  await expect(as('authenticated',id(1),()=>db.query("UPDATE release_notes SET content='Forged'"))).rejects.toThrow()
  await expect(as('anon',null,()=>db.query("INSERT INTO release_notes VALUES('forged','Forged')"))).rejects.toThrow()
  await as('service_role',null,()=>db.query("INSERT INTO release_notes VALUES('synthetic-v2','Trusted announcement')"))
  expect((await db.query('SELECT version FROM release_notes ORDER BY version')).rows).toHaveLength(2)
},15000)

it('authorizes live invite reads only for owners and the confirmed stored recipient',async()=>{
  await harden()
  const visible=()=>as('authenticated',id(1),()=>db.query('SELECT token FROM project_invites ORDER BY token'))
  expect((await visible()).rows).toEqual([])
  await db.query("INSERT INTO project_invites VALUES($1,$2,' ALICE@example.invalid ','pending',now()+interval '1 day',NULL)",[id(23),id(10)])
  expect((await visible()).rows).toEqual([{token:id(23)}])
  await db.query("INSERT INTO project_invites VALUES($1,$2,NULL,'pending',now()+interval '1 day',NULL),($3,$2,'alice@example.invalid','pending',now()-interval '1 day',NULL),($4,$2,'alice@example.invalid','accepted',now()+interval '1 day',$5)",[id(24),id(10),id(25),id(26),id(1)])
  expect((await visible()).rows).toEqual([{token:id(23)}])
  expect((await as('authenticated',id(2),()=>db.query('SELECT token FROM project_invites'))).rows).toHaveLength(5)
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[id(1)])
  await db.query("SELECT set_config('request.jwt.claim.email','alice@example.invalid',false)")
  expect((await visible()).rows).toEqual([])
  await db.query("UPDATE auth.users SET email='changed@example.invalid',email_confirmed_at=now() WHERE id=$1",[id(1)])
  expect((await visible()).rows).toEqual([])
  expect((await as('anon',null,()=>db.query('SELECT token FROM project_invites'))).rows).toEqual([])
},15000)
