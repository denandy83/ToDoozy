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
import { useTaskStore } from '../shared/stores/taskStore'
import type { TodoozyAPI } from '../../../preload/index.d'
import { captureSyncContext } from './syncContext'
import { SYNC_TABLES } from './syncTables'
import { logEvent } from '../shared/stores/logStore'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), database: null as unknown as DatabaseSync }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn) }, safeStorage: {}, BrowserWindow: {}, dialog: {}, shell: {}, app: {} }))
vi.mock('keytar', () => ({ default: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../../main/database', () => ({ getDatabase: () => ipc.database, switchDatabase: vi.fn(), getDatabasePath: vi.fn() }))
vi.mock('../../../main/quick-add', () => ({ hideQuickAddWindow: vi.fn() }))
vi.mock('../../../main/index', () => ({ registerQuickAddShortcut: vi.fn(), registerAppToggleShortcut: vi.fn(), getMainWindow: vi.fn() }))
vi.mock('../../../main/tray', () => ({ setTrayUserId: vi.fn(), refreshTray: vi.fn(), setTimerState: vi.fn(), clearTimerState: vi.fn() }))
vi.mock('../shared/stores/savedViewStore', () => ({ useSavedViewStore: { getState: () => ({ scheduleRecount: vi.fn() }) } }))
import { registerIpcHandlers } from '../../../main/ipc-handlers'
const invoke = async (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!({}, ...args)
let beforeRpc: (() => Promise<void>) | null, afterRpc: (() => Promise<void>) | null, failTaskWrites: boolean, failRecovery: boolean, failRecoveryResponse: boolean
let beforeLabelWrite: (()=>Promise<void>) | null
let taskUpdates: Array<Record<string,unknown>>

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
    CREATE TABLE projects(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,name text DEFAULT 'Shared',color text,icon text,description text,is_archived integer DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE statuses(id uuid PRIMARY KEY,project_id uuid,name text,color text,icon text,order_index integer,is_done integer,is_default integer,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,status_id uuid REFERENCES statuses(id),completed_date text,updated_at timestamptz DEFAULT '2000-01-01',deleted_at timestamptz,owner_id uuid,assigned_to uuid,title text DEFAULT 'Occupied',description text,priority integer,due_date text,parent_id uuid,order_index float,is_in_my_day integer,is_template integer,is_archived integer DEFAULT 0,recurrence_rule text,reference_url text,my_day_dismissed_date text,created_at timestamptz);
    CREATE TABLE task_labels(task_id uuid,label_id uuid,deleted_at timestamptz,PRIMARY KEY(task_id,label_id));
    CREATE TABLE user_labels(id uuid PRIMARY KEY,user_id uuid,name text,color text,order_index integer,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE project_labels(project_id uuid,label_id uuid,created_at timestamptz,deleted_at timestamptz,PRIMARY KEY(project_id,label_id));
    CREATE TABLE activity_log(id uuid,project_id uuid,created_at timestamptz);`)
  for (const file of ['20261026075322_atomic_status_management.sql','20261026094537_task_status_assignment_guard.sql','20261026105740_disable_legacy_status_consistency_guard.sql','20261026102717_project_archive_version.sql']) {
    await remote.exec(readFileSync(new URL(`../../../../supabase/migrations/${file}`,import.meta.url),'utf8'))
  }
  await remote.query('INSERT INTO projects(id,owner_id,deleted_at) VALUES($1,$2,NULL)',[project,owner])
  for (const status of repos.statuses.findByProjectId(project)) {
    const keys=Object.keys(status)
    await remote.query(`INSERT INTO statuses(${keys.join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')})`,Object.values(status))
  }
  await remote.query('INSERT INTO tasks(id,project_id,status_id) VALUES($1,$2,$3)',[task,project,source])
  fail=false; rpcCalls=0; beforeRpc=null; afterRpc=null; failTaskWrites=false; failRecovery=false; failRecoveryResponse=false; beforeLabelWrite=null; taskUpdates=[]; setOnlineStatus(false)
  useAuthStore.setState({ currentUser: { id: owner } as never })
  useStatusStore.setState({ statuses: Object.fromEntries(repos.statuses.findByProjectId(project).map((row) => [row.id,row])), error: null })
  vi.mocked(requireSession).mockResolvedValue({ user: { id: owner }, access_token: 'synthetic-owner' } as Session)
  ipc.database=local; ipc.handlers.clear(); registerIpcHandlers()
  await invoke('auth:switchDatabase',owner)
  ipc.handlers.set('auth:getSupabaseConfig',async () => ({url:'https://example.invalid',anonKey:'synthetic'}))
  const api=new Proxy({}, {get: (_,namespace:string) => new Proxy({}, {get: (_,method:string) => (...args:unknown[]) => invoke(`${namespace}:${method}`,...args)})})
  vi.stubGlobal('window',{api:api as TodoozyAPI})
  useTaskStore.setState({tasks:{[task]:repos.tasks.findById(task)!},taskLabels:{},showDetailPanel:false})
  pinned.client={ from(table:string) {
    let columns='*', values: Array<Record<string,unknown>> | null=null, patch: Record<string,unknown> | null=null
    const filters: Array<[string,unknown,string]>=[]
    const execute=async () => {
      await pinned.token!()
      const quote=(name:string):string => { if(!/^[a-z_]+$/.test(name)) throw new Error('Invalid fixture identifier'); return `"${name}"` }
      try {
        if(table==='tasks' && (values || patch) && (failTaskWrites || (failRecovery && patch))) throw new Error('synthetic task transport failure')
        if(values) {
          if(table==='user_labels' && beforeLabelWrite) {const hook=beforeLabelWrite;beforeLabelWrite=null;await hook()}
          for(const row of values) {
            const keys=Object.keys(row), params=Object.values(row)
            const conflicts=table==='project_labels'?['project_id','label_id']:table==='task_labels'?['task_id','label_id']:['id']
            await remote.query(`INSERT INTO ${quote(table)}(${keys.map(quote).join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')}) ON CONFLICT(${conflicts.map(quote).join(',')}) DO UPDATE SET ${keys.filter((key)=>!conflicts.includes(key)).map((key)=>`${quote(key)}=excluded.${quote(key)}`).join(',')}`,params)
          }
          return {data:[],error:null}
        }
        const params:unknown[]=patch?Object.values(patch):[]
        const bind=(value:unknown):string => { params.push(value); return '$'+params.length }
        const where=filters.map(([key,value,op])=>op==='IS'?`${quote(key)} IS NULL`:op==='ANY'?`${quote(key)}=ANY(${bind(value)})`:`${quote(key)}=${bind(value)}`).join(' AND ')
        if(patch) {
          const result=await remote.query(`UPDATE ${quote(table)} SET ${Object.keys(patch).map((key,index)=>`${quote(key)}=$${index+1}`).join(',')} WHERE ${where} RETURNING id`,params)
          if(failRecoveryResponse) {failRecoveryResponse=false;throw new Error('synthetic lost recovery response')}
          return {data:JSON.parse(JSON.stringify(result.rows)),error:null}
        }
        return {data:JSON.parse(JSON.stringify((await remote.query(`SELECT ${columns} FROM ${quote(table)}${where?' WHERE '+where:''}`,params)).rows)),error:null}
      } catch(error) { return {data:null,error:{message:String(error)}} }
    }
    const chain={
      select(value='*') {columns=value;return chain}, eq(key:string,value:unknown) {filters.push([key,value,'=']);return chain},
      is(key:string,value:unknown) {filters.push([key,value,'IS']);return chain}, in(key:string,value:unknown) {filters.push([key,value,'ANY']);return chain},
      order() {return chain},limit() {return chain},or() {return chain},
      update(value:Record<string,unknown>) {patch=value;if(table==='tasks') taskUpdates.push(value);return chain},
      upsert(value:Array<Record<string,unknown>> | Record<string,unknown>) {values=Array.isArray(value)?value:[value];return chain},
      async maybeSingle() {const result=await execute();return {...result,data:result.data?.[0]??null}},
      then(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown) {return execute().then(resolve,reject)}
    }; return chain
  }, async rpc(_name:string,args:Record<string,unknown>) {
    await pinned.token!(); rpcCalls++
    if(fail) return { data:null,error:{ message:'synthetic failure',code:'503' } }
    try {
      const before=beforeRpc;beforeRpc=null;await before?.()
      if(before) await new Promise((resolve)=>setTimeout(resolve,25))
      const result=await remote.query<{value: unknown}>('SELECT manage_project_status($1,$2,$3,$4) AS value',[args.p_project_id,args.p_actor,args.p_action,args.p_input])
      const after=afterRpc;afterRpc=null;await after?.()
      return { data:result.rows[0].value,error:null }
    }
    catch(error) { return { data:null,error:{ message:String(error) } } }
  } } as unknown as SupabaseClient
})
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); local.close(); await remote.close(); vi.unstubAllGlobals() })
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


async function prepareStoreRace(): Promise<void> {
  local.prepare('UPDATE projects SET is_shared=1 WHERE id=?').run(project)
  const row={...repos.tasks.findById(task)!,updated_at:'2020-01-01T01:00:00.000Z',created_at:'2020-01-01T00:00:00.000Z'}
  const keys=Object.keys(row)
  await remote.query(`UPDATE tasks SET ${keys.map((key,index)=>`"${key}"=$${index+1}`).join(',')} WHERE id=$${keys.length+1}`,[...Object.values(row),task])
  local.prepare('UPDATE tasks SET updated_at=?,created_at=? WHERE id=?').run(row.updated_at,row.created_at,task)
  local.prepare('UPDATE statuses SET updated_at=? WHERE id=?').run(row.updated_at,source)
  useTaskStore.setState({tasks:{[task]:repos.tasks.findById(task)!}})
}
async function mutateThroughStore(action:string): Promise<void> {
  const count=repos.syncQueue.count()
  if(action==='delete') expect(await useTaskStore.getState().deleteTask(task)).toBe(true)
  else await useTaskStore.getState().updateTask(task,{title:'During RPC',description:'Full pending description',due_date:'2030-02-01',priority:3})
  await vi.waitFor(()=>expect(repos.syncQueue.count()).toBeGreaterThan(count))
}
async function assertPulledIntent(action:string): Promise<void> {
  const {pullNewTasks}=await import('./PersonalSyncService')
  await pullNewTasks(project,await captureSyncContext())
  await useTaskStore.getState().hydrateAllForUser(owner)
  const row=repos.tasks.findById(task)!
  if(action==='delete') {
    expect(row.deleted_at).toBeTruthy()
    expect(useTaskStore.getState().tasks[task]).toBeUndefined()
  } else {
    expect(row).toMatchObject({title:'During RPC',description:'Full pending description',due_date:'2030-02-01',priority:3,status_id:done})
    expect(useTaskStore.getState().tasks[task]?.title).toBe('During RPC')
  }
}
it('preserves same-instant taskStore deletion through registered IPC, replay and pull',async()=>{
  await prepareStoreRace()
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2020-01-01T10:00:00.000Z')
  await useStatusStore.getState().reassignAndDelete(source,done)
  const stamp=repos.tasks.findById(task)!.updated_at
  await mutateThroughStore('delete')
  expect(Date.parse(repos.tasks.findById(task)!.updated_at)).toBeGreaterThan(Date.parse(stamp))
  setOnlineStatus(true)
  await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  await assertPulledIntent('delete')
},15000)
it.each(['before','after','import-during','recovery-failure','recovery-response','newer-cloud'].flatMap((stage)=>['edit','delete'].map((action)=>({stage,action}))))('preserves actual taskStore $action across $stage RPC delivery',async({stage,action})=>{
  await prepareStoreRace()
  await useStatusStore.getState().reassignAndDelete(source,done)
  const mutate=async()=>{
    failTaskWrites=true
    await mutateThroughStore(action)
    failTaskWrites=false
    if(stage==='newer-cloud') await remote.query("UPDATE tasks SET title='Genuinely newer cloud',updated_at=$1",[new Date(Date.parse(repos.tasks.findById(task)!.updated_at)+1).toISOString()])
    if(stage==='recovery-failure') failRecovery=true
    if(stage==='recovery-response') failRecoveryResponse=true
  }
  if(stage==='after') afterRpc=mutate
  else beforeRpc=mutate
  if(stage==='import-during') afterRpc=async()=>{
    const {pullNewTasks}=await import('./PersonalSyncService')
    await pullNewTasks(project,await captureSyncContext())
    if(action==='delete') expect(repos.tasks.findById(task)?.deleted_at).toBeTruthy()
    else expect(repos.tasks.findById(task)?.title).toBe('During RPC')
    expect(repos.syncQueue.findAll().some((entry)=>entry.table_name==='statuses')).toBe(true)
  }
  setOnlineStatus(true)
  await processSyncQueue()
  if(stage==='recovery-failure' || stage==='recovery-response') {
    expect(repos.syncQueue.findAll().some((entry)=>entry.table_name==='statuses')).toBe(true)
    if(stage==='recovery-failure') expect((await remote.query<{title:string}>('SELECT title FROM tasks')).rows[0].title).toBe('Occupied')
    failRecovery=false
  }
  await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  if(stage==='newer-cloud') expect((await remote.query<{title:string}>('SELECT title FROM tasks')).rows[0].title).toBe('Genuinely newer cloud')
  else await assertPulledIntent(action)
},15000)
it.each(['rpc','prewrite','success'])('routes personal status reconciliation through the durable command (%s)',async(mode)=>{
  await prepareStoreRace()
  local.prepare('UPDATE projects SET is_shared=0 WHERE id=?').run(project)
  await useStatusStore.getState().reassignAndDelete(source,done)
  await remote.query('INSERT INTO tasks(id,project_id,status_id) VALUES($1,$2,$3)',[id(90),project,source])
  if(mode==='prewrite') {
    const row=repos.tasks.update(task,{title:'Before reconnect'})!
    repos.syncQueue.enqueue('tasks',task,'UPDATE',JSON.stringify(row))
    failTaskWrites=true
  }
  fail=mode==='rpc'
  setOnlineStatus(true)
  const descriptor=SYNC_TABLES.statuses!
  const call=descriptor.remoteUpsert(repos.statuses.findById(source)!,await captureSyncContext())
  if(mode==='success') await call
  else await expect(call).rejects.toThrow(/pending/)
  if(mode==='success') {
    expect((await remote.query<{status_id:string}>('SELECT status_id FROM tasks WHERE id=$1',[id(90)])).rows[0].status_id).toBe(done)
    expect(repos.syncQueue.count()).toBe(0)
  } else {
    expect(repos.syncQueue.count()).toBeGreaterThan(0)
    expect((await remote.query<{deleted_at:string|null}>('SELECT deleted_at FROM statuses WHERE id=$1',[source])).rows[0].deleted_at).toBeNull()
    if(mode==='prewrite') expect(rpcCalls).toBe(0)
  }
},15000)

it('public reconnect reconciliation delivers personal and shared cloud-only status reassignment',async()=>{
  await prepareStoreRace()
  local.prepare('UPDATE projects SET is_shared=0 WHERE id=?').run(project)
  for(const [name,descriptor] of Object.entries(SYNC_TABLES)) {
    if(!descriptor || name==='statuses' || name==='tasks') continue
    vi.spyOn(descriptor,'localList').mockResolvedValue([])
    vi.spyOn(descriptor,'remoteList').mockResolvedValue([])
    vi.spyOn(descriptor,'localMaxUpdatedAt').mockResolvedValue(null)
    vi.spyOn(descriptor,'remoteMaxUpdatedAt').mockResolvedValue(null)
  }
  await useStatusStore.getState().reassignAndDelete(source,done)
  await remote.query('INSERT INTO tasks SELECT $1,project_id,status_id,completed_date,updated_at,deleted_at,owner_id,assigned_to,title,description,priority,due_date,parent_id,order_index,is_in_my_day,is_template,is_archived,recurrence_rule,reference_url,my_day_dismissed_date,created_at,archive_updated_at FROM tasks WHERE id=$2',[id(90),task])
  const sharedProject=id(91),sharedOpen=id(92),sharedSource=id(93),sharedDone=id(94),sharedTask=id(95)
  repos.projects.create({id:sharedProject,owner_id:owner,name:'Shared reconnect'})
  repos.projects.update(sharedProject,{is_shared:1})
  await remote.query('INSERT INTO projects(id,owner_id) VALUES($1,$2)',[sharedProject,owner])
  for(const input of [{id:sharedOpen,name:'Open',is_default:1},{id:sharedSource,name:'Custom'},{id:sharedDone,name:'Done',is_done:1}]) {
    const row=repos.statuses.create({...input,project_id:sharedProject})
    const keys=Object.keys(row)
    await remote.query(`INSERT INTO statuses(${keys.join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')})`,Object.values(row))
  }
  await remote.query('INSERT INTO tasks SELECT $1,$2,$3,completed_date,updated_at,deleted_at,owner_id,assigned_to,title,description,priority,due_date,parent_id,order_index,is_in_my_day,is_template,is_archived,recurrence_rule,reference_url,my_day_dismissed_date,created_at,archive_updated_at FROM tasks WHERE id=$4',[sharedTask,sharedProject,sharedSource,task])
  repos.statuses.reassignAndDelete(sharedSource,sharedDone)
  setOnlineStatus(true)
  vi.stubGlobal('navigator',{onLine:true})
  const {reconcile}=await import('./PersonalSyncService')
  vi.mocked(logEvent).mockClear()
  await reconcile(owner)
  expect((await remote.query<{status_id:string}>('SELECT status_id FROM tasks WHERE id=$1',[id(90)])).rows[0].status_id).toBe(done)
  expect((await remote.query<{status_id:string}>('SELECT status_id FROM tasks WHERE id=$1',[sharedTask])).rows[0].status_id).toBe(sharedDone)
  expect(repos.syncQueue.count()).toBe(0)
  expect(vi.mocked(logEvent).mock.calls.filter(([level])=>level==='error')).toEqual([])
},15000)
it('acknowledges deletion of a never-uploaded offline status without recreating it',async()=>{
  await prepareStoreRace()
  await remote.query('DELETE FROM tasks')
  await remote.query('DELETE FROM statuses WHERE id=$1',[source])
  await useStatusStore.getState().reassignAndDelete(source,done)
  setOnlineStatus(true)
  expect(await processSyncQueue()).toBe(1)
  expect(repos.syncQueue.count()).toBe(0)
  expect(rpcCalls).toBe(0)
},15000)

it.each(['unchanged','edit','delete','newer-cloud','failure','denied'])('converges a status deletion completed on another device (%s)',async(mode)=>{
  await prepareStoreRace()
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2020-01-01T10:00:00.000Z')
  await useStatusStore.getState().reassignAndDelete(source,done)
  if(mode!=='unchanged') {
    vi.setSystemTime('2020-01-01T11:00:00.000Z')
    await mutateThroughStore(mode==='delete'?'delete':'edit')
  }
  await remote.query('SELECT manage_project_status($1,$2,$3,$4)',[project,owner,'delete',{id:source,target_id:done}])
  if(mode==='newer-cloud') await remote.query("UPDATE tasks SET title='Other device newer',updated_at=updated_at+interval '1 second'")
  if(mode==='denied') await remote.query('UPDATE projects SET owner_id=$1',[id(99)])
  failRecovery=mode==='failure'
  setOnlineStatus(true)
  await processSyncQueue()
  if(mode==='denied' || mode==='failure') expect(repos.syncQueue.findAll().some((entry)=>entry.table_name==='statuses')).toBe(true)
  if(mode==='denied') return
  failRecovery=false
  await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  expect(rpcCalls).toBe(0)
  if(mode==='newer-cloud') expect((await remote.query<{title:string}>('SELECT title FROM tasks')).rows[0].title).toBe('Other device newer')
  else if(mode!=='unchanged') await assertPulledIntent(mode==='delete'?'delete':'edit')
},15000)

it.each(['refresh','import'])('protects actual task-store project-label re-add throughout preflight and %s',async(mode)=>{
  await prepareStoreRace()
  const labelId=id(70)
  const label=repos.labels.create({id:labelId,user_id:owner,name:'Re-add me'})
  repos.labels.addToProject(project,labelId)
  repos.labels.removeFromProject(project,labelId)
  const removed=repos.labels.getProjectLabelsForSharedProjects().find((row)=>row.label_id===labelId)!
  repos.syncQueue.clear()
  const client=await captureSyncContext()
  await client.client.from('user_labels').upsert(label)
  await client.client.from('project_labels').upsert(removed)
  beforeLabelWrite=async()=>{
    expect(repos.labels.hasPendingProjectAddition(project,labelId)).toBe(true)
    if(mode==='refresh') {
      const {refreshProjectLabels}=await import('./remoteProjectRefresh')
      await refreshProjectLabels(project,await captureSyncContext())
    } else {
      await window.api.labels.applyRemoteProjectLabel(removed)
      await window.api.labels.softDeleteTaskLabelsForProjectLabel(project,labelId)
    }
    expect(repos.labels.findByTaskId(task).map((row)=>row.id)).toEqual([labelId])
  }
  setOnlineStatus(true)
  await useTaskStore.getState().addLabel(task,labelId)
  await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  expect(repos.labels.findByTaskId(task).map((row)=>row.id)).toEqual([labelId])
  expect((await remote.query<{deleted_at:string|null}>('SELECT deleted_at FROM project_labels WHERE label_id=$1',[labelId])).rows[0].deleted_at).toBeNull()
  expect((await remote.query('SELECT * FROM task_labels WHERE label_id=$1',[labelId])).rows).toHaveLength(1)
},15000)

it.each(['single','bulk'])('uses persisted shared %s tombstones across authentication delay',async(mode)=>{
  await prepareStoreRace()
  setOnlineStatus(true)
  let resume!: ()=>void, started!: ()=>void
  const gate=new Promise<void>((resolve)=>{resume=resolve})
  const waiting=new Promise<void>((resolve)=>{started=resolve})
  vi.mocked(requireSession).mockImplementationOnce(async()=>{started();await gate;return {user:{id:owner},access_token:'synthetic-owner'} as Session})
  if(mode==='single') await useTaskStore.getState().deleteTask(task)
  else await useTaskStore.getState().bulkDeleteTasks([task])
  await waiting
  const deleted=repos.tasks.findById(task)!
  const newer=new Date(Date.parse(deleted.updated_at)+1).toISOString()
  await remote.query("UPDATE tasks SET title='Newer member edit',updated_at=$1",[newer])
  await new Promise((resolve)=>setTimeout(resolve,25))
  resume()
  await vi.waitFor(()=>expect(taskUpdates).toContainEqual({deleted_at:deleted.deleted_at,updated_at:deleted.updated_at}))
  await new Promise((resolve)=>setTimeout(resolve,25))
  const actual=(await remote.query<{title:string;deleted_at:string|null}>('SELECT title,deleted_at FROM tasks')).rows[0]
  expect(actual).toMatchObject({title:'Newer member edit',deleted_at:null})
  expect(repos.tasks.findById(task)?.updated_at).toBe(deleted.updated_at)
},15000)
