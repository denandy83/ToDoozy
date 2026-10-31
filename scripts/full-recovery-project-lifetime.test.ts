import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Harness[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter=r }), wait: new Promise<void>(r=>{release=r}), enter:()=>enter(), release:()=>release() } }
async function setup(shared = 2): Promise<Harness> {
  const h = await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:2,shared,connected:false}); opened.push(h)
  for (const n of [0,1]) {
    const task = {id:n?'q-task':'p-task',project_id:'p'+n,owner_id:shared?'other':'u',status_id:'s'+n,title:n?'Q CURRENT':'P RESPONSE',updated_at:'2030-01-01T00:00:00.000Z',created_at:'2026-01-01T00:00:00.000Z',parent_id:null,is_archived:0,deleted_at:null}
    h.remote.tasks.push(task)
  }
  h.repo.syncQueue.clear()
  return h
}
async function revoke(h: Harness): Promise<void> {
  h.remote.project_members = h.remote.project_members.filter((m: {project_id:string;user_id:string})=>m.project_id!=='p0'||m.user_id!=='u')
  await h.services.shared.discoverRemoteMemberships('u',await h.context(),h.repo.projects.findById('p0'))
}
function responseGate(h: Harness, table: string, pause: ReturnType<typeof gate>): void {
  const fetch = h.sandbox.fetch; let held=false
  h.sandbox.fetch = async (url: string, init?: RequestInit) => {
    const response = await fetch(url,init), parsed = new URL(String(url))
    if (!held && parsed.pathname.endsWith('/'+table) && (init?.method??'GET')==='GET' && parsed.searchParams.get('project_id')?.includes('p0')) {
      held=true; pause.enter(); await pause.wait
    }
    return response
  }
}
function nativeGate(h: Harness, channel: string, id: string, pause: ReturnType<typeof gate>): void {
  const api=h.sandbox.window.api; let held=false
  h.sandbox.window.api=new Proxy(api,{get(target,namespace) {
    if(namespace!=='sync')return Reflect.get(target,namespace)
    return new Proxy(target.sync,{get(sync,method) {
      if(method!=='invokeContext')return Reflect.get(sync,method)
      return async(origin:unknown,name:string,args:unknown[])=>{const result=await sync.invokeContext(origin,name,args);if(!held&&name===channel&&args[0]===id){held=true;pause.enter();await pause.wait}return result}
    }})
  }})
}
async function run(h: Harness, path: string): Promise<void> {
  const context=await h.context()
  if(path==='fullPull') await h.services.personal.fullPull('u',context)
  else if(path==='download') {
    try { await h.services.shared.syncProjectDown('p0','u',context) } catch(error) { if(await h.services.syncContexts.captureProjectProducer('p0').isCurrent() && h.repo.projects.getMembers('p0').some((m:{user_id:string})=>m.user_id==='u')) throw error }
    await h.services.shared.syncProjectDown('p1','u',context)
  } else if(path==='upload') await h.services.personal.fullUpload('u',context)
  else await h.services.personal.requestSyncCatchUp(context)
}
it.each(['catchup','fullPull','download'].flatMap(path=>['normal','revoke','account','database'].map(change=>({path,change}))))('retains P lifetime through $path after held tasks response ($change)',async({path,change})=>{
  const h=await setup(),pause=gate()
  if(path==='fullPull') {h.services.db.exec('DELETE FROM tasks;DELETE FROM statuses;DELETE FROM project_members;DELETE FROM projects');await h.stores.useProjectStore.getState().hydrateProjects('u')}
  responseGate(h,'tasks',pause)
  const context=await h.context(),original=h.services.syncContexts.captureProjectProducer('p0')
  const pending=run(h,path);void pending.catch(()=>{})
  await pause.entered
  expect(h.repo.tasks.findById('p-task')).toBeUndefined()
  if(change==='revoke')await revoke(h)
  if(change==='account'){h.setAccount('other');h.setSession('next','other')}
  if(change==='database')h.replaceDatabase()
  const mark=h.nativeCalls.length
  pause.release();await pending.catch(error=>{if(change==='normal'||change==='revoke')throw error});await h.untilIdle()
  if(change==='normal')expect(h.repo.tasks.findById('p-task')).toMatchObject({title:'P RESPONSE'})
  else {
    expect(h.repo.tasks.findById('p-task')).toBeUndefined()
    expect(h.nativeCalls.slice(mark).filter((call:{namespace:string;method:string;args:unknown[]})=>call.namespace==='tasks'&&['applyRemote','create','update'].includes(call.method)&&JSON.stringify(call.args).includes('p-task'))).toEqual([])
  }
  if(change==='normal'||change==='revoke')expect(h.repo.tasks.findById('q-task')).toMatchObject({title:'Q CURRENT'})
  if(change==='revoke'){expect(await context.isCurrent()).toBe(true);expect(await original.isCurrent()).toBe(false);expect(h.stores.useProjectStore.getState().projects.p0).toBeUndefined()}
  expect(h.fixtureErrors).toEqual([])
},20000)

it.each(['statuses','activity_log','project_labels','task_labels'])('cancels catchup P %s response without canceling Q',async table=>{
  const h=await setup(),pause=gate()
  const p=h.remote.tasks.find((t:{id:string})=>t.id==='p-task')
  if(table==='activity_log'||table==='task_labels') h.repo.tasks.applyRemoteTask(p)
  if(table==='activity_log') h.remote.activity_log.push({id:'activity-p',project_id:'p0',task_id:'p-task',user_id:'other',action:'created',created_at:'2030-01-01T00:00:00.000Z'})
  if(table==='project_labels'||table==='task_labels') {
    h.remote.user_labels.push({id:'label-p',user_id:'other',name:'HELD LABEL',color:'#123456',order_index:0,created_at:'2030-01-01T00:00:00.000Z',updated_at:'2030-01-01T00:00:00.000Z',deleted_at:null})
    h.remote[table].push(table==='project_labels'?{project_id:'p0',label_id:'label-p',created_at:'2030-01-01T00:00:00.000Z',deleted_at:null}:{task_id:'p-task',label_id:'label-p',deleted_at:null})
  }
  if(table==='task_labels') {
    const fetch=h.sandbox.fetch;let held=false
    h.sandbox.fetch=async(url:string,init?:RequestInit)=>{const response=await fetch(url,init),parsed=new URL(String(url));if(!held&&parsed.pathname.endsWith('/task_labels')&&parsed.searchParams.get('task_id')?.includes('p-task')){held=true;pause.enter();await pause.wait}return response}
  } else responseGate(h,table,pause)
  const pending=run(h,'catchup');void pending.catch(()=>{});await pause.entered;await revoke(h)
  const mark=h.nativeCalls.length;pause.release();await pending;await h.untilIdle()
  expect(h.repo.tasks.findById('q-task')).toMatchObject({title:'Q CURRENT'})
  expect(h.repo.labels.findById('label-p')).toBeUndefined()
  expect(h.nativeCalls.slice(mark).filter((call:{namespace:string;method:string;args:unknown[]})=>['applyRemote','applyRemoteProjectLabel','applyRemoteTaskLabels'].includes(call.method)&&JSON.stringify(call.args).includes(table==='statuses'?'s0':table==='activity_log'?'activity-p':'label-p'))).toEqual([])
  expect(h.fixtureErrors).toEqual([])
},20000)

it.each(['upload','catchup'])('retains original P dispatch during %s after native status reply',async path=>{
  const h=await setup(0),pause=gate()
  h.remote.tasks=[]
  for(const n of [0,1]) h.repo.tasks.create({id:n?'q-task':'p-task',project_id:'p'+n,owner_id:'u',status_id:'s'+n,title:n?'Q CURRENT':'P RESPONSE'})
  nativeGate(h,'statuses:findByProjectId','p0',pause)
  if(path==='catchup') nativeGate(h,'statuses:findAllByProject','p0',pause)
  const pending=run(h,path);void pending.catch(()=>{});await pause.entered
  await h.stores.useProjectStore.getState().deleteProject('p0')
  const mark=h.requests.length;pause.release();await pending;await h.untilIdle()
  expect(h.remote.tasks.some((t:{id:string})=>t.id==='q-task')).toBe(true)
  expect(h.requests.slice(mark).filter((r:{method:string;body:unknown})=>r.method==='POST'&&JSON.stringify(r.body).includes('p-task'))).toEqual([])
  expect(h.fixtureErrors).toEqual([])
},20000)

it('admits a fresh shared rejoin after canceling the old download',async()=>{
  const h=await setup(),pause=gate();responseGate(h,'tasks',pause)
  const pending=run(h,'download');void pending.catch(()=>{});await pause.entered;await revoke(h);pause.release();await pending
  expect(h.repo.tasks.findById('p-task')).toBeUndefined()
  h.remote.project_members.push({project_id:'p0',user_id:'u',role:'member',joined_at:'2031-01-01T00:00:00.000Z'})
  await h.services.shared.discoverRemoteMemberships('u',await h.context())
  await h.services.shared.syncProjectDown('p0','u',await h.context())
  expect(h.repo.tasks.findById('p-task')).toMatchObject({title:'P RESPONSE'})
  expect(h.repo.projects.getMembers('p0').some((m:{user_id:string})=>m.user_id==='u')).toBe(true)
  expect(h.fixtureErrors).toEqual([])
},20000)

it('keeps full-upload P authorization through an SDK credential wait',async()=>{
  const h=await setup(0),native=gate(),auth=gate()
  nativeGate(h,'statuses:findByProjectId','p0',native)
  const pending=run(h,'upload');void pending.catch(()=>{});await native.entered
  const requireSession=h.sandbox.runtime.requireSession;let held=false
  h.sandbox.runtime.requireSession=async()=>{if(!held){held=true;auth.enter();await auth.wait}return requireSession()}
  native.release();await auth.entered
  await h.stores.useProjectStore.getState().deleteProject('p0')
  const mark=h.requests.length;auth.release();await pending;await h.untilIdle()
  expect(h.requests.slice(mark).filter((r:{table:string;method:string;body:unknown})=>r.table==='statuses'&&r.method==='POST'&&JSON.stringify(r.body).includes('s0'))).toEqual([])
  expect(h.remote.statuses.some((row:{id:string})=>row.id==='s1')).toBe(true)
  expect(h.fixtureErrors).toEqual([])
},20000)

it.each([false,true])('preserves shared upload while canceling an invalid original project (removed=%s)',async removed=>{
  const h=await setup(0),pause=gate()
  h.remote.tasks=[]
  for(const n of [0,1])h.repo.tasks.create({id:n?'q-task':'p-task',project_id:'p'+n,owner_id:'u',status_id:'s'+n,title:n?'Q CURRENT':'P RESPONSE'})
  nativeGate(h,'statuses:findByProjectId','p0',pause)
  const pending=h.services.shared.uploadProjectToSupabase('p0','u');void pending.catch(()=>{});await pause.entered
  if(removed)await h.stores.useProjectStore.getState().deleteProject('p0')
  const mark=h.requests.length;pause.release()
  if(removed)await expect(pending).rejects.toThrow(/project|context/i)
  else await pending
  await h.services.shared.uploadProjectToSupabase('p1','u');await h.untilIdle()
  expect(h.remote.tasks.some((row:{id:string})=>row.id==='p-task')).toBe(!removed)
  expect(h.remote.tasks.some((row:{id:string})=>row.id==='q-task')).toBe(true)
  if(removed)expect(h.requests.slice(mark).filter((r:{method:string;body:unknown})=>r.method==='POST'&&JSON.stringify(r.body).includes('p-task'))).toEqual([])
  expect(h.fixtureErrors).toEqual([])
},20000)
