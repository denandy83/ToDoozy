import { createRequire } from 'node:module'
import { afterEach,expect,it } from 'vitest'
const require=createRequire(import.meta.url)
const {makeHarness}=require('./benchmark-sync.cjs')
type Harness=Awaited<ReturnType<typeof makeHarness>>
const opened: Harness[]=[]
afterEach(async()=>{for(const h of opened.splice(0))await h.stop()})
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
const canonical=(rows:unknown[]):string[]=>rows.map(row=>JSON.stringify(row)).sort()
it.each(['personal','shared'].flatMap(kind=>[4,8].map(count=>({kind,count}))))('transfers each $kind project junction once across $count projects',async({kind,count})=>{
  const h=await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:count+1,shared:kind==='shared'?count:1,connected:false});opened.push(h)
  const targets=h.projects.filter((p:{owner_id:string;is_shared:number})=>kind==='personal'?p.owner_id==='u'&&p.is_shared===0:p.is_shared===1)
  for(const p of h.projects)for(let n=0;n<4;n++) {
    const label=h.repo.labels.create({id:'label-'+p.id+'-'+n,user_id:'u',name:p.id+' LABEL '+n,color:'#123456'})
    h.remote.user_labels.push(clone(label))
    h.repo.labels.applyRemoteProjectLabel({project_id:p.id,label_id:label.id,created_at:'2025-01-01T00:00:00.000Z',deleted_at:n===3?'2025-01-02T00:00:00.000Z':null})
  }
  h.remote.project_labels.push(...clone(h.services.db.prepare('SELECT project_id,label_id,created_at,deleted_at FROM project_labels ORDER BY project_id,label_id').all()))
  const snapshot=():Record<string,string[]>=>Object.fromEntries(['projects','project_members','statuses','tasks','labels','project_labels','task_labels'].map(table=>[table,canonical(h.services.db.prepare('SELECT * FROM '+table).all())]))
  const remoteSnapshot=():Record<string,unknown>=>Object.fromEntries(['projects','project_members','statuses','tasks','user_labels','project_labels','task_labels','activity_log'].map(table=>[table,clone(h.remote[table])]))
  const before=snapshot(),remoteBefore=remoteSnapshot()
  const method=kind==='personal'?'getProjectLabelsForOwner':'getProjectLabelsForSharedProjects'
  const calls:Array<{args:unknown[];rows:Array<{project_id:string;deleted_at:string|null}>}>=[]
  const original=h.repo.labels[method].bind(h.repo.labels)
  h.repo.labels[method]=(...args:unknown[])=>{const rows=original(...args);calls.push({args,rows:clone(rows)});return rows}
  await h.services.personal.requestSyncCatchUp(await h.context());await h.untilIdle()
  expect(targets).toHaveLength(count)
  expect(calls.reduce((sum,call)=>sum+call.rows.length,0)).toBe(count*4)
  expect(calls.reduce((sum,call)=>sum+call.rows.filter(row=>row.deleted_at).length,0)).toBe(count)
  expect(calls).toHaveLength(count)
  for(const call of calls){const project=kind==='personal'?call.args[1]:call.args[0];expect(call.rows.every(row=>row.project_id===project)).toBe(true)}
  const after=snapshot()
  const differences=Object.keys(before).filter(table=>JSON.stringify(before[table])!==JSON.stringify(after[table])).map(table=>({table,before:before[table].filter(row=>!after[table].includes(row)).slice(0,2),after:after[table].filter(row=>!before[table].includes(row)).slice(0,2)}))
  expect(after,JSON.stringify(differences)).toEqual(before)
  expect(remoteSnapshot()).toEqual(remoteBefore)
  expect(h.fixtureErrors).toEqual([])
},20000)

it.each(['fullPull','download','catchup'].flatMap(path=>[10,40].map(count=>({path,count}))))('reuses known ownership for $count task labels during $path',async({path,count})=>{
  const h=await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:1,shared:1,connected:false});opened.push(h)
  const timestamp='2030-01-01T00:00:00.000Z'
  for(let n=0;n<count;n++)h.remote.tasks.push({id:'task-'+n,project_id:'p0',owner_id:'other',status_id:'s0',title:'TASK '+n,parent_id:n%4===3?'task-'+(n-1):null,order_index:n,created_at:timestamp,updated_at:timestamp,is_archived:0,deleted_at:null})
  if(path==='fullPull')h.services.db.exec('DELETE FROM tasks;DELETE FROM statuses;DELETE FROM project_members;DELETE FROM projects')
  h.nativeCalls.length=0
  if(path==='fullPull')await h.services.personal.fullPull('u',await h.context())
  else if(path==='download')await h.services.shared.syncProjectDown('p0','u',await h.context())
  else await h.services.personal.requestSyncCatchUp(await h.context())
  await h.untilIdle()
  const reads=h.nativeCalls.filter((call:{namespace:string;method:string;args:unknown[]})=>call.namespace==='tasks'&&call.method==='findById'&&String(call.args[0]).startsWith('task-'))
  expect(reads).toHaveLength(path==='fullPull'?0:path==='download'?count:count*3)
  const rows=h.repo.tasks.findByProjectId('p0')
  expect(rows).toHaveLength(count)
  for(const row of rows)expect(row).toMatchObject(h.remote.tasks.find((t:{id:string})=>t.id===row.id))
  expect(h.fixtureErrors).toEqual([])
},20000)

it('keeps a known task move from applying the original project label response',async()=>{
  const h=await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:2,connected:false});opened.push(h)
  h.repo.tasks.create({id:'moved',project_id:'p0',owner_id:'u',status_id:'s0',title:'MOVED'})
  const label=h.repo.labels.create({id:'label-p',user_id:'u',name:'P LABEL'})
  h.remote.user_labels.push(clone(label));h.remote.task_labels.push({task_id:'moved',label_id:'label-p',deleted_at:null})
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>{entered=r}),wait=new Promise<void>(r=>{release=r})
  const fetch=h.sandbox.fetch;let held=false
  h.sandbox.fetch=async(url:string,init?:RequestInit)=>{const result=await fetch(url,init);if(!held&&new URL(String(url)).pathname.endsWith('/task_labels')){held=true;entered();await wait}return result}
  const pending=h.services.personal.pullTaskLabelsForTasks(['moved'],'u',await h.context(),'p0')
  await ready
  h.repo.tasks.update('moved',{project_id:'p1',status_id:'s1'})
  const before=h.repo.tasks.getLabelState('moved')
  release();expect(await pending).toBe(0)
  expect(h.repo.tasks.getLabelState('moved')).toEqual(before)
  expect(h.repo.labels.findByProjectId('p1')).toEqual([])
  expect(h.fixtureErrors).toEqual([])
},15000)

it('bulk-resolves mixed ownership once while retaining P cancellation and Q progress',async()=>{
  const h=await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:2,shared:2,connected:false});opened.push(h)
  for(const n of [0,1]) {
    h.repo.tasks.create({id:'task-'+n,project_id:'p'+n,owner_id:'other',status_id:'s'+n,title:'TASK '+n})
    h.repo.labels.create({id:'label-'+n,user_id:'u',name:'LABEL '+n})
    h.remote.task_labels.push({task_id:'task-'+n,label_id:'label-'+n,deleted_at:null})
  }
  let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r}),wait=new Promise<void>(r=>{release=r})
  const api=h.sandbox.window.api;let held=false
  h.sandbox.window.api=new Proxy(api,{get(target,namespace) {
    if(namespace!=='sync')return Reflect.get(target,namespace)
    return new Proxy(target.sync,{get(sync,method) {
      if(method!=='invokeContext')return Reflect.get(sync,method)
      return async(origin:unknown,name:string,args:unknown[])=>{const result=await sync.invokeContext(origin,name,args);if(!held&&['tasks:findByIds','tasks:findById'].includes(name)){held=true;entered();await wait}return result}
    }})
  }})
  const pending=h.services.personal.pullTaskLabelsForTasks(['task-0','task-1','missing'],'u',await h.context())
  await ready
  h.remote.project_members=h.remote.project_members.filter((row:{project_id:string;user_id:string})=>row.project_id!=='p0'||row.user_id!=='u')
  await h.services.shared.discoverRemoteMemberships('u',await h.context(),h.repo.projects.findById('p0'))
  release();await pending
  expect(h.repo.tasks.getLabels('task-0')).toEqual([])
  expect(h.repo.tasks.getLabels('task-1').map((row:{label_id:string})=>row.label_id)).toEqual(['label-1'])
  expect(h.nativeCalls.filter((call:{namespace:string;method:string})=>call.namespace==='tasks'&&call.method==='findByIds')).toHaveLength(1)
  expect(h.fixtureErrors).toEqual([])
},15000)
