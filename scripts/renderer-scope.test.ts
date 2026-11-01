import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { migrations } from '../src/main/database/migrations'
import { createRepositories } from '../src/main/repositories'

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'})
vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document)
vi.stubGlobal('requestAnimationFrame',(callback:(at:number)=>void)=>setTimeout(()=>callback(Date.now()),1))
vi.stubGlobal('cancelAnimationFrame',(id:ReturnType<typeof setTimeout>)=>clearTimeout(id))
vi.stubGlobal('ResizeObserver',class {observe():void{return} unobserve():void{return} disconnect():void{return}})
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
afterAll(()=>{dom.window.close();vi.unstubAllGlobals()})
const require=createRequire(import.meta.url)
const {makeHarness}=require('./benchmark-sync.cjs')
type Harness=Awaited<ReturnType<typeof makeHarness>>
const opened:Array<{h:Harness;root:Root;host:HTMLDivElement;dbs:DatabaseSync[]}>=[]
afterEach(async()=>{for(const f of opened.splice(0)){await act(async()=>f.root.unmount());f.host.remove();await f.h.stop();for(const db of f.dbs)db.close()}})
function gate(){let enter!:()=>void,release!:()=>void;return{entered:new Promise<void>(resolve=>{enter=resolve}),wait:new Promise<void>(resolve=>{release=resolve}),enter:()=>enter(),release:()=>release()}}
async function setup(){
  const h=await makeHarness({projectCount:1,shared:1,sharedHook:true,connected:false})
  h.sandbox.document=document
  h.sandbox.requestAnimationFrame=(callback:(at:number)=>void)=>setImmediate(()=>callback(0))
  h.sandbox.cancelAnimationFrame=(id:ReturnType<typeof setImmediate>)=>clearImmediate(id)
  h.stores.useAuthStore.setState({isAuthenticated:true,isOffline:true})
  h.repo.projects.update('p0',{name:'PRIVATE OLD PROJECT'})
  h.repo.tasks.create({id:'private-task',owner_id:'u',project_id:'p0',status_id:'s0',title:'PRIVATE OLD TASK',is_in_my_day:1,due_date:'2030-01-01'})
  h.repo.users.update('other',{display_name:'PRIVATE OLD MEMBER'})
  h.repo.settings.set('u','private_marker','PRIVATE OLD SETTING')
  const fetch=h.sandbox.fetch
  h.sandbox.fetch=async(url:string,init:RequestInit)=>new URL(url).pathname.endsWith('/rpc/get_user_profiles')
    ?new Response(JSON.stringify(JSON.parse(String(init.body)).p_user_ids.map((id:string)=>h.repo.users.findById(id))),{headers:{'Content-Type':'application/json'}}):fetch(url,init)
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  const f={h,host,root,dbs:[] as DatabaseSync[]};opened.push(f);return f
}
function replace(f:Awaited<ReturnType<typeof setup>>){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_version(version INTEGER PRIMARY KEY)');for(const migrate of migrations)migrate(db)
  f.dbs.push(db);const repo=createRepositories(db)
  for(const id of ['u','other'])repo.users.create({id,email:id+'@example.invalid',display_name:'CURRENT MEMBER',avatar_url:null})
  repo.projects.create({id:'p0',owner_id:'other',name:'CURRENT PROJECT'});repo.projects.update('p0',{is_shared:1})
  repo.projects.addMember('p0','other','owner');repo.projects.addMember('p0','u','member')
  repo.statuses.create({id:'s0',project_id:'p0',name:'CURRENT STATUS',is_default:1})
  repo.tasks.create({id:'current-task',owner_id:'u',project_id:'p0',status_id:'s0',title:'CURRENT TASK',is_in_my_day:1,due_date:'2030-01-01'})
  repo.settings.set('u','private_marker','CURRENT SETTING')
  for(const [name,value]of Object.entries(repo))f.h.repo[name]=value
  f.h.remote.project_members=repo.projects.getMembers('p0').map(row=>({...row}))
  f.h.remote.projects=[{...repo.projects.findById('p0')}]
  f.h.replaceDatabase()
  return repo
}
it.each([false,true])('synchronously resets published stores/timer and runs actual offline bootstrap after replacement (old failure=%s)',async fail=>{
  const f=await setup(),frames:string[]=[]
  function Screen():ReactElement{
    const state=f.h.stores.useTaskStore(),projects=f.h.stores.useProjectStore(),settings=f.h.stores.useSettingsStore()
    const text=JSON.stringify({tasks:state.tasks,projects:projects.projects,settings:settings.settings});frames.push(text)
    return createElement('div',null,createElement(f.h.services.NativeBootstrap),text)
  }
  await act(async()=>{f.root.render(createElement(Screen));await f.h.untilIdle()})
  expect(f.host.textContent).toContain('PRIVATE OLD TASK')
  f.h.stores.useSyncStore.setState({errorMessage:'PRIVATE SYNC ERROR'})
  f.h.stores.useTimerStore.setState({taskId:'private-task',taskTitle:'PRIVATE TIMER',isRunning:true})
  f.h.stores.useAttachmentStore.setState({attachments:{private:{id:'private',filename:'PRIVATE ATTACHMENT'}}})
  f.h.stores.useNotificationStore.setState({notifications:[{id:'private',title:'PRIVATE NOTIFICATION'}],unreadCount:1})
  const pause=gate(),original=f.h.repo.tasks.findAllByProject.bind(f.h.repo.tasks);let held=false
  f.h.repo.tasks.findAllByProject=async(...args:unknown[])=>{const rows=original(...args);if(!held){held=true;pause.enter();await pause.wait;if(fail)throw Error('PRIVATE BOOT ERROR')}return rows}
  const old=f.h.stores.useTaskStore.getState().hydrateAllForUser('u')
  await pause.entered;const owner=f.h.stores.useAuthStore.getState().currentUser,offset=frames.length
  await act(async()=>{
    replace(f)
    expect(Object.keys(f.h.stores.useTaskStore.getState().tasks)).toHaveLength(0)
    expect(f.h.stores.useNotificationStore.getState().notifications).toEqual([])
    expect(f.h.stores.useAttachmentStore.getState().attachments).toEqual({})
    expect(f.h.stores.useTimerStore.getState().taskId).toBeNull()
    expect(f.h.stores.useSyncStore.getState().errorMessage).toBeNull()
    await f.h.untilIdle()
  })
  expect(f.h.stores.useAuthStore.getState().currentUser).toBe(owner)
  expect(f.host.textContent).toContain('CURRENT TASK')
  expect(f.host.textContent).toContain('CURRENT SETTING')
  expect(frames.slice(offset).every(frame=>!frame.includes('PRIVATE'))).toBe(true)
  await act(async()=>{pause.release();await old;await f.h.untilIdle()})
  expect(f.host.textContent).not.toContain('PRIVATE')
  expect(f.h.services.selectMyDayTasks(f.h.stores.useTaskStore.getState()).map((task:{id:string})=>task.id)).toContain('current-task')
  expect(f.h.services.db.prepare('SELECT title FROM tasks WHERE id=?').get('private-task').title).toBe('PRIVATE OLD TASK')
  expect(f.h.requests).toEqual([])
  expect(f.h.fixtureErrors).toEqual([])
  const count=f.h.nativeCalls.length
  await act(async()=>{f.h.stores.useAuthStore.setState({currentUser:{...owner}});f.root.render(createElement(Screen));await f.h.untilIdle()})
  expect(f.h.nativeCalls.length).toBe(count)
})
it.each(['stats','members'])('drops retained $mode component fields on native generation replacement',async mode=>{
  const f=await setup()
  f.h.stores.useAuthStore.setState({isOffline:false})
  function Screen():ReactElement{return mode==='stats'?createElement(f.h.services.StatsView):createElement(f.h.services.MemberSettings,{project:f.h.projects[0],onToast:()=>{}})}
  await act(async()=>{f.root.render(createElement(Screen));await f.h.untilIdle()})
  if(mode==='stats'){
    const button=[...f.host.querySelectorAll('[role="button"]')].find(button=>button.textContent?.includes('Open Tasks'))! as HTMLElement
    await act(async()=>{button.click();await f.h.untilIdle()})
    expect(f.host.textContent).toContain('PRIVATE OLD TASK')
  }else expect(f.host.textContent).toContain('PRIVATE OLD MEMBER')
  const owner=f.h.stores.useAuthStore.getState().currentUser
  await act(async()=>{replace(f);await f.h.untilIdle()})
  expect(f.h.stores.useAuthStore.getState().currentUser).toBe(owner)
  expect(f.host.textContent).not.toContain('PRIVATE OLD TASK')
  expect(f.host.textContent).not.toContain('PRIVATE OLD MEMBER')
  expect(f.host.textContent).toContain(mode==='stats'?'CURRENT PROJECT':'CURRENT MEMBER')
  expect(f.h.fixtureErrors).toEqual([])
})

it.each([false,true])('rejects an old Stats project snapshot after fresh native replacement (failure=%s)',async fail=>{
  const f=await setup(),pause=gate(),original=f.h.repo.tasks.getProjectBreakdown.bind(f.h.repo.tasks)
  let held=false
  f.h.repo.tasks.getProjectBreakdown=async(...args:unknown[])=>{const rows=original(...args);if(!held){held=true;pause.enter();await pause.wait;if(fail)throw Error('PRIVATE STATS ERROR')}return rows}
  await act(async()=>{f.root.render(createElement(f.h.services.StatsView));await new Promise(setImmediate)})
  await pause.entered
  await act(async()=>{replace(f);await f.h.untilIdle()})
  expect(f.host.textContent).toContain('CURRENT PROJECT')
  await act(async()=>{pause.release();await f.h.untilIdle()})
  expect(f.host.textContent).toContain('CURRENT PROJECT')
  expect(f.host.textContent).not.toContain('PRIVATE')
  expect(f.h.fixtureErrors).toEqual([])
})

it('keeps offline sync status while resetting private state on auth and native scope changes', async () => {
  const f = await setup(), owner = f.h.stores.useAuthStore.getState().currentUser
  f.h.stores.useAuthStore.setState({ currentUser: null, isAuthenticated: false, isOffline: false })
  f.h.stores.useSyncStore.getState().setError('PRIVATE OLD SYNC ERROR')
  f.h.stores.useAuthStore.setState({ currentUser: owner, isAuthenticated: true, isOffline: true })
  expect(f.h.stores.useSyncStore.getState().status).toBe('offline')
  expect(f.h.stores.useSyncStore.getState().errorMessage).toBeNull()
  f.h.replaceDatabase()
  expect(f.h.stores.useSyncStore.getState().status).toBe('offline')
  expect(f.h.stores.useSyncStore.getState().errorMessage).toBeNull()
})

it.each([false, true])('contains a late Statistics drilldown reply after native replacement (failure=%s)', async fail => {
  const f = await setup(), pause = gate()
  f.h.stores.useAuthStore.setState({ isOffline: false })
  const original = f.h.repo.tasks.getStatsTaskList.bind(f.h.repo.tasks)
  let held = false
  f.h.repo.tasks.getStatsTaskList = async (...args: unknown[]) => {
    const rows = original(...args)
    if (!held) { held = true; pause.enter(); await pause.wait; if (fail) throw Error('PRIVATE OLD DRILL ERROR') }
    return rows
  }
  await act(async () => { f.root.render(createElement(f.h.services.StatsView)); await f.h.untilIdle() })
  const open = [...f.host.querySelectorAll<HTMLElement>('[role="button"]')].find(button => button.textContent?.includes('Open Tasks'))!
  await act(async () => { open.click(); await new Promise(setImmediate) })
  await pause.entered
  await act(async () => { replace(f); await f.h.untilIdle() })
  await act(async () => { pause.release(); await f.h.untilIdle() })
  expect(f.host.textContent).toContain('CURRENT PROJECT')
  expect(f.host.textContent).not.toContain('PRIVATE')
  expect(f.host.querySelector('[role="alert"]')).toBeNull()
  expect(f.h.fixtureErrors).toEqual([])
})

it('shows a safe current drilldown error and retries successfully', async () => {
  const f = await setup()
  f.h.stores.useAuthStore.setState({ isOffline: false })
  const original = f.h.repo.tasks.getStatsTaskList.bind(f.h.repo.tasks)
  let failed = false
  f.h.repo.tasks.getStatsTaskList = (...args: unknown[]) => {
    if (!failed) { failed = true; throw Error('PRIVATE DATABASE ERROR DETAILS') }
    return original(...args)
  }
  await act(async () => { f.root.render(createElement(f.h.services.StatsView)); await f.h.untilIdle() })
  const open = [...f.host.querySelectorAll<HTMLElement>('[role="button"]')].find(button => button.textContent?.includes('Open Tasks'))!
  await act(async () => { open.click(); await f.h.untilIdle() })
  expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('Could not load these tasks')
  expect(f.host.textContent).not.toContain('PRIVATE DATABASE ERROR DETAILS')
  const retry = [...f.host.querySelectorAll('button')].find(button => button.textContent === 'Retry')!
  await act(async () => { retry.click(); await f.h.untilIdle() })
  expect(f.host.querySelector('[role="alert"]')).toBeNull()
  expect(f.host.textContent).toContain('PRIVATE OLD TASK')
  expect(f.h.fixtureErrors).toEqual([])
})

it.each(['generation-500', 'generation-200', 'eviction-500', 'eviction-200', 'current-unmount'])(
  'retains the original Statistics navigation scope through delayed selection (%s)',
  async boundary => {
    const f = await setup()
    f.h.stores.useAuthStore.setState({ isOffline: false })
    await f.h.stores.useTaskStore.getState().hydrateAllForUser('u')
    await act(async () => { f.root.render(createElement(f.h.services.StatsView)); await f.h.untilIdle() })
    const open = [...f.host.querySelectorAll<HTMLElement>('[role="button"]')].find(button => button.textContent?.includes('Open Tasks'))!
    await act(async () => { open.click(); await f.h.untilIdle() })
    const task = [...f.host.querySelectorAll<HTMLElement>('[role="button"]')].find(button => button.textContent?.includes('PRIVATE OLD TASK'))!
    await act(async () => { task.click(); await f.h.untilIdle() })
    const runDelay = async (milliseconds: number): Promise<void> => {
      for (const [id, job] of [...f.h.timers] as Array<[number, { ms: number; fn(): unknown }]>) {
        if (job.ms !== milliseconds) continue
        f.h.timers.delete(id)
        await job.fn()
      }
      await f.h.untilIdle()
    }
    if (boundary.endsWith('200')) await act(async () => runDelay(500))
    await act(async () => {
      if (boundary.startsWith('generation')) replace(f)
      else if (boundary.startsWith('eviction')) f.h.services.evictProjectData('p0')
      else f.root.render(createElement('div', null, 'Current project view'))
      await f.h.untilIdle()
    })
    await act(async () => { await runDelay(500); await runDelay(200) })
    const selected = f.h.stores.useTaskStore.getState().selectedTaskIds
    expect(selected.has('private-task')).toBe(boundary === 'current-unmount')
    expect(f.h.fixtureErrors).toEqual([])
  }
)

it.each([false, true])('drops warm or delayed Statistics fields after actual project revocation (held=%s)', async held => {
  const f = await setup(), pause = gate()
  f.h.stores.useAuthStore.setState({ isOffline: false })
  if (held) {
    const original = f.h.repo.tasks.getStatsTaskList.bind(f.h.repo.tasks)
    let used = false
    f.h.repo.tasks.getStatsTaskList = async (...args: unknown[]) => {
      const rows = original(...args)
      if (!used) { used = true; pause.enter(); await pause.wait }
      return rows
    }
  }
  await act(async () => { f.root.render(createElement(f.h.services.StatsView)); await f.h.untilIdle() })
  const open = [...f.host.querySelectorAll<HTMLElement>('[role="button"]')].find(button => button.textContent?.includes('Open Tasks'))!
  await act(async () => { open.click(); await f.h.untilIdle() })
  if (held) await pause.entered
  else expect(f.host.textContent).toContain('PRIVATE OLD TASK')
  const project = f.h.repo.projects.findById('p0')
  f.h.remote.project_members = f.h.remote.project_members.filter((member: { user_id: string }) => member.user_id !== 'u')
  await act(async () => {
    await f.h.services.shared.discoverRemoteMemberships('u', await f.h.context(), project)
    await f.h.untilIdle()
  })
  expect(f.h.stores.useProjectStore.getState().projects.p0).toBeUndefined()
  await act(async () => { pause.release(); await f.h.untilIdle() })
  expect(f.host.textContent).not.toContain('PRIVATE OLD TASK')
  expect(f.host.textContent).not.toContain('PRIVATE OLD PROJECT')
  expect(f.h.repo.tasks.findById('private-task').title).toBe('PRIVATE OLD TASK')
  expect(f.h.fixtureErrors).toEqual([])
})

it.each([false, true])('rejects a retained producer when an older context-probe reply follows a native signal (replace=%s)', async change => {
  const f = await setup(), pause = gate(), api = f.h.sandbox.window.api
  let captures = 0
  f.h.sandbox.window.api = new Proxy(api, {
    get: (target, namespace) => {
      const value = Reflect.get(target, namespace)
      if (namespace !== 'sync') return value
      return new Proxy(value, { get: (sync, method) => method === 'captureContext' ? async () => {
        const snapshot = await sync.captureContext()
        if (++captures === 2) { pause.enter(); await pause.wait }
        return snapshot
      } : Reflect.get(sync, method) })
    }
  })
  const origin = f.h.producer()
  await origin.scope()
  const current = origin.isCurrent()
  await pause.entered
  if (change) f.h.replaceDatabase()
  pause.release()
  expect(await current).toBe(!change)
  if (change) expect(() => origin.assertCurrent()).toThrow(/database/i)
  else expect(() => origin.assertCurrent()).not.toThrow()
  expect(f.h.fixtureErrors).toEqual([])
})

it('keeps a cold producer bound to its initial native reply when a newer signal arrives first', async () => {
  const f = await setup(), pause = gate(), api = f.h.sandbox.window.api
  let started = false
  f.h.sandbox.window.api = new Proxy(api, {
    get: (target, namespace) => {
      const value = Reflect.get(target, namespace)
      if (namespace !== 'sync') return value
      return new Proxy(value, { get: (sync, method) => {
        if (method === 'currentContext') return () => started ? sync.currentContext() : null
        if (method === 'captureContext') return async () => {
          const initial = !started
          started = true
          const snapshot = await sync.captureContext()
          if (initial) { pause.enter(); await pause.wait }
          return snapshot
        }
        return Reflect.get(sync, method)
      } })
    }
  })
  const origin = f.h.producer()
  await pause.entered
  f.h.replaceDatabase()
  pause.release()
  await origin.scope()
  expect(() => origin.assertCurrent()).toThrow(/database/i)
  expect(await origin.isCurrent()).toBe(false)
  expect(f.h.fixtureErrors).toEqual([])
})
