import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() {
  let enter!: () => void, release!: () => void
  return { entered: new Promise<void>(resolve => { enter = resolve }), wait: new Promise<void>(resolve => { release = resolve }), enter: () => enter(), release: () => release() }
}
const families = ['shared','personal','user'] as const
const points = ['client','database','project'] as const
it.each(families.flatMap(family => points.filter(point => family !== 'user' || point !== 'project').flatMap(point => ['single','all'].flatMap(cleanup => [false,true].map(fail => ({ family,point,cleanup,fail }))))))(
  'cancels $family $point setup during $cleanup teardown (late rejection=$fail)', async ({family,point,cleanup,fail}) => {
    const h = await makeHarness({ projectCount:1, shared:family === 'shared' ? 1 : 0, connected:false }); opened.push(h)
    const pause = gate()
    const runtime = h.sandbox.runtime
    const api = h.sandbox.window.api
    let paused = false
    const hold = async <T,>(value: T): Promise<T> => {
      if (paused) return value
      paused = true; pause.enter(); await pause.wait
      if (fail) throw new Error('Late isolated lookup failure')
      return value
    }
    if (point === 'client') {
      const original = runtime.getSupabase
      runtime.getSupabase = async () => hold(await original())
    } else if (point === 'project') {
      const original = h.repo.projects.findById.bind(h.repo.projects)
      h.repo.projects.findById = (id: string) => hold(original(id))
    } else {
      const original = runtime.getSupabase
      let ready = false
      runtime.getSupabase = async () => { const value = await original(); ready = true; return value }
      h.sandbox.window.api = new Proxy(api, { get(target,namespace) {
        if (namespace !== 'sync') return target[namespace]
        return new Proxy(target.sync, { get(sync,method) {
          if (method !== 'captureContext') return sync[method]
          return async () => { const value = await sync.captureContext(); return ready ? hold(value) : value }
        } })
      } })
    }
    const begin = () => family === 'shared' ? h.services.shared.subscribeToProject('p0') : family === 'personal' ? h.services.personal.subscribeToPersonalProject('p0', () => { throw Error('Canceled callback') }) : h.services.user.subscribeToUserChannel('u')
    const pending = begin().catch((error: unknown) => error)
    await pause.entered
    if (family === 'shared') await (cleanup === 'all' ? h.services.shared.unsubscribeAll() : h.services.shared.unsubscribeFromProject('p0'))
    else if (family === 'personal') await (cleanup === 'all' ? h.services.personal.unsubscribeAllPersonal() : h.services.personal.unsubscribePersonalProject('p0'))
    else await h.services.user.unsubscribeUserChannel()
    const calls = h.nativeCalls.length, requests = h.requests.length
    pause.release(); await pending; await h.untilIdle(); await h.runTimers()
    expect(h.channels.filter((channel: { closed: boolean }) => !channel.closed)).toHaveLength(0)
    expect(h.channels).toHaveLength(0)
    expect(h.requests).toHaveLength(requests)
    expect(h.nativeCalls.slice(calls).filter((call: {method:string}) => !['findById'].includes(call.method))).toEqual([])
    expect(h.fixtureErrors).toEqual([])
  },15000)

it.each(families)('retains normal %s creation, rejoin, teardown and recreation', async family => {
  const h = await makeHarness({projectCount:1,shared:family === 'shared' ? 1 : 0,connected:false}); opened.push(h)
  const begin = () => family === 'shared' ? h.services.shared.subscribeToProject('p0') : family === 'personal' ? h.services.personal.subscribeToPersonalProject('p0', () => {}) : h.services.user.subscribeToUserChannel('u')
  const stop = () => family === 'shared' ? h.services.shared.unsubscribeFromProject('p0') : family === 'personal' ? h.services.personal.unsubscribePersonalProject('p0') : h.services.user.unsubscribeUserChannel()
  const topic=family==='user'?'user:u':(family==='shared'?'project':'personal')+':p0'
  await begin(); await begin()
  expect(h.channels.filter((channel: {closed:boolean;topic:string}) => !channel.closed && channel.topic===topic)).toHaveLength(1)
  h.channels[0].status('SUBSCRIBED'); await h.untilIdle()
  expect(h.fixtureErrors).toEqual([])
  await stop(); await begin()
  expect(h.channels.filter((channel: {closed:boolean;topic:string}) => !channel.closed && channel.topic===topic)).toHaveLength(1)
})

it.each(families.flatMap(family => [false,true].map(fail => ({family,fail}))))('cancels a pending $family reconnect after teardown (late error=$fail)',async({family,fail})=>{
  const h=await makeHarness({projectCount:1,shared:family==='shared'?1:0,connected:false});opened.push(h)
  if(family==='shared')await h.services.shared.subscribeToProject('p0')
  else if(family==='personal')await h.services.personal.subscribeToPersonalProject('p0',()=>{})
  else await h.services.user.subscribeToUserChannel('u')
  const channel=h.channels[0]
  channel.status('CHANNEL_ERROR')
  const pause=gate(),original=h.sandbox.runtime.getSupabase
  let held=false
  h.sandbox.runtime.getSupabase=async()=>{
    const client=await original()
    if(held)return client
    held=true;pause.enter();await pause.wait
    if(fail)throw Error('Late reconnect lookup failure')
    return client
  }
  const pending=h.runTimers()
  await pause.entered
  if(family==='shared')await h.services.shared.unsubscribeAll()
  else if(family==='personal')await h.services.personal.unsubscribeAllPersonal()
  else await h.services.user.unsubscribeUserChannel()
  const requests=h.requests.length
  pause.release();await pending;await h.untilIdle()
  channel.emit('projects','UPDATE',{id:'p0'});channel.status('SUBSCRIBED');await h.runTimers()
  expect(h.requests).toHaveLength(requests)
  expect(h.channels).toHaveLength(1)
  expect(h.channels.filter((channel:{closed:boolean})=>!channel.closed)).toHaveLength(0)
})

it('observes setup rejection while old user-channel removal is still pending',async()=>{
  const h=await makeHarness({projectCount:0,connected:false});opened.push(h)
  await h.services.user.subscribeToUserChannel('u')
  const pause=gate(),original=h.sandbox.runtime.client.removeChannel
  h.sandbox.runtime.client.removeChannel=async(channel:unknown)=>{pause.enter();await pause.wait;return original(channel)}
  h.setAccount('other')
  h.beforeSession(async()=>{throw Error('Isolated setup failure')})
  const pending=h.services.user.subscribeToUserChannel('other').catch((error:unknown)=>error)
  await pause.entered
  try { expect(String(await pending)).toContain('Isolated setup failure') } finally { pause.release() }
  await h.untilIdle()
  expect(h.channels).toHaveLength(1)
  expect(h.channels[0].closed).toBe(true)
  expect(h.services.user.hasActiveUserChannel('other')).toBe(false)
})

it.each(families)('rebinds $family to a known replacement database during setup and recovery',async family=>{
  const h=await makeHarness({projectCount:1,shared:family==='shared'?1:0,connected:false});opened.push(h)
  const begin=()=>family==='shared'?h.services.shared.subscribeToProject('p0'):family==='personal'?h.services.personal.subscribeToPersonalProject('p0',()=>{}):h.services.user.subscribeToUserChannel('u')
  const topic=family==='user'?'user:u':(family==='shared'?'project':'personal')+':p0'
  await begin()
  const old=h.channels.find((channel:{topic:string})=>channel.topic===topic)
  h.replaceDatabase();await begin()
  expect(old.closed).toBe(true)
  const replacement=h.channels.findLast((channel:{topic:string;closed:boolean})=>channel.topic===topic&&!channel.closed)
  expect(replacement).toBeDefined()
  replacement.status('SUBSCRIBED');await h.untilIdle()
  h.replaceDatabase()
  if(family==='user')await h.services.user.forceReconnectUserChannel()
  else if(family==='shared')await h.services.shared.forceReconnectAllShared()
  else await h.services.personal.forceReconnectAllPersonal()
  await h.untilIdle()
  expect(replacement.closed).toBe(true)
  expect(h.channels.filter((channel:{topic:string;closed:boolean})=>channel.topic===topic&&!channel.closed)).toHaveLength(1)
  expect(h.fixtureErrors).toEqual([])
})
