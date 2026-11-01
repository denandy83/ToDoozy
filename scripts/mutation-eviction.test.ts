import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require=createRequire(import.meta.url)
const { makeHarness }=require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[]=[]
afterEach(async()=>{for(const h of opened.splice(0))await h.stop()})
function gate(){let enter!:()=>void,release!:()=>void;return{entered:new Promise<void>(resolve=>{enter=resolve}),wait:new Promise<void>(resolve=>{release=resolve}),enter:()=>enter(),release:()=>release()}}
async function setup(){
  const h=await makeHarness({projectCount:2,connected:false});opened.push(h)
  for(const id of ['t','q'])h.repo.tasks.create({id,owner_id:'u',project_id:id==='t'?'p0':'p1',status_id:id==='t'?'s0':'s1',title:id==='t'?'PRIVATE T':'VALID Q',is_in_my_day:1,due_date:'2030-01-01'})
  h.repo.users.create({id:'third',email:'third@example.invalid',display_name:null,avatar_url:null})
  h.repo.projects.addMember('p0','other','member')
  h.repo.statuses.create({id:'spare',project_id:'p0',name:'Spare'})
  h.repo.labels.create({id:'label',user_id:'u',project_id:'p0',name:'Own'})
  h.repo.labels.create({id:'unlinked',user_id:'u',name:'Other'})
  h.repo.tasks.addLabel('t','label');h.repo.tasks.addLabel('q','label')
  h.remote.tasks.push({...h.repo.tasks.findById('t')},{...h.repo.tasks.findById('q')})
  await h.stores.useProjectStore.getState().hydrateProjects('u')
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  await h.stores.useStatusStore.getState().hydrateStatuses('p0')
  await h.stores.useLabelStore.getState().hydrateLabels('p0')
  h.stores.useProjectStore.setState({currentProjectId:'p0'})
  return h
}
async function revoke(h:Awaited<ReturnType<typeof makeHarness>>, projectId='p0'){
  const project={...h.repo.projects.findById(projectId),owner_id:'other',updated_at:'2035-01-01T00:00:00.000Z'}
  h.repo.projects.applyRemote(project)
  Object.assign(h.remote.projects.find((row:{id:string})=>row.id===projectId),project)
  h.remote.project_members=h.remote.project_members.filter((row:{project_id:string;user_id:string})=>row.project_id!==projectId||row.user_id!=='u')
  await h.services.shared.discoverRemoteMemberships('u',await h.context(),project)
}
const cases=[
  {name:'task create',store:'useTaskStore',ns:'tasks',hold:'create',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().createTask({id:'new',owner_id:'u',project_id:'p0',status_id:'s0',title:'PRIVATE NEW'})},
  {name:'task update',store:'useTaskStore',ns:'tasks',hold:'update',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().updateTask('t',{title:'PRIVATE UPDATE'})},
  {name:'task delete',store:'useTaskStore',ns:'tasks',hold:'delete',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().deleteTask('t')},
  {name:'task duplicate',store:'useTaskStore',ns:'tasks',hold:'duplicate',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().duplicateTask('t','copy')},
  {name:'task template',store:'useTaskStore',ns:'tasks',hold:'saveAsTemplate',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().saveTaskAsTemplate('t','template')},
  {name:'task subtask',store:'useTaskStore',ns:'tasks',hold:'create',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().createSubtask('t',{id:'child',owner_id:'u',project_id:'p0',status_id:'s0',title:'PRIVATE CHILD'})},
  {name:'task attach label',store:'useTaskStore',ns:'tasks',hold:'addLabel',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().addLabel('t','unlinked')},
  {name:'task remove label',store:'useTaskStore',ns:'tasks',hold:'removeLabel',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().removeLabel('t','label')},
  {name:'task reorder',store:'useTaskStore',ns:'tasks',hold:'update',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().reorderTasks(['t','q'])},
  {name:'bulk update',store:'useTaskStore',ns:'tasks',hold:'update',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().bulkUpdateTasks(['t','q'],{priority:3})},
  {name:'bulk delete',store:'useTaskStore',ns:'tasks',hold:'delete',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().bulkDeleteTasks(['t','q'])},
  {name:'bulk attach label',store:'useTaskStore',ns:'tasks',hold:'addLabel',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().bulkAddLabel(['t','q'],'unlinked')},
  {name:'bulk remove label',store:'useTaskStore',ns:'tasks',hold:'removeLabel',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().bulkRemoveLabel(['t','q'],'label')},
  {name:'project update',store:'useProjectStore',ns:'projects',hold:'update',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().updateProject('p0',{name:'PRIVATE PROJECT'})},
  {name:'project delete',store:'useProjectStore',ns:'projects',hold:'delete',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().deleteProject('p0')},
  {name:'project archive',store:'useProjectStore',ns:'projects',hold:'archiveWithTasks',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().archiveProject('p0')},
  {name:'project restore',store:'useProjectStore',ns:'projects',hold:'unarchiveWithTasks',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().unarchiveProject('p0')},
  {name:'member add',store:'useProjectStore',ns:'projects',hold:'addMember',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().addMember('p0','third','member')},
  {name:'member remove',store:'useProjectStore',ns:'projects',hold:'removeMember',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().removeMember('p0','other')},
  {name:'status create',store:'useStatusStore',ns:'statuses',hold:'create',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useStatusStore.getState().createStatus({id:'new-status',project_id:'p0',name:'PRIVATE STATUS'})},
  {name:'status update',store:'useStatusStore',ns:'statuses',hold:'update',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useStatusStore.getState().updateStatus('spare',{name:'PRIVATE STATUS'})},
  {name:'status delete',store:'useStatusStore',ns:'statuses',hold:'delete',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useStatusStore.getState().deleteStatus('spare')},
  {name:'status reassign',store:'useStatusStore',ns:'statuses',hold:'reassignAndDelete',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useStatusStore.getState().reassignAndDelete('spare','s0')},
  {name:'project label create',store:'useLabelStore',ns:'labels',hold:'create',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useLabelStore.getState().createLabel({id:'new-label',user_id:'u',project_id:'p0',name:'PRIVATE LABEL'})},
  {name:'project label attach',store:'useLabelStore',ns:'labels',hold:'addToProject',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useLabelStore.getState().addToProject('p0','unlinked')},
  {name:'project label remove',store:'useLabelStore',ns:'labels',hold:'removeFromProject',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useLabelStore.getState().removeFromProject('p0','label')}
]
it.each(cases.flatMap(entry=>[false,true].map(fail=>({...entry,fail}))))('fences held $name after actual revocation (failure=$fail)',async({name,store,ns,hold,run,fail})=>{
  const h=await setup(),pause=gate(),methods=h.repo[ns],original=methods[hold].bind(methods)
  if(name==='project restore')h.repo.projects.archiveWithTasks('p0')
  let held=false
  methods[hold]=async(...args:unknown[])=>{const value=original(...args);if(!held&&args[0]!=='q'){held=true;pause.enter();await pause.wait;if(fail)throw Error('PRIVATE STALE ERROR')}return value}
  const outcome=run(h).then((value:unknown)=>({value,error:null}),(error:unknown)=>({value:null,error:String(error)}))
  await pause.entered;await revoke(h)
  expect(h.stores.useTaskStore.getState().tasks.t).toBeUndefined()
  h.stores[store].setState({error:'CURRENT ERROR'})
  const q=h.stores.useTaskStore.getState().tasks.q
  h.requests.length=0
  pause.release();const result=await outcome;await h.untilIdle()
  expect(Object.values(h.stores.useTaskStore.getState().tasks).some((task:{project_id:string})=>task.project_id==='p0')).toBe(false)
  expect(h.stores.useTaskStore.getState().taskLabels.t).toBeUndefined()
  expect(h.services.selectMyDayTasks(h.stores.useTaskStore.getState()).some((task:{project_id:string})=>task.project_id==='p0')).toBe(false)
  expect(Object.values(h.stores.useTaskStore.getState().tasks).some((task:{project_id:string})=>task.project_id==='p0')).toBe(false)
  expect(h.stores.useProjectStore.getState().projects.p0).toBeUndefined()
  expect(h.stores.useProjectStore.getState().members.p0).toBeUndefined()
  expect(h.stores.useLabelStore.getState().projectLabels.p0).toBeUndefined()
  expect(Object.values(h.stores.useStatusStore.getState().statuses).some((row:{project_id:string})=>row.project_id==='p0')).toBe(false)
  expect(h.stores[store].getState().error).toBe('CURRENT ERROR')
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
  expect(h.requests.filter((request:{body:unknown})=>JSON.stringify(request.body).includes('p0')||JSON.stringify(request.body).includes('PRIVATE'))).toEqual([])
  if(!name.startsWith('bulk')&&name!=='task reorder')expect(h.stores.useTaskStore.getState().tasks.q).toBe(q)
  if(name==='bulk attach label'){
    expect(h.remote.project_labels.some((row:{project_id:string;label_id:string})=>row.project_id==='p1'&&row.label_id==='unlinked')).toBe(true)
    expect(h.repo.syncQueue.findAll().some((row:{table_name:string;payload:string})=>row.table_name==='project_labels'&&JSON.parse(row.payload).projectId==='p0')).toBe(true)
  }
  expect(h.repo.tasks.findById('t')).toBeDefined()
  expect(h.fixtureErrors).toEqual([])
},15000)
it.each(cases)('preserves normal current $name',async({name,run})=>{
  const h=await setup()
  if(name==='project restore')h.repo.projects.archiveWithTasks('p0')
  await run(h);await h.untilIdle()
  expect(h.fixtureErrors).toEqual([])
})
it('keeps an unrelated buffered edit and executes its actual queued cloud flush',async()=>{
  const h=await setup(),pause=gate(),original=h.repo.tasks.update.bind(h.repo.tasks)
  h.stores.useTaskStore.setState({showDetailPanel:true,lastSelectedTaskId:'q'})
  await h.stores.useTaskStore.getState().updateTask('q',{title:'BUFFERED Q'})
  expect(h.services.batches.isPending('q')).toBe(true)
  let held=false
  h.repo.tasks.update=async(id:string,input:unknown)=>{const value=original(id,input);if(id==='t'&&!held){held=true;pause.enter();await pause.wait}return value}
  const stale=h.stores.useTaskStore.getState().updateTask('t',{title:'PRIVATE UPDATE'}).catch(()=>null)
  await pause.entered;await revoke(h);pause.release();await stale
  expect(h.services.batches.isPending('q')).toBe(true)
  await h.services.batches.flushAll();await h.untilIdle()
  expect(h.remote.tasks.find((row:{id:string})=>row.id==='q').title).toBe('BUFFERED Q')
  expect(h.stores.useTaskStore.getState().tasks.q.title).toBe('BUFFERED Q')
  expect(h.services.batches.isPending('q')).toBe(false)
  expect(h.fixtureErrors).toEqual([])
})

it('cancels a newly created project result after its own revocation without returning a private object',async()=>{
  const h=await setup(),pause=gate(),original=h.repo.projects.create.bind(h.repo.projects)
  h.repo.projects.create=async(input:unknown)=>{const value=original(input);h.remote.projects.push({...value});pause.enter();await pause.wait;return value}
  const result=h.stores.useProjectStore.getState().createProject({id:'created',owner_id:'u',name:'PRIVATE CREATED'}).catch((error:unknown)=>String(error))
  await pause.entered;await revoke(h,'created');pause.release()
  const value=await result
  expect(typeof value).toBe('string');expect(value).not.toContain('PRIVATE')
  expect(h.stores.useProjectStore.getState().projects.created).toBeUndefined()
  expect(h.repo.projects.findById('created')).toBeDefined()
})

it('captures an uncached reordered task project before mutation and preserves unrelated reorder work',async()=>{
  const h=await setup(),pause=gate(),original=h.repo.tasks.update.bind(h.repo.tasks)
  h.stores.useTaskStore.setState((state:{tasks:Record<string,unknown>})=>({tasks:Object.fromEntries(Object.entries(state.tasks).filter(([id])=>id!=='t'))}))
  h.repo.tasks.update=async(id:string,input:unknown)=>{const value=original(id,input);if(id==='t'){pause.enter();await pause.wait}return value}
  const reordered=h.stores.useTaskStore.getState().reorderTasks(['t','q'])
  await pause.entered;await revoke(h)
  const calls=h.nativeCalls.length
  pause.release();await reordered;await h.untilIdle()
  expect(h.nativeCalls.slice(calls).some((call:{namespace:string;method:string;args:unknown[]})=>call.namespace==='tasks'&&call.method==='findById'&&call.args[0]==='t')).toBe(false)
  expect(h.stores.useTaskStore.getState().tasks.t).toBeUndefined()
  expect(h.stores.useTaskStore.getState().tasks.q.order_index).toBe(1)
  expect(h.remote.tasks.find((task:{id:string})=>task.id==='q').order_index).toBe(1)
  expect(h.repo.tasks.findById('t')).toBeDefined()
  expect(h.fixtureErrors).toEqual([])
})
