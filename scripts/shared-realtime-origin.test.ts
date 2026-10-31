import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'})
vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document)
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
afterAll(()=>{dom.window.close();vi.unstubAllGlobals()})
const require=createRequire(import.meta.url)
const { makeHarness }=require('./benchmark-sync.cjs')
const opened:Array<{h:Awaited<ReturnType<typeof makeHarness>>;root:Root;host:HTMLDivElement}>=[]
afterEach(async()=>{for(const item of opened.splice(0)){await act(async()=>item.root.unmount());item.host.remove();await item.h.stop()}})
function gate(){let enter!:()=>void,release!:()=>void;return{entered:new Promise<void>(resolve=>{enter=resolve}),wait:new Promise<void>(resolve=>{release=resolve}),enter:()=>enter(),release:()=>release()}}
async function setup(beforeRender: (h: Awaited<ReturnType<typeof makeHarness>>) => void = () => {}, initialProfileError = false){
  const h=await makeHarness({projectCount:1,shared:1,connected:false,sharedHook:true})
  h.repo.tasks.create({id:'t',owner_id:'u',project_id:'p0',status_id:'s0',title:'CURRENT TASK'})
  h.repo.users.update('other',{email:'shared-user+other@local'})
  let profile='BASE MEMBER',holdProfile=false,profileError=initialProfileError
  const pause=gate()
  const fetch=h.sandbox.fetch
  h.sandbox.fetch=async(url:string,init:RequestInit)=>{
    if(new URL(url).pathname.endsWith('/rpc/get_user_profiles')){
      const rows=JSON.parse(String(init.body)).p_user_ids.map((id:string)=>({id,email:id+'@example.invalid',display_name:profile,avatar_url:null}))
      const failed=profileError
      if(holdProfile){holdProfile=false;pause.enter();await pause.wait}
      if(failed)return new Response(JSON.stringify({message:'PRIVATE LATE ERROR'}),{status:500,headers:{'Content-Type':'application/json'}})
      return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}})
    }
    return fetch(url,init)
  }
  beforeRender(h)
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);opened.push({h,root,host})
  function Screen(){const user=h.stores.useAuthStore(state=>state.currentUser);const state=h.services.useSharedProjectRealtime(h.projects[0],user);return createElement('div',null,JSON.stringify(state.projectMembers))}
  await act(async()=>{root.render(createElement(Screen));await h.untilIdle()})
  const channel=h.channels.find((row:{topic:string;closed:boolean})=>row.topic==='project:p0'&&!row.closed)
  expect(channel).toBeDefined()
  return {h,root,host,channel,pause,arm:()=>{profile='PRIVATE LATE PROFILE';holdProfile=true},failProfiles:(failed:boolean)=>{profileError=failed},current:()=>{profile='CURRENT MEMBER';profileError=false}}
}
it.each(['activity','member'].flatMap(table=>['account','generation','teardown','eviction'].map(change=>({table,change}))))('rejects retained $table bridge after $change',async({table,change})=>{
  const f=await setup(),owner=f.h.stores.useAuthStore.getState().currentUser
  if(change==='account')await act(async()=>{f.h.setAccount('other');await f.h.untilIdle()})
  else if(change==='generation'){f.h.replaceDatabase();expect(f.h.stores.useAuthStore.getState().currentUser).toBe(owner)}
  else if(change==='teardown')await f.h.services.shared.unsubscribeFromProject('p0')
  else f.h.services.evictProjectData('p0')
  const calls=f.h.nativeCalls.length
  f.channel.emit(table==='activity'?'activity_log':'project_members','INSERT',{id:'old-event',task_id:'t',project_id:'p0',user_id:'other',action:'PRIVATE ACTION',old_value:'PRIVATE OLD',new_value:'PRIVATE NEW',created_at:'2030-01-01T00:00:00.000Z'})
  await act(async()=>{await f.h.untilIdle()})
  expect(f.h.repo.activityLog.findByTaskId('t')).toEqual([])
  expect(f.h.nativeCalls.slice(calls)).toEqual([])
  expect(f.host.textContent).not.toContain('PRIVATE')
  expect(f.h.fixtureErrors).toEqual([])
})
it.each(['profile','user update','member update','activity native'].flatMap(point=>['account','generation','cleanup','teardown','eviction'].flatMap(change=>[false,true].map(fail=>({point,change,fail})))))(
  'fences shared $point success/error across $change (failure=$fail)',async({point,change,fail})=>{
    const f=await setup(),pause=point==='profile'?f.pause:gate()
    if(point==='profile')f.arm()
    else {
      const ns=point==='user update'?'users':point==='member update'?'projects':'activityLog',method=point==='user update'?'update':point==='member update'?'updateMember':'applyRemote'
      if(point==='user update')f.h.repo.users.update('other',{email:'shared-user+other@local'})
      const original=f.h.repo[ns][method].bind(f.h.repo[ns]);let held=false
      f.h.repo[ns][method]=async(...args:unknown[])=>{const value=original(...args);if(!held){held=true;pause.enter();await pause.wait;if(fail)throw Error('PRIVATE LATE ERROR')}return value}
    }
    if(point==='profile'&&fail)f.failProfiles(true)
    const table=point==='activity native'?'activity_log':'project_members'
    await act(async()=>{f.channel.emit(table,'INSERT',{id:'held-event',task_id:'t',project_id:'p0',user_id:'other',action:'PRIVATE ACTION',old_value:'PRIVATE VALUE',created_at:'2030-01-01T00:00:00.000Z'});await f.h.untilIdle()})
    await pause.entered;f.current()
    const owner=f.h.stores.useAuthStore.getState().currentUser
    await act(async()=>{
      if(change==='account')await act(async()=>{f.h.setAccount('other');await f.h.untilIdle()})
      else if(change==='generation'){f.h.replaceDatabase();expect(f.h.stores.useAuthStore.getState().currentUser).toBe(owner)}
      else if(change==='cleanup')f.root.unmount()
      else if(change==='teardown')await f.h.services.shared.unsubscribeFromProject('p0')
      else f.h.services.evictProjectData('p0')
      await f.h.untilIdle()
    })
    const calls=f.h.nativeCalls.length,entries=f.h.stores.useLogStore.getState().entries
    await act(async()=>{pause.release();await f.h.untilIdle()})
    expect(f.h.nativeCalls.slice(calls)).toEqual([])
    expect(f.host.textContent).not.toContain('PRIVATE')
    expect(f.h.stores.useTaskStore.getState().activityRefresh.t).toBeUndefined()
    expect(f.h.stores.useLogStore.getState().entries).toBe(entries)
    expect(f.h.fixtureErrors).toEqual([])
  },15000)
it('preserves normal current shared member and activity application',async()=>{
  const f=await setup()
  expect(f.host.textContent).toContain('BASE MEMBER')
  f.channel.emit('activity_log','INSERT',{id:'current-event',task_id:'t',project_id:'p0',user_id:'other',action:'updated',old_value:'Before',new_value:'After',created_at:'2030-01-01T00:00:00.000Z'})
  await act(async()=>{await f.h.untilIdle()})
  expect(f.h.repo.activityLog.findByTaskId('t')[0]).toMatchObject({old_value:'Before',new_value:'After'})
  expect(f.h.stores.useTaskStore.getState().activityRefresh.t).toBe(1)
  expect(f.h.fixtureErrors).toEqual([])
})

it('refreshes the authoritative member list from local profiles when profile lookup fails',async()=>{
  const f=await setup()
  f.h.repo.users.create({id:'third',email:'third@example.invalid',display_name:'Third member',avatar_url:null})
  f.h.remote.project_members.push({project_id:'p0',user_id:'third',role:'member',joined_at:'2026-10-01T10:00:00.000Z'})
  await act(async()=>{f.channel.emit('project_members','INSERT',{project_id:'p0',user_id:'third'});await f.h.untilIdle()})
  expect(JSON.parse(f.host.textContent??'[]')).toHaveLength(3)
  f.h.remote.project_members=f.h.remote.project_members.filter((member:{user_id:string})=>member.user_id!=='third')
  f.h.repo.projects.removeMember('p0','third')
  f.failProfiles(true)
  await act(async()=>{f.channel.emit('project_members','DELETE',{project_id:'p0',user_id:'third'});await f.h.untilIdle()})
  const members=JSON.parse(f.host.textContent??'[]')
  expect(members).toHaveLength(2)
  expect(members.map((member:{user_id:string})=>member.user_id).sort()).toEqual(['other','u'])
  expect(members.every((member:{email:string})=>member.email.endsWith('@example.invalid'))).toBe(true)
  expect(f.h.fixtureErrors).toEqual([])
})

function remoteJoin(h: Awaited<ReturnType<typeof makeHarness>>, existing: boolean, id = 'new-member') {
  if (existing) h.repo.users.create({id,email:id+'@example.invalid',display_name:'LOCAL PROFILE',avatar_url:null})
  const member = {project_id:'p0',user_id:id,role:'member',joined_at:'2026-10-01T10:00:00.000Z',display_color:'#123456',display_initials:'NM'}
  h.remote.project_members.push(member)
  return member
}

it.each(['initial','live'].flatMap(path => [false,true].map(existing => ({path,existing}))))('reconciles $path joins with an existing user=$existing before publishing avatars',async ({path,existing}) => {
  let member: ReturnType<typeof remoteJoin> | undefined
  const f = await setup(h => { if (path === 'initial') member = remoteJoin(h,existing) })
  if (path === 'live') {
    member = remoteJoin(f.h,existing)
    await act(async () => { f.channel.emit('project_members','INSERT',member); await f.h.untilIdle() })
  }
  expect(f.h.repo.projects.getMembers('p0').find((row:{user_id:string}) => row.user_id==='new-member')).toMatchObject(member!)
  expect(JSON.parse(f.host.textContent ?? '[]').find((row:{user_id:string}) => row.user_id==='new-member')).toMatchObject({email:'new-member@example.invalid',display_name:'BASE MEMBER',role:'member'})
  expect(f.h.services.getMemberDisplay('p0','new-member')).toMatchObject({color:'#123456',initials:'NM',email:'new-member@example.invalid'})
  expect(f.h.requests.filter((request:{table:string;method:string}) => request.table==='project_members'&&request.method!=='GET')).toEqual([])
  expect(f.h.logs).toEqual([])
  expect(f.h.fixtureErrors).toEqual([])
})

it('uses separate missing-profile identities and later enriches remote joins after RPC failure',async () => {
  const f = await setup(h => { remoteJoin(h,false,'new-a'); remoteJoin(h,false,'new-b') },true)
  for (const id of ['new-a','new-b']) {
    expect(f.h.repo.users.findById(id).email).toBe('shared-user+'+id+'@local')
    expect(f.h.repo.projects.getMembers('p0').some((row:{user_id:string}) => row.user_id===id)).toBe(true)
  }
  f.current()
  await act(async () => { f.channel.emit('project_members','UPDATE',{project_id:'p0',user_id:'new-a'}); await f.h.untilIdle() })
  for (const id of ['new-a','new-b']) {
    expect(f.h.repo.users.findById(id)).toMatchObject({email:id+'@example.invalid',display_name:'CURRENT MEMBER'})
    expect(f.h.services.getMemberDisplay('p0',id)).toMatchObject({email:id+'@example.invalid',display_name:'CURRENT MEMBER'})
  }
  expect(f.h.fixtureErrors).toEqual([])
})

it.each(['create','addMember'].flatMap(method => ['account','generation','cleanup','teardown','eviction'].flatMap(change => [false,true].map(fail => ({method,change,fail})))))(
  'fences missing-member $method success/error after $change (failure=$fail)',async ({method,change,fail}) => {
    const f = await setup(), pause=gate(), ns=method==='create'?'users':'projects'
    const original=f.h.repo[ns][method].bind(f.h.repo[ns]); let held=false
    f.h.repo[ns][method]=async (...args:unknown[]) => {
      const result=original(...args)
      if (!held) { held=true; pause.enter(); await pause.wait; if(fail) throw Error('PRIVATE JOIN ERROR') }
      return result
    }
    const member=remoteJoin(f.h,false)
    await act(async () => { f.channel.emit('project_members','INSERT',member); await f.h.untilIdle() })
    await pause.entered
    if (change==='account') await act(async () => {f.h.setAccount('other');await f.h.untilIdle()})
    else if (change==='generation') f.h.replaceDatabase()
    else if (change==='cleanup') await act(async () => f.root.unmount())
    else if (change==='teardown') await f.h.services.shared.unsubscribeFromProject('p0')
    else f.h.services.evictProjectData('p0')
    const calls=f.h.nativeCalls.length,entries=f.h.stores.useLogStore.getState().entries
    await act(async () => {pause.release();await f.h.untilIdle()})
    expect(f.h.nativeCalls.slice(calls)).toEqual([])
    if (change === 'account') expect(f.host.textContent).toContain('new-member')
    else expect(f.host.textContent).not.toContain('new-member')
    expect(f.h.stores.useLogStore.getState().entries).toBe(entries)
    expect(f.h.fixtureErrors).toEqual([])
  })
