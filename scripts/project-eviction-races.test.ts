import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require=createRequire(import.meta.url)
const { makeHarness }=require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[]=[]
afterEach(async()=>{for(const h of opened.splice(0))await h.stop()})
function gate(){let enter!:()=>void,release!:()=>void;return{entered:new Promise<void>(resolve=>{enter=resolve}),wait:new Promise<void>(resolve=>{release=resolve}),enter:()=>enter(),release:()=>release()}}
async function setup(){
  const h=await makeHarness({projectCount:2,connected:false});opened.push(h)
  for(const [id,project,status,owner] of [['t','p0','s0','u'],['q','p1','s1','u']])h.repo.tasks.create({id,project_id:project,status_id:status,owner_id:owner,title:id,is_in_my_day:1})
  const label=h.repo.labels.create({id:'foreign',user_id:'other',project_id:'p0',name:'PRIVATE LABEL'})
  h.repo.tasks.applyRemoteTaskLabels('t',[label.id])
  const pending={...h.repo.tasks.findById('q'),title:'PENDING Q'}
  h.stores.useTaskStore.setState({tasks:{q:pending},taskLabels:{q:[]},error:null,loading:false})
  return {h,pending,label}
}
const paths=[
  {name:'bootstrap',namespace:'tasks',method:'findAllByProject',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateAllForUser('u')},
  {name:'unvisited project',namespace:'tasks',method:'findAllByProject',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateAllForProject('p0')},
  {name:'explicit-origin project',namespace:'tasks',method:'findAllByProject',run:async(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateAllForProject('p0',await h.context())},
  {name:'scoped tasks',namespace:'tasks',method:'findByProjectId',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateTasks('p0')},
  {name:'My Day',namespace:'tasks',method:'findMyDay',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateMyDay('u')},
  {name:'archived',namespace:'tasks',method:'findArchived',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateArchived('p0')},
  {name:'templates',namespace:'tasks',method:'findAllTemplates',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateTemplates('p0')},
  {name:'project snapshot',namespace:'projects',method:'getProjectsForUser',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().hydrateProjects('u')},
  {name:'membership snapshot',namespace:'projects',method:'getMembers',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().hydrateMembers('p0')},
  {name:'full membership snapshot',namespace:'projects',method:'getMembers',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useProjectStore.getState().hydrateProjects('u')},
  {name:'labels and junction',namespace:'labels',method:'findByProjectId',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useLabelStore.getState().hydrateLabels('p0')},
  {name:'statuses',namespace:'statuses',method:'findByProjectId',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useStatusStore.getState().hydrateStatuses('p0')},
  {name:'task labels',namespace:'labels',method:'findByTaskId',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateTaskLabels('t')},
  {name:'project task labels',namespace:'labels',method:'findTaskLabelsByProject',run:(h:Awaited<ReturnType<typeof makeHarness>>)=>h.stores.useTaskStore.getState().hydrateAllTaskLabels('p0')}
]
it.each(paths.flatMap(path=>['local','revocation'].map(trigger=>({...path,trigger}))))('does not resurrect an uncached $name snapshot after $trigger eviction',async({name,namespace,method,run,trigger})=>{
  const {h,pending}=await setup(),pause=gate()
  if(name==='archived')h.repo.tasks.update('t',{is_archived:1})
  if(name==='templates')h.repo.tasks.update('t',{is_template:1})
  const owner=h.stores.useAuthStore.getState().currentUser
  const original=h.repo[namespace][method].bind(h.repo[namespace]);let held=false
  h.repo[namespace][method]=async(...args:unknown[])=>{
    const value=original(...args)
    if(!held&&(!['findAllByProject','getMembers','findByProjectId','findTaskLabelsByProject'].includes(method)||args[0]==='p0')){held=true;pause.enter();await pause.wait}
    return value
  }
  const operation=run(h);await pause.entered
  expect(h.stores.useTaskStore.getState().tasks.t).toBeUndefined()
  if(trigger==='local')await h.stores.useProjectStore.getState().deleteProject('p0')
  else {
    const project={...h.repo.projects.findById('p0'),owner_id:'other',updated_at:'2030-01-01T00:00:00.000Z'}
    h.repo.projects.applyRemote(project)
    Object.assign(h.remote.projects.find((row:{id:string})=>row.id==='p0'),project)
    h.remote.project_members=h.remote.project_members.filter((row:{project_id:string;user_id:string})=>row.project_id!=='p0'||row.user_id!=='u')
    await h.services.shared.discoverRemoteMemberships('u',await h.context(),project)
  }
  const newer={...pending,title:'NEWER PENDING Q'}
  h.stores.useTaskStore.setState((state:{tasks:Record<string,unknown>})=>({tasks:{...state.tasks,q:newer}}))
  const qProject={...h.stores.useProjectStore.getState().projects.p1,name:'NEWER PROJECT Q'}
  h.stores.useProjectStore.setState((state:{projects:Record<string,unknown>})=>({projects:{...state.projects,p1:qProject}}))
  pause.release();await operation;await h.untilIdle()
  const tasks=h.stores.useTaskStore.getState(),projects=h.stores.useProjectStore.getState()
  expect(tasks.tasks.t).toBeUndefined();expect(tasks.taskLabels.t).toBeUndefined()
  expect(projects.projects.p0).toBeUndefined();expect(projects.members.p0).toBeUndefined()
  expect(h.stores.useLabelStore.getState().labels.foreign).toBeUndefined()
  expect(h.stores.useLabelStore.getState().projectLabels.p0).toBeUndefined()
  expect(Object.values(h.stores.useStatusStore.getState().statuses).some((row:{project_id:string})=>row.project_id==='p0')).toBe(false)
  expect(tasks.tasks.q).toBe(newer);expect(projects.projects.p1).toBe(qProject)
  expect(h.stores.useAuthStore.getState().currentUser).toBe(owner)
  expect(h.repo.projects.findById('p0')).toBeDefined();expect(h.repo.tasks.findById('t')).toBeDefined()
  expect(h.fixtureErrors).toEqual([])
},15000)
it.each(['task','project','member','label','status'])('rejects pre-eviction %s data after an explicit rejoin and accepts a fresh snapshot',async kind=>{
  const {h}=await setup(),pause=gate()
  const path=kind==='task'?paths[1]:kind==='project'?paths[7]:kind==='member'?paths[8]:kind==='label'?paths[10]:paths[11]
  const original=h.repo[path.namespace][path.method].bind(h.repo[path.namespace]);let held=false
  h.repo[path.namespace][path.method]=async(...args:unknown[])=>{const value=original(...args);if(!held){held=true;pause.enter();await pause.wait}return value}
  const operation=path.run(h);await pause.entered
  h.services.evictProjectData('p0')
  h.repo.tasks.update('t',{title:'FRESH TASK'})
  h.repo.projects.update('p0',{name:'FRESH PROJECT'})
  h.repo.labels.update('foreign',{name:'FRESH LABEL'})
  h.repo.statuses.update('s0',{name:'FRESH STATUS'})
  await h.stores.useProjectStore.getState().hydrateProjects('u')
  await h.stores.useProjectStore.getState().hydrateMembers('p0')
  await h.stores.useTaskStore.getState().hydrateAllForProject('p0')
  await h.stores.useLabelStore.getState().hydrateLabels('p0')
  await h.stores.useStatusStore.getState().hydrateStatuses('p0')
  pause.release();await operation
  expect(h.stores.useTaskStore.getState().tasks.t.title).toBe('FRESH TASK')
  expect(h.stores.useProjectStore.getState().projects.p0.name).toBe('FRESH PROJECT')
  expect(h.stores.useProjectStore.getState().members.p0.length).toBeGreaterThan(0)
  expect(h.stores.useLabelStore.getState().labels.foreign.name).toBe('FRESH LABEL')
  expect(h.stores.useStatusStore.getState().statuses.s0.name).toBe('FRESH STATUS')
})
it('uses access-filtered native task reads after revocation and permits a later legitimate rejoin',async()=>{
  const {h}=await setup()
  h.repo.tasks=new h.repo.tasks.constructor(h.services.db,'u')
  h.repo.projects.applyRemote({...h.repo.projects.findById('p0'),owner_id:'other',updated_at:'2030-01-01T00:00:00.000Z'})
  h.repo.projects.removeMember('p0','u');h.services.evictProjectData('p0')
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  expect(h.stores.useTaskStore.getState().tasks.t).toBeUndefined()
  expect(h.repo.tasks.findById('t')).toBeDefined()
  h.repo.projects.addMember('p0','u','member')
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  expect(h.stores.useTaskStore.getState().tasks.t).toBeDefined()
})

it.each(['membership discovery','project refresh'])('guards direct %s publication after eviction',async path=>{
  const {h}=await setup(),pause=gate(),namespace='projects',method=path==='membership discovery'?'getMembers':'findById'
  const original=h.repo[namespace][method].bind(h.repo[namespace]);let held=false
  h.repo[namespace][method]=async(...args:unknown[])=>{const value=original(...args);if(!held&&args[0]==='p0'){held=true;pause.enter();await pause.wait}return value}
  if(path==='project refresh')h.stores.useProjectStore.setState({projects:{p1:h.repo.projects.findById('p1')},members:{p1:h.repo.projects.getMembers('p1')}})
  const context=await h.context()
  const operation=path==='membership discovery'?h.services.shared.discoverRemoteMemberships('u',context,h.repo.projects.findAllByOwner('u')[0]):h.services.personal.requestProjectRefresh(context,['p0'])
  await pause.entered
  if(path==='membership discovery')await h.stores.useProjectStore.getState().deleteProject('p0')
  else h.services.evictProjectData('p0')
  pause.release();await operation;await h.untilIdle()
  expect(h.stores.useProjectStore.getState().projects.p0).toBeUndefined()
  expect(h.stores.useProjectStore.getState().members.p0).toBeUndefined()
  expect(h.stores.useTaskStore.getState().tasks.t).toBeUndefined()
  expect(h.stores.useTaskStore.getState().taskLabels.t).toBeUndefined()
})

it('finishes unrelated project refreshes when one project snapshot is invalidated',async()=>{
  const {h}=await setup(),pause=gate()
  h.remote.tasks.push({...h.repo.tasks.findById('q'),title:'REMOTE Q',updated_at:'2099-01-01T00:00:00.000Z'})
  const original=h.repo.projects.findById.bind(h.repo.projects);let held=false
  h.repo.projects.findById=async(id:string)=>{const value=original(id);if(id==='p0'&&!held){held=true;pause.enter();await pause.wait}return value}
  const operation=h.services.personal.requestProjectRefresh(await h.context(),['p0','p1'])
  await pause.entered;h.services.evictProjectData('p0');pause.release();await operation;await h.untilIdle()
  expect(h.repo.tasks.findById('q').title).toBe('REMOTE Q')
  expect(h.stores.useTaskStore.getState().tasks.q.title).toBe('REMOTE Q')
  expect(h.stores.useTaskStore.getState().tasks.t).toBeUndefined()
  expect(h.fixtureErrors).toEqual([])
})
