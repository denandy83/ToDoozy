import { createRequire } from 'node:module'
import { act, createElement, useLayoutEffect, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import type { User } from '../src/shared/types'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'})
vi.stubGlobal('window',dom.window)
vi.stubGlobal('document',dom.window.document)
afterAll(()=>{dom.window.close();vi.unstubAllGlobals()})
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Array<{h: Awaited<ReturnType<typeof makeHarness>>; root:Root; host:HTMLDivElement}> = []
const response = (data: unknown, status=200): Response => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
const invite = (token: string): {token:string;project_id:string;project_name:string;owner_email:string;status:string;expires_at:string} => ({token,project_id:'joined',project_name:token,owner_email:'OWNER '+token,status:'pending',expires_at:'2099-01-01T00:00:00Z'})
interface Gate { entered:Promise<void>; wait:Promise<void>; enter():void; release():void }
function gate(): Gate {
  let enter!: () => void, release!: () => void
  return {entered:new Promise<void>(resolve => {enter=resolve}),wait:new Promise<void>(resolve => {release=resolve}),enter:()=>enter(),release:()=>release()}
}
type Point = 'pending'|'deep-link'|'realtime'|'accept'|'decline'|'sync-down'|'hydration'|'project-subscription'|'invite-subscription'
interface InvitationFixture {
  h: Awaited<ReturnType<typeof makeHarness>>
  host: HTMLDivElement
  pause: Gate
  mount(): Promise<void>
  open(token:string): Promise<void>
  click(label:string): Promise<void>
  idle(): Promise<void>
  change(kind:'account'|'database'): Promise<void>
  layoutSnapshots: string[]
  arm(): void
  pendingReads(): number
  mutations: string[]
  setPending(tokens:string[]): void
}
async function setup(point?:Point, fail=false): Promise<InvitationFixture> {
  const h=await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:1,invitations:true,connected:false})
  const host=document.createElement('div'); document.body.append(host)
  const root=createRoot(host); opened.push({h,root,host})
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  const user=(id:string):User=>({id,email:id+'@example.invalid',display_name:null,avatar_url:null,created_at:'',updated_at:''})
  h.stores.useAuthStore.setState({currentUser:user('u'),isAuthenticated:true,isOffline:false})
  h.stores.useViewStore.setState({currentView:'project',selectedProjectId:'p0'})
  const joined={...h.repo.projects.findById('p0'),id:'joined',owner_id:'other',name:'PRIVATE JOINED',is_shared:1}
  h.remote.projects.push(joined)
  h.remote.project_members.push({project_id:'joined',user_id:'u',role:'member',joined_at:'2026-01-01T00:00:00Z'},{project_id:'joined',user_id:'other',role:'owner',joined_at:'2026-01-01T00:00:00Z'})
  h.remote.statuses.push({...h.repo.statuses.findByProjectId('p0')[0],id:'joined-status',project_id:'joined'})
  const pause=gate()
  const mutations:string[]=[]
  let pendingReadCount=0
  let blocked=false,armed=false,pending=[invite('PRIVATE FIRST'),invite('PRIVATE QUEUED')]
  const hold=async <T,>(value:T):Promise<T> => {
    if (!armed || blocked) return value
    blocked=true; pause.enter(); await pause.wait
    if(fail) throw Error('PRIVATE LATE FAILURE')
    return value
  }
  const originalFetch=h.sandbox.fetch
  h.sandbox.fetch=async (url: string, init: RequestInit) => {
    const path=new URL(String(url)).pathname.split('/').pop()
    if (!String(url).includes('/rpc/')) return originalFetch(url,init)
    const body=JSON.parse(String(init?.body??'{}'))
    let result:unknown
    if(path==='get_pending_invites_for_email') {pendingReadCount++;result=body.user_email === h.stores.useAuthStore.getState().currentUser?.email ? pending : []}
    else if(path==='validate_invite') result=body.invite_token==='EXPIRED' ? [] : [invite(body.invite_token)]
    else if(path==='accept_invite') {mutations.push(path);result='joined'}
    else if(path==='decline_invite') {mutations.push(path);result=body.invite_token==='PUBLIC'?'dismissed':'declined'}
    else return originalFetch(url,init)
    if ((point==='pending'&&path==='get_pending_invites_for_email') || ((point==='deep-link'||point==='realtime')&&path==='validate_invite') || (point==='accept'&&path==='accept_invite') || (point==='decline'&&path==='decline_invite')) {
      try { return response(await hold(result)) } catch { return response({code:'42501',message:'PRIVATE LATE FAILURE'},403) }
    }
    return response(result)
  }
  const api=h.sandbox.window.api
  h.sandbox.window.api=new Proxy(api,{get(target,namespace){
    if(namespace!=='sync') return target[namespace]
    return new Proxy(target.sync,{get(sync,method){
      if(method!=='invokeContext') return sync[method]
      return async (origin:unknown,channel:string,args:unknown[])=>{
        if(armed&&!blocked&&((point==='sync-down'&&channel==='projects:applyRemote'&&(args[0] as {id:string}).id==='joined') || (point==='hydration'&&channel==='projects:getProjectsForUser'&&h.repo.projects.findById('joined')))) await hold(undefined)
        return sync.invokeContext(origin,channel,args)
      }
    }})
  }})
  const originalClient=h.sandbox.runtime.getSupabase
  h.sandbox.runtime.getSupabase=async ()=>{
    const client=await originalClient()
    if(point==='invite-subscription' || (point==='project-subscription'&&h.repo.projects.findById('joined'))) return hold(client)
    return client
  }
  const layoutSnapshots:string[]=[]
  function Screen(): ReactElement {
    const state=h.stores.useAuthStore()
    useLayoutEffect(()=>{layoutSnapshots.push(host.textContent??'')},[state.currentUser])
    return createElement(h.services.InvitationApp)
  }
  const idle=async():Promise<void>=>{await act(async()=>{await h.untilIdle()})}
  const mount=async():Promise<void>=>{await act(async()=>{root.render(createElement(Screen));await h.untilIdle()})}
  const open=async(token:string):Promise<void>=>{await act(async()=>{void h.emitInvite(token);await h.untilIdle()})}
  const click=async(label:string):Promise<void>=>{
    const button=[...host.querySelectorAll('button')].find(node=>node.textContent===label)
    expect(button,host.textContent??'').toBeDefined()
    await act(async()=>{button!.click();await h.untilIdle()})
  }
  const change=async(kind:'account'|'database'):Promise<void>=>{
    pending=[invite('CURRENT INVITE')]
    await act(async()=>{
      if(kind==='account') {h.setAccount('other');h.stores.useAuthStore.setState({currentUser:user('other')})}
      else h.replaceDatabase()
      h.stores.useProjectStore.setState({projects:{p0:{...h.repo.projects.findById('p0'),name:'CURRENT CACHE'}},members:{},currentProjectId:'p0',error:'CURRENT ERROR',loading:false})
      h.stores.useViewStore.setState({currentView:'project',selectedProjectId:'p0'})
      await h.untilIdle()
    })
  }
  return {h,host,pause,mount,open,click,idle,change,layoutSnapshots,mutations,pendingReads:()=>pendingReadCount,arm:()=>{armed=true},setPending:(tokens:string[])=>{pending=tokens.map(invite)}}
}
afterEach(async()=>{
  for(const {h,root,host} of opened.splice(0)) {
    await act(async()=>{root.unmount();await h.untilIdle()})
    host.remove();await h.stop()
  }
})
const points:Point[]=['pending','deep-link','realtime','accept','decline','sync-down','hydration','project-subscription','invite-subscription']
it.each(points.flatMap(point=>['account','database'].flatMap(kind=>[false,true].map(fail=>({point,kind:kind as 'account'|'database',fail})))))(
  'executes actual App invitation $point boundary across $kind replacement (late error=$fail)', async({point,kind,fail})=>{
    const f=await setup(point,fail)
    if(point==='pending'||point==='invite-subscription') f.arm()
    if(point==='deep-link'||point==='realtime') f.setPending([])
    await f.mount()
    if(point==='deep-link') {f.arm();await f.open('PRIVATE LINK')}
    else if(point==='realtime') {
      f.arm()
      const channel=f.h.channels.find((row:{topic:string;closed:boolean})=>row.topic==='invites:u@example.invalid'&&!row.closed)
      expect(channel).toBeDefined()
      await act(async()=>{channel.emit('project_invites','INSERT',{token:'PRIVATE REALTIME',status:'pending'});await f.h.untilIdle()})
    } else if(['accept','decline','sync-down','hydration','project-subscription'].includes(point)) {
      expect(f.host.textContent).toContain('PRIVATE FIRST')
      f.arm();await f.click(point==='decline'?'Decline':'Accept')
    }
    await f.pause.entered
    await f.change(kind)
    if(kind==='account') expect(f.layoutSnapshots.at(-1)).not.toContain('PRIVATE')
    const native=f.h.nativeCalls.length
    await act(async()=>{f.pause.release();await f.h.untilIdle()})
    await f.idle()
    expect(f.host.textContent).not.toContain('PRIVATE')
    expect(f.host.querySelector('[role="alert"]')).toBeNull()
    expect(f.h.stores.useProjectStore.getState().projects.p0.name).toBe('CURRENT CACHE')
    expect(f.h.stores.useProjectStore.getState().currentProjectId).toBe('p0')
    expect(f.h.stores.useProjectStore.getState().error).toBe('CURRENT ERROR')
    expect(f.h.stores.useViewStore.getState().selectedProjectId).toBe('p0')
    expect(f.h.nativeCalls.slice(native).filter((row:{namespace:string})=>!['log','auth'].includes(row.namespace))).toEqual([])
    expect(f.h.channels.filter((row:{topic:string;closed:boolean})=>!row.closed&&(row.topic==='project:joined'||row.topic==='invites:u@example.invalid'&&kind==='account'))).toEqual([])
    expect(JSON.stringify(f.h.logs)).not.toContain('PRIVATE LATE FAILURE')
    expect(f.h.fixtureErrors).toEqual([])
    expect(f.h.codeFingerprint).toMatch(/^[a-f0-9]{64}$/)
  },15000)

it('runs normal queued acceptance, native hydration, subscription and acknowledged decline through actual App wiring',async()=>{
  const f=await setup();await f.mount()
  expect(f.host.textContent).toContain('PRIVATE FIRST')
  await f.click('Accept')
  expect(f.h.repo.projects.findById('joined').name).toBe('PRIVATE JOINED')
  expect(f.h.stores.useProjectStore.getState().projects.joined.name).toBe('PRIVATE JOINED')
  expect(f.h.stores.useViewStore.getState().selectedProjectId).toBe('joined')
  expect(f.h.channels.some((row:{topic:string;closed:boolean})=>row.topic==='project:joined'&&!row.closed)).toBe(true)
  expect(f.host.textContent).toContain('PRIVATE QUEUED')
  await f.click('Decline');expect(f.host.querySelector('button')).toBeNull()
  expect(f.h.fixtureErrors).toEqual([])
})
it.each(['Accept','Decline'])('retains actual SDK %s errors and permits retry',async action=>{
  const f=await setup(action==='Accept'?'accept':'decline',true);await f.mount();f.arm();await f.click(action)
  await f.pause.entered;await act(async()=>{f.pause.release();await f.h.untilIdle()})
  expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('PRIVATE LATE FAILURE')
  expect(f.host.textContent).toContain('PRIVATE FIRST')
  await f.click(action);expect(f.host.textContent).toContain('PRIVATE QUEUED')
})
it.each(['Accept','Decline'].flatMap(action=>[false,true].map(fail=>({action,fail}))))('keeps a newer token selected after held $action response (failure=$fail)',async({action,fail})=>{
  const f=await setup(action==='Accept'?'accept':'decline',fail);await f.mount();f.arm();await f.click(action)
  await f.pause.entered;await f.open('NEWER TOKEN')
  await act(async()=>{f.pause.release();await f.h.untilIdle()})
  expect(f.host.textContent).toContain('NEWER TOKEN')
  expect(f.host.textContent).not.toContain('PRIVATE FIRST')
  expect(f.h.stores.useViewStore.getState().selectedProjectId).toBe('p0')
})
it('dismisses expired and public invitations through the actual dialog and service',async()=>{
  const f=await setup();f.setPending([]);await f.mount()
  await f.open('EXPIRED');expect(f.host.textContent).toContain('Invite Expired');await f.click('OK')
  expect(f.host.querySelector('button')).toBeNull()
  await f.open('PUBLIC');await f.click('Decline');expect(f.host.querySelector('button')).toBeNull()
  expect(f.h.repo.projects.findById('joined')).toBeUndefined()
})
it('rebinds a known same-user database generation after a stale realtime validation',async()=>{
  const f=await setup('realtime');f.setPending([]);await f.mount();f.arm()
  const channel=f.h.channels.find((row:{topic:string})=>row.topic==='invites:u@example.invalid')
  await act(async()=>{channel.emit('project_invites','INSERT',{token:'PRIVATE REALTIME',status:'pending'});await f.h.untilIdle()})
  await f.pause.entered;await f.change('database')
  await act(async()=>{f.pause.release();await f.h.untilIdle()})
  expect(f.host.textContent).toContain('CURRENT INVITE')
  expect(f.h.channels.filter((row:{topic:string;closed:boolean})=>row.topic==='invites:u@example.invalid'&&!row.closed)).toHaveLength(1)
  expect(channel.closed).toBe(true)
})
it('does not loop retries when the native context becomes unavailable',async()=>{
  const f=await setup();await f.mount()
  const original=f.h.sandbox.window.api
  let calls=0
  f.h.sandbox.window.api=new Proxy(original,{get(target,namespace){
    if(namespace!=='sync') return target[namespace]
    return new Proxy(target.sync,{get(sync,method){
      if(method!=='captureContext') return sync[method]
      return async()=>{calls++;throw Error('IPC unavailable')}
    }})
  }})
  await f.click('Accept')
  const before=calls;await f.idle();await f.idle()
  expect(calls).toBe(before)
  expect(f.h.channels.filter((row:{topic:string;closed:boolean})=>row.topic==='project:joined'&&!row.closed)).toHaveLength(0)
  expect(f.host.querySelector('[role="alert"]')).toBeNull()
})
it('removes an invitation subscription that resolves after unmount',async()=>{
  const f=await setup('invite-subscription');f.arm();await f.mount();await f.pause.entered
  const item=opened.find(item=>item.h===f.h)!
  await act(async()=>{item.root.unmount()})
  await act(async()=>{f.pause.release();await f.h.untilIdle()})
  expect(f.h.channels.filter((row:{closed:boolean})=>!row.closed)).toHaveLength(0)
})

it.each([false,true])('preserves newer deep-link validation when the older response settles (failure=%s)',async fail=>{
  const f=await setup('deep-link',fail);f.setPending([]);await f.mount();f.arm();await f.open('PRIVATE OLD TOKEN')
  await f.pause.entered;await f.open('NEWER TOKEN')
  await act(async()=>{f.pause.release();await f.h.untilIdle()})
  expect(f.host.textContent).toContain('NEWER TOKEN')
  expect(f.host.textContent).not.toContain('PRIVATE OLD TOKEN')
  expect(f.host.querySelector('[role="alert"]')).toBeNull()
})
it('calls a late-arriving unsubscriber after the actual invitation channel is created',async()=>{
  const f=await setup();f.setPending([])
  const item=opened.find(item=>item.h===f.h)!
  const client=f.h.sandbox.runtime.client,original=client.channel
  client.channel=(topic:string)=>{
    const channel=original(topic),subscribe=channel.subscribe
    channel.subscribe=function(callback:unknown){
      const result=subscribe.call(this,callback)
      queueMicrotask(()=>item.root.unmount())
      return result
    }
    return channel
  }
  await f.mount();await f.idle()
  expect(f.h.channels).toHaveLength(1)
  expect(f.h.channels[0].closed).toBe(true)
  expect(f.h.fixtureErrors).toEqual([])
})

it('replaces an already-rendered inbox on a native scope announcement without replacing the User object',async()=>{
  const f=await setup();await f.mount()
  const owner=f.h.stores.useAuthStore.getState().currentUser
  expect(f.host.textContent).toContain('PRIVATE FIRST')
  f.setPending(['CURRENT WARM INVITE'])
  const before=f.pendingReads()
  await act(async()=>{f.h.replaceDatabase();await f.h.untilIdle()})
  expect(f.h.stores.useAuthStore.getState().currentUser).toBe(owner)
  expect(f.host.textContent).not.toContain('PRIVATE FIRST')
  expect(f.host.textContent).not.toContain('PRIVATE QUEUED')
  expect(f.host.textContent).toContain('CURRENT WARM INVITE')
  expect(f.pendingReads()-before).toBe(1)
  expect(f.h.channels.filter((c:{topic:string;closed:boolean})=>c.topic==='invites:u@example.invalid'&&!c.closed)).toHaveLength(1)
  expect(f.h.fixtureErrors).toEqual([])
})

it.each(['Accept','Decline'])('reserves the first %s action before a delayed native probe',async first=>{
  const f=await setup();await f.mount()
  const pause=gate(),api=f.h.sandbox.window.api
  let armed=true,held=false
  f.h.sandbox.window.api=new Proxy(api,{get(target,namespace){
    if(namespace!=='sync')return target[namespace]
    return new Proxy(target.sync,{get(sync,method){
      if(method!=='captureContext')return sync[method]
      return async()=>{const result=await sync.captureContext();if(armed&&!held){held=true;pause.enter();await pause.wait}return result}
    }})
  }})
  const calls=f.mutations
  await f.click(first);await pause.entered
  await f.click(first==='Accept'?'Decline':'Accept')
  await f.idle();expect(calls).toEqual([])
  armed=false;pause.release();await f.idle()
  expect(calls).toEqual([first==='Accept'?'accept_invite':'decline_invite'])
  expect(f.h.fixtureErrors).toEqual([])
})
