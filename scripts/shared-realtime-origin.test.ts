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
async function setup(){
  const h=await makeHarness({projectCount:1,shared:1,connected:false,sharedHook:true})
  h.repo.tasks.create({id:'t',owner_id:'u',project_id:'p0',status_id:'s0',title:'CURRENT TASK'})
  h.repo.users.update('other',{email:'shared-user+other@local'})
  let profile='BASE MEMBER',holdProfile=false,profileError=false
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
  f.h.repo.projects.addMember('p0','third','member')
  f.h.remote.project_members.push({...f.h.repo.projects.getMembers('p0').find((member:{user_id:string})=>member.user_id==='third')})
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
