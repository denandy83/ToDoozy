import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useStatusStore } from '../shared/stores/statusStore'
import { useAuthStore } from '../shared/stores/authStore'
import { requireSession } from './sessionRecovery'
import { setOnlineStatus, processSyncQueue } from './SyncService'

const pinned = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url,_key,options) => { pinned.token=options.accessToken; return pinned.client }) }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const owner=id(1), project=id(2), open=id(3), source=id(4), done=id(5), task=id(6)
let local: DatabaseSync, remote: PGlite, repos: ReturnType<typeof createRepositories>, fail: boolean, rpcCalls: number
beforeEach(async () => {
  local = new DatabaseSync(':memory:'); local.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(local)
  repos=createRepositories(local)
  repos.users.create({ id: owner, email: 'owner@example.invalid', display_name: null, avatar_url: null })
  repos.projects.create({ id: project, owner_id: owner, name: 'Shared' })
  repos.statuses.create({ id: open, project_id: project, name: 'Open', is_default: 1 })
  repos.statuses.create({ id: source, project_id: project, name: 'Custom' })
  repos.statuses.create({ id: done, project_id: project, name: 'Done', is_done: 1 })
  repos.tasks.create({ id: task, project_id: project, owner_id: owner, status_id: source, title: 'Occupied' })
  remote=new PGlite()
  await remote.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
    CREATE TABLE projects(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
    CREATE TABLE statuses(id uuid PRIMARY KEY,project_id uuid,name text,color text,icon text,order_index integer,is_done integer,is_default integer,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,status_id uuid REFERENCES statuses(id),completed_date text,updated_at timestamptz,deleted_at timestamptz);`)
  for (const file of ['20261026075322_atomic_status_management.sql','20261026094537_task_status_assignment_guard.sql','20261026105740_disable_legacy_status_consistency_guard.sql']) {
    await remote.exec(readFileSync(new URL(`../../../../supabase/migrations/${file}`,import.meta.url),'utf8'))
  }
  await remote.query('INSERT INTO projects VALUES($1,$2,NULL)',[project,owner])
  for (const status of repos.statuses.findByProjectId(project)) await remote.query('INSERT INTO statuses(id,project_id,name,is_done,is_default) VALUES($1,$2,$3,$4,$5)',[status.id,project,status.name,status.is_done,status.is_default])
  await remote.query('INSERT INTO tasks(id,project_id,status_id) VALUES($1,$2,$3)',[task,project,source])
  fail=false; rpcCalls=0; setOnlineStatus(false)
  useAuthStore.setState({ currentUser: { id: owner } as never })
  useStatusStore.setState({ statuses: Object.fromEntries(repos.statuses.findByProjectId(project).map((row) => [row.id,row])), error: null })
  vi.mocked(requireSession).mockResolvedValue({ user: { id: owner }, access_token: 'synthetic-owner' } as Session)
  vi.stubGlobal('window',{ api: { auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid',anonKey:'synthetic' }) }, sync: {
    captureContext: async () => ({ userId:owner,generation:1 }), count: async () => repos.syncQueue.count(),
    invokeContext: async (_context:unknown, channel:string,args:unknown[]) => {
      const [ns,method]=channel.split(':'); const target=ns==='sync'?repos.syncQueue:repos[ns as keyof typeof repos]
      return (target as unknown as Record<string,(...args:unknown[])=>unknown>)[ns==='sync'&&method==='getQueue'?'findAll':method](...args)
    }
  } } })
  pinned.client={ from(table:string) {
    let rowId=''
    const chain={ select() { return chain }, eq(_key:string,value:string) { rowId=value; return chain },
      async maybeSingle() { await pinned.token!(); return { data:(await remote.query(`SELECT id,deleted_at FROM ${table} WHERE id=$1`,[rowId])).rows[0]??null,error:null } }
    }; return chain
  }, async rpc(_name:string,args:Record<string,unknown>) {
    await pinned.token!(); rpcCalls++
    if(fail) return { data:null,error:{ message:'synthetic failure',code:'503' } }
    try { return { data:(await remote.query<{value: unknown}>('SELECT manage_project_status($1,$2,$3,$4) AS value',[args.p_project_id,args.p_actor,args.p_action,args.p_input])).rows[0].value,error:null } }
    catch(error) { return { data:null,error:{ message:String(error) } } }
  } } as unknown as SupabaseClient
})
afterEach(async () => { local.close(); await remote.close(); vi.unstubAllGlobals() })
it.each(['default','chosen'])('delivers the actual desktop %s replacement atomically after offline failure/retry',async (mode) => {
  const target=mode==='chosen'?done:open
  if(mode==='chosen') expect(await useStatusStore.getState().reassignAndDelete(source,target)).toBe(true)
  else expect(await useStatusStore.getState().deleteStatus(source)).toBe(true)
  expect(JSON.parse(repos.syncQueue.findAll()[0].payload)).toMatchObject({ status_delete:true,target_id:target })
  expect(repos.tasks.findById(task)?.status_id).toBe(target)
  expect((await remote.query<{status_id:string}>('SELECT status_id FROM tasks')).rows[0].status_id).toBe(source)
  setOnlineStatus(true); fail=true
  expect(await processSyncQueue()).toBe(0)
  expect(repos.syncQueue.count()).toBe(1)
  fail=false
  expect(await processSyncQueue()).toBe(1)
  expect(repos.syncQueue.count()).toBe(0)
  const row=(await remote.query<{status_id:string;completed_date:string|null}>('SELECT status_id,completed_date FROM tasks')).rows[0]
  expect(row.status_id).toBe(target)
  if(target===done) expect(new Date(row.completed_date!).toISOString()).toBe(row.completed_date)
  else expect(row.completed_date).toBeNull()
  expect((await remote.query<{deleted_at:unknown}>('SELECT deleted_at FROM statuses WHERE id=$1',[source])).rows[0].deleted_at).not.toBeNull()
  expect(rpcCalls).toBe(2)
},15000)
it('keeps default/done statuses and validates replacement before any local mutation',async () => {
  expect(() => repos.statuses.reassignAndDelete(open,done)).toThrow(/retained/)
  expect(() => repos.statuses.reassignAndDelete(source,source)).toThrow(/Replacement/)
  expect(repos.syncQueue.count()).toBe(0)
  expect(repos.tasks.findById(task)?.status_id).toBe(source)
})
