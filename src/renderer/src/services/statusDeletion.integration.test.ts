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
import { useLabelStore } from '../shared/stores/labelStore'
import type { TodoozyAPI } from '../../../preload/index.d'
import { captureSyncContext } from './syncContext'
import { SYNC_TABLES } from './syncTables'
import { syncTaskLabelChoices } from './taskLabelAdditions'
import { flush as flushTaskBatch } from './TaskBatchSyncManager'
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
let afterLabelSnapshot: (()=>Promise<void>) | null
let beforeProjectWrite: (()=>Promise<void>) | null
let projectBatches: number[]
let failProjectWriteNumber: number | null
let beforeAssignmentWrite: (()=>Promise<void>) | null
let assignmentBatches: number[], paletteReads: number, failDefinitions: boolean
let assignmentSchedule: 'delete-last' | 'add-last' | null, failAssignments: boolean
let assignmentCompletions: string[]

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
    CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid,status_id uuid REFERENCES statuses(id),completed_date text,updated_at timestamptz DEFAULT '2000-01-01',deleted_at timestamptz,owner_id uuid,assigned_to uuid,title text DEFAULT 'Occupied',description text,priority integer,due_date text,parent_id uuid,order_index float,is_in_my_day integer,is_template integer,is_archived integer DEFAULT 0,recurrence_rule text,reference_url text,my_day_dismissed_date text,created_at timestamptz,label_names text);
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
  fail=false; rpcCalls=0; beforeRpc=null; afterRpc=null; failTaskWrites=false; failRecovery=false; failRecoveryResponse=false; beforeLabelWrite=null; taskUpdates=[]; afterLabelSnapshot=null; beforeAssignmentWrite=null; beforeProjectWrite=null;projectBatches=[];failProjectWriteNumber=null; assignmentBatches=[];paletteReads=0;failDefinitions=false;assignmentSchedule=null;failAssignments=false;assignmentCompletions=[]; setOnlineStatus(false)
  useAuthStore.setState({ currentUser: { id: owner } as never })
  useStatusStore.setState({ statuses: Object.fromEntries(repos.statuses.findByProjectId(project).map((row) => [row.id,row])), error: null })
  vi.mocked(requireSession).mockResolvedValue({ user: { id: owner }, access_token: 'synthetic-owner' } as Session)
  ipc.database=local; ipc.handlers.clear(); registerIpcHandlers()
  await invoke('auth:switchDatabase',owner)
  ipc.handlers.set('auth:getSupabaseConfig',async () => ({url:'https://example.invalid',anonKey:'synthetic'}))
  const api=new Proxy({}, {get: (_,namespace:string) => new Proxy({}, {get: (_,method:string) => (...args:unknown[]) => invoke(`${namespace}:${method}`,...args)})})
  vi.stubGlobal('window',{api:api as TodoozyAPI})
  vi.stubGlobal('navigator',{onLine:true})
  useTaskStore.setState({tasks:{[task]:repos.tasks.findById(task)!},taskLabels:{},showDetailPanel:false})
  pinned.client={ from(table:string) {
    let columns='*', values: Array<Record<string,unknown>> | null=null, patch: Record<string,unknown> | null=null, removing=false
    const filters: Array<[string,unknown,string]>=[]
    const execute=async () => {
      await pinned.token!()
      const quote=(name:string):string => { if(!/^[a-z_]+$/.test(name)) throw new Error('Invalid fixture identifier'); return `"${name}"` }
      try {
        if(table==='user_labels' && !values && failDefinitions) throw new Error('synthetic identity read failure')
        if(table==='project_labels' && !values && !patch && !removing) paletteReads++
        if(table==='task_labels' && (values || removing)) {
          if(values) assignmentBatches.push(values.length)
          if(beforeAssignmentWrite) {const hook=beforeAssignmentWrite;beforeAssignmentWrite=null;await hook()}
          if(failAssignments) throw new Error('Synthetic assignment failure')
          if((assignmentSchedule==='delete-last' && removing) || (assignmentSchedule==='add-last' && values)) await new Promise((resolve)=>setTimeout(resolve,40))
        }
        if(table==='tasks' && (values || patch) && (failTaskWrites || (failRecovery && patch))) throw new Error('synthetic task transport failure')
        if(values) {
          if(table==='project_labels') {projectBatches.push(values.length);if(beforeProjectWrite) {const hook=beforeProjectWrite;beforeProjectWrite=null;await hook()}
            if(failProjectWriteNumber===projectBatches.length) throw new Error('Synthetic delayed sibling failure')
          }
          if(table==='user_labels' && beforeLabelWrite) {const hook=beforeLabelWrite;beforeLabelWrite=null;await hook()}
          for(const row of values) {
            const keys=Object.keys(row), params=Object.values(row)
            const conflicts=table==='project_labels'?['project_id','label_id']:table==='task_labels'?['task_id','label_id']:['id']
            await remote.query(`INSERT INTO ${quote(table)}(${keys.map(quote).join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')}) ON CONFLICT(${conflicts.map(quote).join(',')}) DO UPDATE SET ${keys.filter((key)=>!conflicts.includes(key)).map((key)=>`${quote(key)}=excluded.${quote(key)}`).join(',')}`,params)
          }
          if(table==='task_labels') assignmentCompletions.push('add')
          return {data:[],error:null}
        }
        const params:unknown[]=patch?Object.values(patch):[]
        const bind=(value:unknown):string => { params.push(value); return '$'+params.length }
        const where=filters.map(([key,value,op])=>op==='IS'?`${quote(key)} IS NULL`:op==='ANY'?`${quote(key)}=ANY(${bind(value)})`:op==='ILIKE'?`${quote(key)} ILIKE ${bind(value)}`:`${quote(key)}=${bind(value)}`).join(' AND ')
        if(removing) {
          const data=(await remote.query(`DELETE FROM ${quote(table)} WHERE ${where} RETURNING *`,params)).rows
          if(table==='task_labels') assignmentCompletions.push('delete')
          return {data,error:null}
        }
        if(patch) {
          const result=await remote.query(`UPDATE ${quote(table)} SET ${Object.keys(patch).map((key,index)=>`${quote(key)}=$${index+1}`).join(',')} WHERE ${where} RETURNING id`,params)
          if(failRecoveryResponse) {failRecoveryResponse=false;throw new Error('synthetic lost recovery response')}
          return {data:JSON.parse(JSON.stringify(result.rows)),error:null}
        }
        const joined=table==='project_labels' && columns.includes('user_labels!inner(name)')
        const projection=joined ? columns.split(',').map((column)=>column==='user_labels!inner(name)' ? "json_build_object('name',ul.name) AS user_labels" : `${quote(table)}.${quote(column)}`).join(',') : columns
        const from=joined ? `${quote(table)} JOIN user_labels ul ON ul.id=project_labels.label_id` : quote(table)
        const result=JSON.parse(JSON.stringify((await remote.query(`SELECT ${projection} FROM ${from}${where?' WHERE '+where:''}`,params)).rows))
        if(table==='task_labels' && afterLabelSnapshot) {const hook=afterLabelSnapshot;afterLabelSnapshot=null;await hook()}
        return {data:result,error:null}
      } catch(error) { return {data:null,error:{message:String(error)}} }
    }
    const chain={
      ilike(key:string,value:string) {filters.push([key,value,'ILIKE']);return chain},
      select(value='*') {columns=value;return chain}, eq(key:string,value:unknown) {filters.push([key,value,'=']);return chain},
      is(key:string,value:unknown) {filters.push([key,value,'IS']);return chain}, in(key:string,value:unknown) {filters.push([key,value,'ANY']);return chain},
      order() {return chain},limit() {return chain},or() {return chain},
      delete() {removing=true;return chain},
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
  await remote.query('INSERT INTO tasks(id,project_id,status_id,completed_date,updated_at,deleted_at,owner_id,assigned_to,title,description,priority,due_date,parent_id,order_index,is_in_my_day,is_template,is_archived,recurrence_rule,reference_url,my_day_dismissed_date,created_at,archive_updated_at) SELECT $1,project_id,status_id,completed_date,updated_at,deleted_at,owner_id,assigned_to,title,description,priority,due_date,parent_id,order_index,is_in_my_day,is_template,is_archived,recurrence_rule,reference_url,my_day_dismissed_date,created_at,archive_updated_at FROM tasks WHERE id=$2',[id(90),task])
  const sharedProject=id(91),sharedOpen=id(92),sharedSource=id(93),sharedDone=id(94),sharedTask=id(95)
  repos.projects.create({id:sharedProject,owner_id:owner,name:'Shared reconnect'})
  repos.projects.update(sharedProject,{is_shared:1})
  await remote.query('INSERT INTO projects(id,owner_id) VALUES($1,$2)',[sharedProject,owner])
  for(const input of [{id:sharedOpen,name:'Open',is_default:1},{id:sharedSource,name:'Custom'},{id:sharedDone,name:'Done',is_done:1}]) {
    const row=repos.statuses.create({...input,project_id:sharedProject})
    const keys=Object.keys(row)
    await remote.query(`INSERT INTO statuses(${keys.join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')})`,Object.values(row))
  }
  await remote.query('INSERT INTO tasks(id,project_id,status_id,completed_date,updated_at,deleted_at,owner_id,assigned_to,title,description,priority,due_date,parent_id,order_index,is_in_my_day,is_template,is_archived,recurrence_rule,reference_url,my_day_dismissed_date,created_at,archive_updated_at) SELECT $1,$2,$3,completed_date,updated_at,deleted_at,owner_id,assigned_to,title,description,priority,due_date,parent_id,order_index,is_in_my_day,is_template,is_archived,recurrence_rule,reference_url,my_day_dismissed_date,created_at,archive_updated_at FROM tasks WHERE id=$4',[sharedTask,sharedProject,sharedSource,task])
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

it.each(['refresh','import'].flatMap((mode)=>['removed','active-cache'].map((cache)=>({mode,cache}))))('protects actual task-store project-label re-add throughout $mode with $cache',async({mode,cache})=>{
  await prepareStoreRace()
  const labelId=id(70)
  const label=repos.labels.create({id:labelId,user_id:owner,name:'Re-add me'})
  const removed={project_id:project,label_id:labelId,created_at:'2020-01-01T00:00:00.000Z',deleted_at:'2020-01-01T10:00:00.000Z'}
  repos.labels.applyRemoteProjectLabel({...removed,deleted_at:cache==='active-cache'?null:removed.deleted_at})
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

async function seedSettledAssignments(): Promise<string[]> {
  await prepareStoreRace()
  const context=await captureSyncContext()
  const ids=[id(71),id(72)]
  for(const labelId of ids) {
    const label=repos.labels.create({id:labelId,user_id:owner,name:'Assignment '+labelId})
    await context.client.from('user_labels').upsert(label)
    const link={project_id:project,label_id:labelId,created_at:'2020-01-01T00:00:00.000Z',deleted_at:null}
    repos.labels.applyRemoteProjectLabel(link)
    await context.client.from('project_labels').upsert(link)
  }
  repos.tasks.applyRemoteTaskLabels(task,ids)
  await context.client.from('task_labels').upsert(ids.map((label_id)=>({task_id:task,label_id,deleted_at:null})))
  await useTaskStore.getState().hydrateTaskLabels(task)
  return ids
}
it.each(['empty','one','pending-add','pending-remove','ack-during-read','database-switch'])('applies complete assignment snapshots safely (%s)',async(mode)=>{
  const ids=await seedSettledAssignments()
  const context=await captureSyncContext()
  await remote.query('DELETE FROM task_labels'+(mode==='one'?' WHERE label_id=$1':''),mode==='one'?[ids[0]]:[])
  if(mode==='pending-add') repos.tasks.addLabel(task,ids[0])
  if(mode==='pending-remove') {repos.tasks.removeLabel(task,ids[0]);await context.client.from('task_labels').upsert({task_id:task,label_id:ids[0],deleted_at:null})}
  if(mode==='ack-during-read') afterLabelSnapshot=async()=>{repos.tasks.addLabel(task,ids[0]);await syncTaskLabelChoices(context.client,[task],context.api,context.scope)}
  if(mode==='database-switch') afterLabelSnapshot=async()=>{await invoke('auth:switchDatabase',owner)}
  const {pullTaskLabelsForTasks}=await import('./PersonalSyncService')
  await pullTaskLabelsForTasks([task],owner,context)
  const actual=repos.tasks.getLabels(task).map((row)=>row.label_id)
  expect(actual).toEqual(mode==='database-switch'?ids:mode==='one'?[ids[1]]:mode==='pending-add'||mode==='ack-during-read'?[ids[0]]:[])
  expect(repos.labels.findByProjectId(project).map((row)=>row.id).sort()).toEqual(ids)
},15000)
it.each([0,1].flatMap((shared)=>['offline','buffered'].map((delivery)=>({shared,delivery}))))('delivers actual $delivery task-only removal (shared=$shared)',async({shared,delivery})=>{
  const ids=await seedSettledAssignments()
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  setOnlineStatus(delivery==='buffered')
  if(delivery==='offline') vi.mocked(requireSession).mockResolvedValue(null)
  if(delivery==='buffered') useTaskStore.setState({lastSelectedTaskId:task,showDetailPanel:true})
  await useTaskStore.getState().removeLabel(task,ids[0])
  const {pullTaskLabelsForTasks}=await import('./PersonalSyncService')
  vi.mocked(requireSession).mockResolvedValue({user:{id:owner},access_token:'synthetic-owner'} as Session)
  await pullTaskLabelsForTasks([task],owner,await captureSyncContext())
  expect(repos.tasks.getLabels(task).map((row)=>row.label_id)).toEqual([ids[1]])
  setOnlineStatus(true)
  if(delivery==='buffered') await flushTaskBatch(task)
  await processSyncQueue();await processSyncQueue()
  expect((await remote.query<{label_id:string}>('SELECT label_id FROM task_labels ORDER BY label_id')).rows.map((row)=>row.label_id)).toEqual([ids[1]])
  expect(repos.syncQueue.count()).toBe(0)
  expect(repos.labels.findByProjectId(project)).toHaveLength(2)
},15000)
it.each([0,1])('metadata edits do not recreate unseen assignment removals (shared=%s)',async(shared)=>{
  const ids=await seedSettledAssignments()
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  await remote.query('DELETE FROM task_labels WHERE label_id=$1',[ids[0]])
  setOnlineStatus(true)
  useTaskStore.setState({lastSelectedTaskId:task,showDetailPanel:true})
  await useTaskStore.getState().updateTask(task,{title:'Metadata only'})
  await flushTaskBatch(task)
  await processSyncQueue()
  expect((await remote.query<{label_id:string}>('SELECT label_id FROM task_labels')).rows.map((row)=>row.label_id)).toEqual([ids[1]])
},15000)

it.each([0,1].flatMap((shared)=>['add','remove'].flatMap((first)=>['held','sequential'].map((timing)=>({shared,first,timing})))) )('orders actual $first writes against opposite choices ($timing, shared=$shared)',async({shared,first,timing})=>{
  const labels=await seedSettledAssignments(), labelId=labels[0]
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  const {pullTaskLabelsForTasks,pullNewTasks}=await import('./PersonalSyncService')
  setOnlineStatus(true)
  let release!: ()=>void,started!: ()=>void
  const gate=new Promise<void>((resolve)=>{release=resolve}),entered=new Promise<void>((resolve)=>{started=resolve})
  if(timing==='held') beforeAssignmentWrite=async()=>{started();await gate}
  const older=first==='add'?useTaskStore.getState().addLabel(task,labelId):useTaskStore.getState().removeLabel(task,labelId)
  try {
    if(timing==='held') await entered
    else {await older;await processSyncQueue()}
    const newer=first==='add'?useTaskStore.getState().removeLabel(task,labelId):useTaskStore.getState().addLabel(task,labelId)
    if(timing==='held') {
      await vi.waitFor(()=>{
        const state=repos.tasks.getLabelState(task).find((row)=>row.label_id===labelId)!
        expect(state.sync_pending).toBe(1)
        expect(!!state.deleted_at).toBe(first==='add')
      })
      release()
    }
    await older;await newer
    await processSyncQueue();await processSyncQueue()
    await pullTaskLabelsForTasks([task],owner,await captureSyncContext())
    await pullNewTasks(project,await captureSyncContext())
    await useTaskStore.getState().hydrateTaskLabels(task)
    const cloud=(await remote.query<{label_id:string}>('SELECT label_id FROM task_labels WHERE task_id=$1 ORDER BY label_id',[task])).rows.map((row)=>row.label_id)
    const expected=first==='add'?[labels[1]]:labels
    expect(cloud).toEqual(expected)
    expect(repos.tasks.getLabels(task).map((row)=>row.label_id)).toEqual(expected)
    expect(useTaskStore.getState().taskLabels[task].map((row)=>row.id).sort()).toEqual(expected)
    expect(repos.tasks.getLabelState(task).every((row)=>row.sync_pending===0)).toBe(true)
    expect(repos.syncQueue.count()).toBe(0)
  } finally {release?.()}
},15000)
it('allows an unrelated task to finish while another assignment write is held',async()=>{
  const labels=await seedSettledAssignments()
  const other=repos.tasks.create({id:id(301),project_id:project,owner_id:owner,status_id:source,title:'Unrelated'})
  const context=await captureSyncContext()
  await context.client.from('tasks').upsert(other)
  repos.tasks.applyRemoteTaskLabels(other.id,labels)
  await context.client.from('task_labels').upsert(labels.map((label_id)=>({task_id:other.id,label_id,deleted_at:null})))
  useTaskStore.setState((state)=>({tasks:{...state.tasks,[other.id]:other}}))
  await useTaskStore.getState().hydrateTaskLabels(other.id)
  let release!:()=>void,started!:()=>void
  const gate=new Promise<void>((resolve)=>{release=resolve}),entered=new Promise<void>((resolve)=>{started=resolve})
  beforeAssignmentWrite=async()=>{started();await gate}
  setOnlineStatus(true)
  await useTaskStore.getState().removeLabel(task,labels[0])
  await entered
  try {
    await useTaskStore.getState().removeLabel(other.id,labels[0])
    await vi.waitFor(()=>expect(repos.tasks.getLabelState(other.id).every((row)=>!row.sync_pending)).toBe(true))
    expect(repos.tasks.getLabelState(task).some((row)=>row.sync_pending)).toBe(true)
    expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[other.id,labels[0]])).rows).toHaveLength(0)
  } finally {release()}
  await processSyncQueue();await processSyncQueue()
},15000)
it.each([0,1].flatMap((shared)=>['single','bulk'].map((path)=>({shared,path}))))('removes displayed canonical assignments using their actual foreign IDs ($path, shared=$shared)',async({shared,path})=>{
  const labels=await seedSettledAssignments(), foreign=id(801), other=id(802)
  const canonical=repos.labels.findById(labels[0])!
  const context=await captureSyncContext()
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  await context.client.from('user_labels').upsert({...canonical,id:foreign,user_id:id(999)})
  await context.client.from('project_labels').upsert({project_id:project,label_id:foreign,created_at:canonical.created_at,deleted_at:null})
  await remote.query('DELETE FROM task_labels WHERE task_id=$1 AND label_id=$2',[task,labels[0]])
  await context.client.from('task_labels').upsert({task_id:task,label_id:foreign,deleted_at:null})
  const otherTask=repos.tasks.create({id:other,project_id:project,owner_id:owner,status_id:source,title:'Other assignment'})
  await context.client.from('tasks').upsert(otherTask)
  await context.client.from('task_labels').upsert({task_id:other,label_id:foreign,deleted_at:null})
  const {pullTaskLabelsForTasks,pullNewTasks}=await import('./PersonalSyncService')
  await pullTaskLabelsForTasks([task],owner,context)
  await useTaskStore.getState().hydrateTaskLabels(task)
  expect(useTaskStore.getState().taskLabels[task].some((row)=>row.id===labels[0])).toBe(true)
  setOnlineStatus(true)
  if(path==='single') await useTaskStore.getState().removeLabel(task,labels[0])
  else await useTaskStore.getState().bulkRemoveLabel([task],labels[0])
  await processSyncQueue();await processSyncQueue()
  await pullTaskLabelsForTasks([task],owner,context)
  await pullNewTasks(project,context)
  await useTaskStore.getState().hydrateTaskLabels(task)
  expect(useTaskStore.getState().taskLabels[task].map((row)=>row.id)).toEqual([labels[1]])
  expect((await remote.query<{label_id:string}>('SELECT label_id FROM task_labels WHERE task_id=$1',[task])).rows.map((row)=>row.label_id)).toEqual([labels[1]])
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[other,foreign])).rows).toHaveLength(1)
  expect((await remote.query('SELECT * FROM project_labels WHERE project_id=$1 AND label_id=$2 AND deleted_at IS NULL',[project,foreign])).rows).toHaveLength(1)
  expect((await remote.query<{user_id:string}>('SELECT user_id FROM user_labels WHERE id=$1',[foreign])).rows[0].user_id).toBe(id(999))
  expect(repos.syncQueue.count()).toBe(0)
},15000)
it('batches 500 explicit additions using one palette read and three bounded writes',async()=>{
  const labels=await seedSettledAssignments(),context=await captureSyncContext()
  const tasks=Array.from({length:500},(_,index)=>repos.tasks.create({id:id(2000+index),project_id:project,owner_id:owner,status_id:source,title:'Batch '+index}))
  await context.client.from('tasks').upsert(tasks)
  for(const row of tasks) repos.tasks.addLabel(row.id,labels[0])
  paletteReads=0;assignmentBatches=[]
  await syncTaskLabelChoices(context.client,tasks.map((row)=>row.id),context.api,context.scope)
  expect(paletteReads).toBe(1)
  expect(assignmentBatches).toEqual([200,200,100])
  expect((await remote.query<{n:number}>('SELECT count(*)::int AS n FROM task_labels WHERE task_id=ANY($1)',[tasks.map((row)=>row.id)])).rows[0].n).toBe(500)
  expect(tasks.every((task)=>repos.tasks.getLabelState(task.id).every((row)=>!row.sync_pending))).toBe(true)
  setOnlineStatus(true)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
},15000)

it('retains canonical removal intent when cloud identity resolution fails',async()=>{
  const labels=await seedSettledAssignments(),context=await captureSyncContext()
  repos.tasks.removeLabel(task,labels[0])
  failDefinitions=true
  await expect(syncTaskLabelChoices(context.client,[task],context.api,context.scope)).rejects.toThrow(/identity read failure/)
  expect(repos.tasks.getLabelState(task).find((row)=>row.label_id===labels[0])?.sync_pending).toBe(1)
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[task,labels[0]])).rows).toHaveLength(1)
  failDefinitions=false
  await syncTaskLabelChoices(context.client,[task],context.api,context.scope)
  setOnlineStatus(true)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[task,labels[0]])).rows).toHaveLength(0)
},15000)

it.each([0,1].flatMap((shared)=>['same-tick','rollback','import-ahead','sibling-ahead','accent-active','accent-tombstone','ascii-tombstone'].map((clock)=>({shared,clock}))))('retains actual project-label removal after $clock delivery (shared=$shared)',async({shared,clock})=>{
  const ids=await seedSettledAssignments(), labelId=ids[0]
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  const client=await captureSyncContext()
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2030-01-01T20:00:00.000Z')
  await useLabelStore.getState().hydrateLabels(project)
  setOnlineStatus(true)
  await useLabelStore.getState().addToProject(project,labelId)
  await useTaskStore.getState().addLabel(task,labelId)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  let maximum=Date.parse(String(local.prepare('SELECT created_at FROM project_labels WHERE project_id=? AND label_id=?').get(project,labelId)!.created_at))
  if(clock==='import-ahead' || clock==='sibling-ahead' || clock.startsWith('accent') || clock==='ascii-tombstone') {
    const foreign=clock==='import-ahead'?labelId:id(907)
    if(clock.startsWith('accent')) {
      repos.labels.update(labelId,{name:'Étiquette'})
      await client.client.from('user_labels').upsert(repos.labels.findById(labelId)!)
    }
    if(foreign!==labelId) {
      repos.users.create({id:id(908),email:'foreign@example.invalid',display_name:null,avatar_url:null})
      const canonical=repos.labels.findById(labelId)!
      const definition={...canonical,id:foreign,user_id:id(908),name:canonical.name.toLowerCase()}
      repos.labels.applyRemote(definition)
      await client.client.from('user_labels').upsert(definition)
    }
    const ahead={project_id:project,label_id:foreign,created_at:'2031-01-01T00:00:00.000Z',deleted_at:clock.endsWith('tombstone')?'2032-01-01T00:00:00.000Z':null}
    repos.labels.applyRemoteProjectLabel(ahead)
    await client.client.from('project_labels').upsert(ahead)
    await client.client.from('task_labels').upsert({task_id:task,label_id:foreign,deleted_at:null})
    maximum=Date.parse(ahead.deleted_at??ahead.created_at)
    await useLabelStore.getState().hydrateLabels(project)
  }
  if(clock==='rollback') vi.setSystemTime('2029-01-01T00:00:00.000Z')
  setOnlineStatus(false)
  expect(await useLabelStore.getState().removeFromProject(project,labelId)).toBe(true)
  const commands=repos.syncQueue.findAll().map((entry)=>JSON.parse(entry.payload)).filter((value)=>value.remove_project_label)
  expect(commands.length).toBeGreaterThan(0)
  for(const command of commands) {
    expect(Date.parse(command.deletedAt)).toBeGreaterThan(maximum)
    expect(local.prepare('SELECT deleted_at FROM project_labels WHERE project_id=? AND label_id=?').get(project,command.labelId)?.deleted_at).toBe(command.deletedAt)
    if(command.labelId===labelId) expect(repos.tasks.getLabelState(task).find((row)=>row.label_id===labelId)?.deleted_at).toBe(command.deletedAt)
  }
  setOnlineStatus(true)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  const {refreshProjectLabels}=await import('./remoteProjectRefresh')
  const {pullTaskLabelsForTasks}=await import('./PersonalSyncService')
  await refreshProjectLabels(project,client)
  await pullTaskLabelsForTasks([task],owner,client)
  await useTaskStore.getState().hydrateTaskLabels(task)
  expect(repos.labels.findByProjectId(project).map((row)=>row.id)).not.toContain(labelId)
  expect(useTaskStore.getState().taskLabels[task].map((row)=>row.id)).toEqual([ids[1]])
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id<>$2',[task,ids[1]])).rows).toEqual([])
  await useTaskStore.getState().addLabel(task,labelId)
  await processSyncQueue();await processSyncQueue()
  await refreshProjectLabels(project,client);await pullTaskLabelsForTasks([task],owner,client)
  expect(repos.syncQueue.count()).toBe(0)
  expect(repos.labels.findByTaskId(task).map((row)=>row.id)).toContain(labelId)
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[task,labelId])).rows).toHaveLength(1)
},15000)

it.each([0,1].flatMap((shared)=>['remove','re-add'].map((choice)=>({shared,choice}))))('converges public reconciliation after a newer acknowledged $choice (shared=$shared)',async({shared,choice})=>{
  const ids=await seedSettledAssignments(), labelId=ids[0]
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  repos.projects.addMember(project,owner,'owner')
  const time=Date.parse('2090-01-01T00:00:00Z')+(shared*2+(choice==='remove'?0:1))*120_000
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(time)
  const link={project_id:project,label_id:labelId,created_at:new Date(time-60_000).toISOString(),deleted_at:choice==='re-add'?new Date(time-30_000).toISOString():null}
  repos.labels.applyRemoteProjectLabel(link)
  if(link.deleted_at) repos.labels.softDeleteTaskLabelsForProjectLabel(project,labelId)
  await useLabelStore.getState().hydrateLabels(project)
  await useTaskStore.getState().hydrateTaskLabels(task)
  let release!:()=>void,entered=false
  const gate=new Promise<void>((resolve)=>{release=resolve})
  beforeProjectWrite=async()=>{entered=true;await gate}
  setOnlineStatus(true)
  const {reconcile,pullTaskLabelsForTasks}=await import('./PersonalSyncService')
  const old=reconcile(owner)
  try {
    await vi.waitFor(()=>expect(entered).toBe(true))
    if(choice==='remove') await useLabelStore.getState().removeFromProject(project,labelId)
    else await useTaskStore.getState().addLabel(task,labelId)
    await processSyncQueue();await processSyncQueue()
    expect(repos.syncQueue.count()).toBe(0)
    const latest=local.prepare('SELECT created_at,deleted_at FROM project_labels WHERE project_id=? AND label_id=?').get(project,labelId)!
    const cloud=(await remote.query<{deleted_at:string|null}>('SELECT deleted_at FROM project_labels WHERE label_id=$1',[labelId])).rows[0]
    expect(!!cloud.deleted_at).toBe(choice==='remove')
    release();await old
    const final=(await remote.query<{deleted_at:string|null;created_at:string}>('SELECT deleted_at,created_at FROM project_labels WHERE label_id=$1',[labelId])).rows[0]
    expect(!!final.deleted_at).toBe(choice==='remove')
    expect(new Date(final.deleted_at??final.created_at).getTime()).toBe(Date.parse(String(latest.deleted_at??latest.created_at)))
    const {refreshProjectLabels}=await import('./remoteProjectRefresh')
    const context=await captureSyncContext()
    await refreshProjectLabels(project,context);await pullTaskLabelsForTasks([task],owner,context)
    expect(repos.labels.findByTaskId(task).some((row)=>row.id===labelId)).toBe(choice==='re-add')
    expect(repos.syncQueue.count()).toBe(0)
  } finally {release();await old}
},15000)

it.each([0,1].flatMap((shared)=>['Family','Étiquette'].map((name)=>({shared,name}))))('preserves an acknowledged $name re-add from a delayed sibling removal (shared=$shared)',async({shared,name})=>{
  const ids=await seedSettledAssignments(), canonical=ids[0],foreign=id(971)
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  repos.labels.update(canonical,{name})
  const context=await captureSyncContext()
  await context.client.from('user_labels').upsert(repos.labels.findById(canonical)!)
  repos.users.create({id:id(972),email:'sibling@example.invalid',display_name:null,avatar_url:null})
  const definition={...repos.labels.findById(canonical)!,id:foreign,user_id:id(972),name:name.toLowerCase()}
  repos.labels.applyRemote(definition);await context.client.from('user_labels').upsert(definition)
  const future={project_id:project,label_id:foreign,created_at:'2095-01-01T00:00:00.000Z',deleted_at:null}
  repos.labels.applyRemoteProjectLabel(future);await context.client.from('project_labels').upsert(future)
  await context.client.from('task_labels').upsert({task_id:task,label_id:foreign,deleted_at:null})
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2094-01-01T00:00:00Z')
  await useLabelStore.getState().hydrateLabels(project)
  await useLabelStore.getState().removeFromProject(project,canonical)
  const commands=repos.syncQueue.findAll().map((row)=>JSON.parse(row.payload)).filter((row)=>row.remove_project_label)
  expect(commands).toHaveLength(2)
  projectBatches=[];failProjectWriteNumber=2
  setOnlineStatus(true);await processSyncQueue()
  expect(repos.syncQueue.findAll().filter((row)=>JSON.parse(row.payload).remove_project_label)).toHaveLength(1)
  failProjectWriteNumber=null
  await useTaskStore.getState().addLabel(task,canonical)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  const {refreshProjectLabels}=await import('./remoteProjectRefresh')
  const {pullTaskLabelsForTasks}=await import('./PersonalSyncService')
  await refreshProjectLabels(project,context);await pullTaskLabelsForTasks([task],owner,context)
  await useTaskStore.getState().hydrateTaskLabels(task)
  expect(useTaskStore.getState().taskLabels[task].map((row)=>row.id)).toContain(canonical)
  expect((await remote.query<{deleted_at:string|null}>('SELECT deleted_at FROM project_labels WHERE label_id=$1',[canonical])).rows[0].deleted_at).toBeNull()
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[task,canonical])).rows).toHaveLength(1)
},15000)

let familySequence=0
async function seedTaskFamily(name:string,shared:number): Promise<{canonical:string;foreign:string;unrelated:string;other:string}> {
  const labels=await seedSettledAssignments(),canonical=labels[0],foreign=id(981),other=id(982)
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse('2100-01-01T00:00:00Z')+(++familySequence)*120_000)
  repos.labels.update(canonical,{name})
  repos.projects.addMember(project,owner,'owner')
  local.prepare('UPDATE projects SET is_shared=? WHERE id=?').run(shared,project)
  repos.users.create({id:id(983),email:'family-owner@example.invalid',display_name:null,avatar_url:null})
  const definition={...repos.labels.findById(canonical)!,id:foreign,user_id:id(983),name:name.toLowerCase()}
  repos.labels.applyRemote(definition)
  const context=await captureSyncContext()
  await context.client.from('user_labels').upsert([repos.labels.findById(canonical)!,definition])
  const palette={project_id:project,label_id:foreign,created_at:'2020-01-01T00:00:00.000Z',deleted_at:null}
  repos.labels.applyRemoteProjectLabel(palette);await context.client.from('project_labels').upsert(palette)
  repos.tasks.applyRemoteTaskLabels(task,[foreign])
  await context.client.from('task_labels').upsert({task_id:task,label_id:foreign,deleted_at:null})
  await remote.query('INSERT INTO tasks(id,project_id,status_id) VALUES($1,$2,$3)',[other,project,source])
  await context.client.from('task_labels').upsert({task_id:other,label_id:foreign,deleted_at:null})
  await remote.query('INSERT INTO projects(id,owner_id) VALUES($1,$2)',[id(984),id(983)])
  await remote.query('INSERT INTO statuses(id,project_id,is_done,is_default) VALUES($1,$2,0,1)',[id(985),id(984)])
  await remote.query('INSERT INTO tasks(id,project_id,status_id) VALUES($1,$2,$3)',[id(986),id(984),id(985)])
  await context.client.from('task_labels').upsert({task_id:id(986),label_id:foreign,deleted_at:null})
  await useLabelStore.getState().hydrateLabels(project)
  await useTaskStore.getState().hydrateTaskLabels(task)
  expect(useTaskStore.getState().taskLabels[task].map((row)=>row.id).sort()).toEqual([canonical,labels[1],foreign].sort())
  return {canonical,foreign,unrelated:labels[1],other}
}
async function assertTaskFamilyResult(family:Awaited<ReturnType<typeof seedTaskFamily>>,active:boolean):Promise<void> {
  const context=await captureSyncContext()
  const {pullTaskLabelsForTasks,reconcile}=await import('./PersonalSyncService')
  await pullTaskLabelsForTasks([task],owner,context)
  await reconcile(owner);await processSyncQueue();await processSyncQueue()
  await useTaskStore.getState().hydrateTaskLabels(task)
  const expected=[family.unrelated,...(active?[family.canonical]:[])].sort()
  const cloud=(await remote.query<{label_id:string}>('SELECT label_id FROM task_labels WHERE task_id=$1 ORDER BY label_id',[task])).rows.map((row)=>row.label_id)
  expect(cloud).toEqual(expected)
  expect(useTaskStore.getState().taskLabels[task].map((row)=>row.id).sort()).toEqual(expected)
  expect(repos.tasks.getLabelState(task).every((row)=>!row.sync_pending)).toBe(true)
  expect(repos.syncQueue.count()).toBe(0)
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[family.other,family.foreign])).rows).toHaveLength(1)
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[id(986),family.foreign])).rows).toHaveLength(1)
  expect(repos.labels.findByProjectId(project).map((row)=>row.id).sort()).toEqual([family.canonical,family.foreign,family.unrelated].sort())
  const observer=new DatabaseSync(':memory:');observer.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  try {
    for(const migrate of migrations) migrate(observer)
    const fresh=createRepositories(observer)
    for(const user of repos.users.list()) fresh.users.create(user)
    fresh.projects.applyRemote(repos.projects.findById(project)!)
    for(const status of repos.statuses.findByProjectId(project)) fresh.statuses.applyRemote(status)
    fresh.tasks.applyRemoteTask(repos.tasks.findById(task)!)
    for(const label of [family.canonical,family.foreign,family.unrelated]) fresh.labels.applyRemote(repos.labels.findById(label)!)
    const links=JSON.parse(JSON.stringify((await remote.query('SELECT * FROM project_labels WHERE project_id=$1',[project])).rows)) as Array<{project_id:string;label_id:string;created_at:string;deleted_at:string|null}>
    for(const link of links) fresh.labels.applyRemoteProjectLabel(link)
    fresh.tasks.applyRemoteTaskLabels(task,cloud,[])
    expect(fresh.labels.findByTaskId(task).map((row)=>row.id).sort()).toEqual(expected)
  } finally {observer.close()}
}

it.each([0,1].flatMap((shared)=>['Family','Étiquette'].flatMap((name)=>['single','bulk'].flatMap((path)=>['delete-last','add-last'].map((order)=>({shared,name,path,order}))))))('keeps newer $name assignment after queued $path family removal ($order, shared=$shared)',async({shared,name,path,order})=>{
  const family=await seedTaskFamily(name,shared)
  vi.mocked(requireSession).mockResolvedValue(null)
  setOnlineStatus(false)
  if(path==='single') await useTaskStore.getState().removeLabel(task,family.canonical)
  else await useTaskStore.getState().bulkRemoveLabel([task],family.canonical)
  if(path==='single') await useTaskStore.getState().addLabel(task,family.canonical)
  else await useTaskStore.getState().bulkAddLabel([task],family.canonical)
  await new Promise((resolve)=>setTimeout(resolve,25))
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1',[task])).rows).toHaveLength(3)
  const state=repos.tasks.getLabelState(task)
  expect(state.find((row)=>row.label_id===family.canonical)!.local_version).toBeGreaterThan(state.find((row)=>row.label_id===family.foreign)!.local_version)
  assignmentCompletions=[]
  assignmentSchedule=order as 'delete-last'|'add-last'
  vi.mocked(requireSession).mockResolvedValue({user:{id:owner},access_token:'synthetic-owner'} as Session)
  setOnlineStatus(true);await processSyncQueue();await processSyncQueue()
  expect(assignmentCompletions.slice(0,2)).toEqual(order==='delete-last'?['add','delete']:['delete','add'])
  await assertTaskFamilyResult(family,true)
},15000)

it.each([0,1].flatMap((shared)=>['remove-wins','acknowledged-add','failed-retry','during-read'].map((mode)=>({shared,mode}))))('resolves complete current assignment family versions ($mode, shared=$shared)',async({shared,mode})=>{
  const family=await seedTaskFamily('Étiquette',shared)
  vi.mocked(requireSession).mockResolvedValue(null);setOnlineStatus(false)
  if(mode==='remove-wins') {
    await useTaskStore.getState().addLabel(task,family.canonical)
    await useTaskStore.getState().removeLabel(task,family.canonical)
  } else {
    await useTaskStore.getState().removeLabel(task,family.canonical)
    if(mode!=='during-read') await useTaskStore.getState().addLabel(task,family.canonical)
  }
  await new Promise((resolve)=>setTimeout(resolve,25))
  vi.mocked(requireSession).mockResolvedValue({user:{id:owner},access_token:'synthetic-owner'} as Session)
  const context=await captureSyncContext()
  if(mode==='acknowledged-add') {
    const choice=repos.tasks.getLabelState(task).find((row)=>row.label_id===family.canonical)!
    await context.client.from('task_labels').upsert({task_id:task,label_id:family.canonical,deleted_at:null})
    await window.api.tasks.acknowledgeLabelState(task,[choice])
    expect(repos.tasks.getLabelState(task).find((row)=>row.label_id===family.canonical)?.sync_pending).toBe(0)
  }
  if(mode==='during-read') afterLabelSnapshot=async()=>{
    vi.mocked(requireSession).mockResolvedValue(null)
    await useTaskStore.getState().addLabel(task,family.canonical)
    vi.mocked(requireSession).mockResolvedValue({user:{id:owner},access_token:'synthetic-owner'} as Session)
  }
  if(mode==='failed-retry') {
    failAssignments=true
    await expect(syncTaskLabelChoices(context.client,[task],context.api,context.scope)).rejects.toThrow('Synthetic assignment failure')
    expect(repos.tasks.getLabelState(task).some((row)=>row.sync_pending)).toBe(true)
    expect(repos.syncQueue.count()).toBeGreaterThan(0)
    failAssignments=false
  }
  setOnlineStatus(true);await processSyncQueue();await processSyncQueue()
  await assertTaskFamilyResult(family,mode!=='remove-wins')
},15000)

it.each([0,1].flatMap((shared)=>['source','target'].flatMap((newest)=>['add','remove'].flatMap((choice)=>[0,1].flatMap((sourcePending)=>[0,1].map((targetPending)=>({shared,newest,choice,sourcePending,targetPending})))))))('delivers consolidated complete assignment choice ($newest/$choice, pending $sourcePending/$targetPending, shared=$shared)',async({shared,newest,choice,sourcePending,targetPending})=>{
  const family=await seedTaskFamily('Family',shared)
  const newer=newest==='source'?family.foreign:family.canonical,older=newest==='source'?family.canonical:family.foreign
  const context=await captureSyncContext()
  const mutate=async(labelId:string,active:boolean):Promise<void>=>{
    if(active) await window.api.tasks.addLabel(task,labelId)
    else await window.api.tasks.removeLabel(task,labelId)
  }
  await mutate(older,choice!=='add');await mutate(newer,choice==='add')
  const receipts=repos.tasks.getLabelState(task).filter((row)=>row.label_id!==family.unrelated)
  for(const receipt of [...receipts].sort((a,b)=>a.local_version-b.local_version)) {
    const pending=receipt.label_id===family.foreign?sourcePending:targetPending
    if(!pending) {
      if(receipt.deleted_at) await context.client.from('task_labels').delete().eq('task_id',task).in('label_id',[family.canonical,family.foreign])
      else await context.client.from('task_labels').upsert({task_id:task,label_id:receipt.label_id,deleted_at:null})
      await window.api.tasks.acknowledgeLabelState(task,[receipt])
    }
  }
  const winning=repos.tasks.getLabelState(task).find((row)=>row.label_id===newer)!
  await remote.exec('CREATE UNIQUE INDEX labels_owner_name ON user_labels(user_id,lower(name)) WHERE deleted_at IS NULL')
  const definition=repos.labels.findById(family.foreign)!
  if(newest==='source') {
    const {pushLabel}=await import('./PersonalSyncService')
    expect(await pushLabel(definition,owner,{api:context.api,userId:owner,client:async()=>context.client,assertCurrent:context.assertCurrent,isCurrent:context.isCurrent,scope:async()=>context.scope})).toBe(family.canonical)
  } else await SYNC_TABLES.labels!.remoteUpsert({...definition,user_id:owner},context)
  expect(repos.labels.findById(family.foreign)).toBeUndefined()
  const remapped=repos.tasks.getLabelState(task).find((row)=>row.label_id===family.canonical)!
  expect(remapped.deleted_at).toBe(winning.deleted_at)
  expect(remapped.local_version).toBeGreaterThanOrEqual(winning.local_version)
  await window.api.tasks.acknowledgeLabelState(task,receipts)
  expect(repos.tasks.getLabelState(task).find((row)=>row.label_id===family.canonical)?.sync_pending).toBe(remapped.sync_pending)
  setOnlineStatus(true);await processSyncQueue();await processSyncQueue()
  const {pullTaskLabelsForTasks,reconcile}=await import('./PersonalSyncService')
  await pullTaskLabelsForTasks([task],owner,context);await reconcile(owner)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  expect(repos.labels.findByTaskId(task).map((row)=>row.id).sort()).toEqual([family.unrelated,...(choice==='add'?[family.canonical]:[])].sort())
  const cloud=(await remote.query<{label_id:string}>('SELECT label_id FROM task_labels WHERE task_id=$1',[task])).rows.map((row)=>row.label_id)
  expect(cloud.includes(family.canonical)).toBe(choice==='add')
  if(choice==='remove') expect(cloud).toEqual([family.unrelated])
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[family.other,family.foreign])).rows).toHaveLength(1)
  const observer=new DatabaseSync(':memory:');observer.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  try {
    for(const migrate of migrations) migrate(observer)
    const fresh=createRepositories(observer)
    for(const user of repos.users.list()) fresh.users.create(user)
    fresh.projects.applyRemote(repos.projects.findById(project)!)
    for(const status of repos.statuses.findByProjectId(project)) fresh.statuses.applyRemote(status)
    fresh.tasks.applyRemoteTask(repos.tasks.findById(task)!)
    fresh.labels.applyRemote(repos.labels.findById(family.canonical)!)
    const api=new Proxy({}, {get:(_,ns:keyof typeof fresh)=>new Proxy({}, {get:(_,method:string)=>async(...args:unknown[])=>(fresh[ns] as unknown as Record<string,(...args:unknown[])=>unknown>)[method](...args)})}) as TodoozyAPI
    await pullTaskLabelsForTasks([task],owner,{...context,api})
    expect(fresh.labels.findByTaskId(task).map((row)=>row.id).sort()).toEqual([family.unrelated,...(choice==='add'?[family.canonical]:[])].sort())
  } finally {observer.close()}
},15000)


it.each([0,1].flatMap((shared)=>['push','remap'].flatMap((caller)=>['Family','Étiquette'].map((name)=>({shared,caller,name})))))('retains cached-palette removal across project consolidation ($shared/$caller/$name)',async({shared,caller,name})=>{
  const family=await seedTaskFamily(name,shared),context=await captureSyncContext()
  local.prepare('DELETE FROM project_labels WHERE project_id=? AND label_id=?').run(project,family.canonical)
  await useLabelStore.getState().hydrateLabels(project)
  expect(useLabelStore.getState().projectLabels[project].has(family.canonical)).toBe(false)
  let release!:()=>void,started!:()=>void
  const held=new Promise<void>((resolve)=>{release=resolve}),applied=new Promise<void>((resolve)=>{started=resolve})
  const api={...context.api,labels:new Proxy(context.api.labels,{get:(labels,method)=>method==='applyRemoteProjectLabel'?async(link:Parameters<typeof labels.applyRemoteProjectLabel>[0])=>{
    await labels.applyRemoteProjectLabel(link)
    if(link.label_id===family.canonical) {started();await held}
  }:Reflect.get(labels,method)})}
  const {refreshProjectLabels}=await import('./remoteProjectRefresh')
  const refreshing=refreshProjectLabels(project,{...context,api})
  await applied
  expect(repos.labels.findByProjectId(project).map((row)=>row.id)).toContain(family.canonical)
  expect(useLabelStore.getState().projectLabels[project].has(family.canonical)).toBe(false)
  expect(await useLabelStore.getState().removeFromProject(project,family.foreign)).toBe(true)
  const removal=repos.syncQueue.findAll().map((row)=>JSON.parse(row.payload)).find((row)=>row.remove_project_label && row.labelId===family.foreign)
  expect(removal).toBeDefined()
  release();await refreshing
  await remote.exec('CREATE UNIQUE INDEX labels_owner_name ON user_labels(user_id,lower(name)) WHERE deleted_at IS NULL')
  const definition=repos.labels.findById(family.foreign)!
  if(caller==='push') {
    const {pushLabel}=await import('./PersonalSyncService')
    expect(await pushLabel(definition,owner,{api:context.api,userId:owner,client:async()=>context.client,assertCurrent:context.assertCurrent,isCurrent:context.isCurrent,scope:async()=>context.scope})).toBe(family.canonical)
  } else await SYNC_TABLES.labels!.remoteUpsert({...definition,user_id:owner},context)
  expect(local.prepare('SELECT deleted_at FROM project_labels WHERE project_id=? AND label_id=?').get(project,family.canonical)?.deleted_at).toBe(removal.deletedAt)
  setOnlineStatus(true)
  failProjectWriteNumber=projectBatches.length+1
  await processSyncQueue()
  expect(repos.syncQueue.count()).toBeGreaterThan(0)
  failProjectWriteNumber=null
  await processSyncQueue();await processSyncQueue()
  const {reconcile,pullTaskLabelsForTasks}=await import('./PersonalSyncService')
  await refreshProjectLabels(project,context);await pullTaskLabelsForTasks([task],owner,context);await reconcile(owner)
  await processSyncQueue();await processSyncQueue()
  expect(repos.syncQueue.count()).toBe(0)
  expect(repos.labels.findByProjectId(project).map((row)=>row.id)).toEqual([family.unrelated])
  expect((await remote.query('SELECT * FROM project_labels WHERE project_id=$1 AND label_id=ANY($2) AND deleted_at IS NULL',[project,[family.canonical,family.foreign]])).rows).toEqual([])
  expect((await remote.query('SELECT * FROM task_labels WHERE task_id=$1 AND label_id=$2',[id(986),family.foreign])).rows).toHaveLength(1)
  const observer=new DatabaseSync(':memory:');observer.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  try {
    for(const migrate of migrations) migrate(observer)
    const fresh=createRepositories(observer)
    fresh.users.create(repos.users.findById(owner)!)
    fresh.projects.applyRemote(repos.projects.findById(project)!)
    for(const label of (await remote.query('SELECT * FROM user_labels')).rows) fresh.labels.applyRemote(JSON.parse(JSON.stringify(label)))
    for(const link of (await remote.query('SELECT * FROM project_labels WHERE project_id=$1',[project])).rows) fresh.labels.applyRemoteProjectLabel(JSON.parse(JSON.stringify(link)))
    expect(fresh.labels.findByProjectId(project).map((row)=>row.id)).toEqual([family.unrelated])
  } finally {observer.close()}
},15000)
