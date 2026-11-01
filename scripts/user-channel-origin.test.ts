import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
const tables = [
  { table:'user_labels', namespace:'labels', read:'findAllForUser', cache:'useLabelStore' },
  { table:'user_saved_views', namespace:'savedViews', read:'findByUserId', cache:'useSavedViewStore' },
  { table:'user_project_areas', namespace:'projectAreas', read:'findByUserId', cache:'useProjectAreaStore' }
]
async function setup(entry: typeof tables[number]) {
  const h=await makeHarness({projectCount:1,connected:false});opened.push(h)
  const current=h.repo[entry.namespace].create({id:'record',user_id:'u',project_id:'p0',name:'CURRENT',filter_config:'{}'})
  h.stores.useProjectStore.setState({currentProjectId:'p0'})
  if(entry.namespace==='labels') await h.stores.useLabelStore.getState().hydrateAllLabels()
  else await h.stores[entry.cache].getState().hydrate('u')
  await h.services.user.subscribeToUserChannel('u')
  const channel=h.channels.find((row:{topic:string})=>row.topic==='user:u')
  const stale={...current,name:'PRIVATE OLD PAYLOAD',updated_at:'2099-01-01T00:00:00.000Z'}
  return {h,channel,stale}
}
function gate() {
  let enter!:()=>void,release!:()=>void
  return {entered:new Promise<void>(resolve=>{enter=resolve}),wait:new Promise<void>(resolve=>{release=resolve}),enter:()=>enter(),release:()=>release()}
}
it.each(tables.flatMap(entry=>['account','generation','cleanup'].map(change=>({...entry,change}))))('rejects retained $table callbacks after $change',async entry=>{
  const {h,channel,stale}=await setup(entry)
  const owner=h.stores.useAuthStore.getState().currentUser
  if(entry.change==='account')h.setAccount('other')
  else if(entry.change==='generation'){h.replaceDatabase();expect(h.stores.useAuthStore.getState().currentUser).toBe(owner)}
  else await h.services.user.unsubscribeUserChannel()
  const before=h.stores[entry.cache].getState(),calls=h.nativeCalls.length
  channel.emit(entry.table,'UPDATE',stale);await h.untilIdle()
  expect(h.repo[entry.namespace].findById('record').name).toBe('CURRENT')
  expect(h.stores[entry.cache].getState()).toBe(before)
  expect(h.nativeCalls.slice(calls)).toEqual([])
  expect(h.fixtureErrors).toEqual([])
})
it.each(tables.flatMap(entry=>['applyRemote',entry.read,...(entry.namespace==='labels'?['findByProjectId']:entry.namespace==='savedViews'?['countMatchingTasks']:[])].flatMap(point=>['account','generation','cleanup'].flatMap(change=>[false,true].map(fail=>({...entry,point,change,fail}))))))(
  'fences $table held $point reply across $change (late error=$fail)',async entry=>{
    const {h,channel,stale}=await setup(entry),pause=gate()
    const methods=h.repo[entry.namespace],original=methods[entry.point].bind(methods)
    let held=false
    methods[entry.point]=async(...args:unknown[])=>{
      const value=original(...args)
      if(!held){held=true;pause.enter();await pause.wait;if(entry.fail)throw Error('PRIVATE OLD ERROR')}
      return value
    }
    channel.emit(entry.table,'UPDATE',stale);await pause.entered
    const owner=h.stores.useAuthStore.getState().currentUser
    if(entry.change==='account')h.setAccount('other')
    else if(entry.change==='generation'){h.replaceDatabase();expect(h.stores.useAuthStore.getState().currentUser).toBe(owner)}
    else await h.services.user.unsubscribeUserChannel()
    h.repo[entry.namespace].update('record',{name:'REPLACEMENT'})
    if(entry.namespace==='labels')h.stores[entry.cache].setState({labels:{record:{...stale,name:'REPLACEMENT'}},error:'CURRENT ERROR',loading:false})
    else if(entry.namespace==='savedViews')h.stores[entry.cache].setState({views:[{...stale,name:'REPLACEMENT'}],viewCounts:{record:91},loading:false})
    else h.stores[entry.cache].setState({areas:[{...stale,name:'REPLACEMENT'}],loading:false})
    const before=h.stores[entry.cache].getState(),calls=h.nativeCalls.length,logs=h.logs.length,entries=h.stores.useLogStore.getState().entries
    pause.release();await h.untilIdle()
    expect(h.repo[entry.namespace].findById('record').name).toBe('REPLACEMENT')
    expect(h.stores[entry.cache].getState()).toBe(before)
    expect(h.nativeCalls.slice(calls)).toEqual([])
    expect(h.logs.slice(logs)).toEqual([])
    expect(h.stores.useLogStore.getState().entries).toBe(entries)
    expect(h.fixtureErrors).toEqual([])
  },15000)
it.each(tables)('preserves current-origin $table updates, tombstones and DELETE reconciliation semantics',async entry=>{
  const {h,channel,stale}=await setup(entry)
  channel.emit(entry.table,'UPDATE',stale);await h.untilIdle()
  expect(h.repo[entry.namespace].findById('record').name).toBe('PRIVATE OLD PAYLOAD')
  const state=h.stores[entry.cache].getState()
  expect(entry.namespace==='labels'?state.labels.record.name:entry.namespace==='savedViews'?state.views[0].name:state.areas[0].name).toBe('PRIVATE OLD PAYLOAD')
  const before=h.nativeCalls.length
  channel.emit(entry.table,'DELETE',{id:'record'});await h.untilIdle()
  expect(h.nativeCalls).toHaveLength(before)
  const removed={...stale,updated_at:'2099-01-02T00:00:00.000Z',deleted_at:'2099-01-02T00:00:00.000Z'}
  channel.emit(entry.table,'UPDATE',removed);await h.untilIdle()
  expect(h.repo[entry.namespace].findById('record').deleted_at).toBeTruthy()
  const next=h.stores[entry.cache].getState()
  if(entry.namespace==='savedViews')expect(next.views).toEqual([])
  else if(entry.namespace==='projectAreas')expect(next.areas).toEqual([])
  expect(h.fixtureErrors).toEqual([])
})
it.each(tables)('handles current $table native failure without an unhandled callback',async entry=>{
  const {h,channel,stale}=await setup(entry)
  h.repo[entry.namespace].applyRemote=()=>{throw Error('Current native failure')}
  channel.emit(entry.table,'UPDATE',stale);await h.untilIdle()
  expect(h.logs).toEqual([])
  expect(h.stores.useLogStore.getState().entries[0]).toMatchObject({level:'error',context:expect.stringContaining('Current native failure')})
  expect(h.repo[entry.namespace].findById('record').name).toBe('CURRENT')
})

it.each(tables)('cancels $table before native apply when cleanup occurs during scope validation',async entry=>{
  const {h,channel,stale}=await setup(entry),pause=gate(),api=h.sandbox.window.api
  let held=false
  h.sandbox.window.api=new Proxy(api,{get(target,namespace){
    if(namespace!=='sync')return target[namespace]
    return new Proxy(target.sync,{get(sync,method){
      if(method!=='captureContext')return sync[method]
      return async()=>{const value=await sync.captureContext();if(!held){held=true;pause.enter();await pause.wait}return value}
    }})
  }})
  const calls=h.nativeCalls.length
  channel.emit(entry.table,'UPDATE',stale);await pause.entered
  await h.services.user.unsubscribeUserChannel()
  pause.release();await h.untilIdle()
  expect(h.repo[entry.namespace].findById('record').name).toBe('CURRENT')
  expect(h.nativeCalls.slice(calls)).toEqual([])
})

it.each(tables)('preserves a valid retained $table origin when the user object refreshes',async entry=>{
  const {h,channel,stale}=await setup(entry),pause=gate(),original=h.repo[entry.namespace][entry.read].bind(h.repo[entry.namespace])
  let held=false
  h.repo[entry.namespace][entry.read]=async(...args:unknown[])=>{const value=original(...args);if(!held){held=true;pause.enter();await pause.wait}return value}
  channel.emit(entry.table,'UPDATE',stale);await pause.entered
  const owner=h.stores.useAuthStore.getState().currentUser
  h.stores.useAuthStore.setState({currentUser:{...owner}})
  pause.release();await h.untilIdle()
  const state=h.stores[entry.cache].getState()
  expect(entry.namespace==='labels'?state.labels.record.name:entry.namespace==='savedViews'?state.views[0].name:state.areas[0].name).toBe('PRIVATE OLD PAYLOAD')
  expect(h.fixtureErrors).toEqual([])
})
