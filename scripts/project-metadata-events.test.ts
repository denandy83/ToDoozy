import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
const clock = '2026-01-02T00:00:00.000Z'
async function setup(shared: boolean) {
  const h = await makeHarness({projectCount:2,shared:shared ? 2 : 0}); opened.push(h)
  h.services.db.prepare('UPDATE projects SET archive_updated_at=?').run(clock)
  for (const project of h.remote.projects) project.archive_updated_at = clock
  const task = h.repo.tasks.create({id:'event',project_id:'p0',owner_id:shared?'other':'u',status_id:'s0',title:'Before'})
  h.remote.tasks.push({...task})
  await h.run(); await h.untilIdle()
  h.requests.length=0
  return h
}
it.each([true,false])('unchanged restored metadata avoids membership reads through the actual shared=%s callback', async shared => {
  const h=await setup(shared)
  const channel=h.channels.find((channel: {topic:string;closed:boolean}) => channel.topic === (shared?'project':'personal')+':p0' && !channel.closed)
  const changed={...h.remote.tasks[0],title:'After',updated_at:'2030-01-01T00:00:00.000Z'}
  Object.assign(h.remote.tasks[0],changed)
  channel.emit('tasks','UPDATE',changed); await h.runTimers(); await h.untilIdle()
  expect(h.repo.tasks.findById('event').title).toBe('After')
  expect(h.requests.filter((row: {table:string}) => row.table==='project_members')).toHaveLength(0)
  expect(h.requests.some((row: {url:string}) => row.url.includes('p1'))).toBe(false)
  expect(h.fixtureErrors).toEqual([])
})
it.each([true,false])('preserves scoped metadata and archive/restore reconciliation for shared=%s', async shared => {
  const h=await setup(shared)
  const context=await h.context()
  const remote=h.remote.projects[0]
  Object.assign(remote,{name:'Renamed',updated_at:'2030-01-01T00:00:00.000Z'})
  await h.services.personal.requestProjectRefresh(context,['p0']); await h.untilIdle()
  expect(h.repo.projects.findById('p0').name).toBe('Renamed')
  expect(h.requests.filter((row: {table:string}) => row.table==='project_members').length).toBeGreaterThan(0)
  for (const archived of [1,0]) {
    Object.assign(remote,{is_archived:archived,archive_updated_at:archived?'2031-01-01T00:00:00.000Z':'2032-01-01T00:00:00.000Z'})
    await h.services.personal.requestProjectRefresh(context,['p0']); await h.untilIdle()
    expect(h.repo.projects.findById('p0').is_archived).toBe(archived)
    const active=h.channels.findLast((channel: {topic:string;closed:boolean}) => channel.topic === (shared?'project':'personal')+':p0' && !channel.closed)
    expect(active.bindings.some((binding: {filter:{table:string}}) => binding.filter.table==='tasks')).toBe(!archived)
  }
  expect(h.requests.some((row: {url:string}) => row.url.includes('p1'))).toBe(false)
  expect(h.fixtureErrors).toEqual([])
})
it('repairs equal-clock task archive state without requesting project reconciliation or overwriting newer local edits', async () => {
  const h=await setup(false)
  const context=await h.context()
  h.services.db.prepare("UPDATE tasks SET is_archived=1,archive_updated_at=? WHERE id='event'").run(clock)
  expect(await h.services.personal.pullProjectMetadata('p0',context)).toBe(false)
  expect(h.repo.tasks.findById('event').is_archived).toBe(0)
  h.repo.projects.update('p0',{name:'Local pending name'})
  Object.assign(h.remote.projects[0],{name:'Older remote name',updated_at:'2020-01-01T00:00:00.000Z'})
  expect(await h.services.personal.pullProjectMetadata('p0',context)).toBe(false)
  expect(h.repo.projects.findById('p0').name).toBe('Local pending name')
})

it('discovers sharing changes announced by a newer metadata version and rebinds the personal channel',async()=>{
  const h=await setup(false),context=await h.context()
  h.remote.project_members.push({project_id:'p0',user_id:'other',role:'member',joined_at:clock})
  h.remote.projects[0].updated_at='2033-01-01T00:00:00.000Z'
  await h.services.personal.requestProjectRefresh(context,['p0']);await h.untilIdle()
  expect(h.repo.projects.findById('p0').is_shared).toBe(1)
  expect(h.channels.some((channel:{topic:string;closed:boolean})=>channel.topic==='project:p0'&&!channel.closed)).toBe(true)
  expect(h.channels.some((channel:{topic:string;closed:boolean})=>channel.topic==='personal:p0'&&!channel.closed)).toBe(false)
  expect(h.requests.filter((row:{table:string})=>row.table==='project_members').length).toBeGreaterThan(0)
  expect(h.requests.some((row:{url:string})=>row.url.includes('p1'))).toBe(false)
  expect(h.fixtureErrors).toEqual([])
})
