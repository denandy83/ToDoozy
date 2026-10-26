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
    CREATE TABLE projects(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,is_archived integer DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE statuses(id uuid PRIMARY KEY,project_id uuid,name text,color text,icon text,order_index integer,is_done integer,is_default integer,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,status_id uuid REFERENCES statuses(id),completed_date text,updated_at timestamptz DEFAULT '2000-01-01',deleted_at timestamptz,owner_id uuid,assigned_to uuid,title text DEFAULT 'Occupied',description text,priority integer,due_date text,parent_id uuid,order_index float,is_in_my_day integer,is_template integer,is_archived integer DEFAULT 0,recurrence_rule text,reference_url text,my_day_dismissed_date text,created_at timestamptz);`)
  for (const file of ['20261026075322_atomic_status_management.sql','20261026094537_task_status_assignment_guard.sql','20261026105740_disable_legacy_status_consistency_guard.sql','20261026102717_project_archive_version.sql']) {
    await remote.exec(readFileSync(new URL(`../../../../supabase/migrations/${file}`,import.meta.url),'utf8'))
  }
  await remote.query('INSERT INTO projects(id,owner_id,deleted_at) VALUES($1,$2,NULL)',[project,owner])
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
    let columns='*', values: Array<Record<string,unknown>> | null=null
    const filters: Array<[string,unknown,string]>=[]
    const execute=async () => {
      await pinned.token!()
      const quote=(name:string):string => { if(!/^[a-z_]+$/.test(name)) throw new Error('Invalid fixture identifier'); return `"${name}"` }
      try {
        if(values) {
          for(const row of values) {
            const keys=Object.keys(row), params=Object.values(row)
            await remote.query(`INSERT INTO ${quote(table)}(${keys.map(quote).join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter((key)=>key!=='id').map((key)=>`${quote(key)}=excluded.${quote(key)}`).join(',')}`,params)
          }
          return {data:[],error:null}
        }
        const params:unknown[]=[]
        const bind=(value:unknown):string => { params.push(value); return '$'+params.length }
        const where=filters.map(([key,value,op])=>op==='IS'?`${quote(key)} IS NULL`:op==='ANY'?`${quote(key)}=ANY(${bind(value)})`:`${quote(key)}=${bind(value)}`).join(' AND ')
        return {data:(await remote.query(`SELECT ${columns} FROM ${quote(table)}${where?' WHERE '+where:''}`,params)).rows,error:null}
      } catch(error) { return {data:null,error:{message:String(error)}} }
    }
    const chain={
      select(value='*') {columns=value;return chain}, eq(key:string,value:unknown) {filters.push([key,value,'=']);return chain},
      is(key:string,value:unknown) {filters.push([key,value,'IS']);return chain}, in(key:string,value:unknown) {filters.push([key,value,'ANY']);return chain},
      order() {return chain},limit() {return chain},
      upsert(value:Array<Record<string,unknown>>) {values=value;return chain},
      async maybeSingle() {const result=await execute();return {...result,data:result.data?.[0]??null}},
      then(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown) {return execute().then(resolve,reject)}
    }; return chain
  }, async rpc(_name:string,args:Record<string,unknown>) {
    await pinned.token!(); rpcCalls++
    if(fail) return { data:null,error:{ message:'synthetic failure',code:'503' } }
    try { return { data:(await remote.query<{value: unknown}>('SELECT manage_project_status($1,$2,$3,$4) AS value',[args.p_project_id,args.p_actor,args.p_action,args.p_input])).rows[0].value,error:null } }
    catch(error) { return { data:null,error:{ message:String(error) } } }
  } } as unknown as SupabaseClient
})
afterEach(async () => { vi.useRealTimers(); local.close(); await remote.close(); vi.unstubAllGlobals() })
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

it.each(['queued','eager','newer-cloud','denied','same-tick'])('preserves post-deletion full task intent through %s delivery',async (mode) => {
  const t1='2020-01-01T01:00:00.000Z',t10='2020-01-01T10:00:00.000Z',t11='2020-01-01T11:00:00.000Z'
  local.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(t1,task)
  local.prepare('UPDATE statuses SET updated_at=? WHERE id=?').run(t1,source)
  await remote.query('UPDATE tasks SET updated_at=$1',[t1])
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(t10)
  await useStatusStore.getState().reassignAndDelete(source,done)
  vi.setSystemTime(mode==='same-tick'?t10:t11)
  const row=repos.tasks.update(task,{title:'Pending title',description:'Pending description',due_date:'2020-02-01',priority:3})!
  repos.syncQueue.enqueue('tasks',task,'UPDATE',JSON.stringify(row))
  if(mode==='newer-cloud') await remote.query("UPDATE tasks SET title='Cloud newer',description='Cloud description',updated_at='2020-01-01T20:00Z'")
  if(mode==='denied') await remote.query('UPDATE projects SET owner_id=$1',[id(99)])
  vi.setSystemTime('2020-01-02T06:00:00.000Z')
  setOnlineStatus(true)
  if(mode==='eager') {
    const {deleteStatusFromSupabase}=await import('./PersonalSyncService')
    await deleteStatusFromSupabase(source)
  } else await processSyncQueue()
  const actual=(await remote.query('SELECT title,description,due_date,priority,status_id FROM tasks')).rows[0]
  if(mode==='denied') {
    expect(actual).toMatchObject({title:'Occupied',status_id:source})
    expect(repos.syncQueue.count()).toBe(2)
    expect(rpcCalls).toBe(0)
  } else if(mode==='newer-cloud') {
    expect(actual).toMatchObject({title:'Cloud newer',description:'Cloud description',status_id:done})
    expect(repos.syncQueue.count()).toBe(0)
  } else {
    expect(actual).toMatchObject({title:'Pending title',description:'Pending description',due_date:'2020-02-01',priority:3,status_id:done})
    expect(repos.syncQueue.count()).toBe(0)
  }
},15000)
