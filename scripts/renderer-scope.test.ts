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
