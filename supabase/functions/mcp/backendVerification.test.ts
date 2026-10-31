import { beforeAll, beforeEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import rrule from 'rrule'
import { hashApiKey } from './hash'
import { ProjectScope, type ScopeClient } from './scoping'

type Row = Record<string, unknown>
interface TaskRepository {
  findByProjectId(project: string): Promise<Row[]>
  findById(id: string): Promise<Row | undefined>
  findSubtasks(id: string): Promise<Row[]>
  findMyDay(user: string): Promise<Row[]>
  search(filters: Row): Promise<Row[]>
  reorder(ids: string[]): Promise<void>
  duplicate(id: string, newId: string): Promise<Row | undefined>
  saveAsTemplate(id: string, newId: string): Promise<Row | undefined>
}
interface Module {
  TaskRepo: new (client: SupabaseClient, user: string, scope: unknown) => TaskRepository
  createHandlers(repos: unknown, user: string): Record<string, (args: Row) => Promise<unknown>>
}
interface Recorded { table: string; method: string; params: URLSearchParams; body: Row | null }
let module: Module
let serve: (request: Request) => Promise<Response>
let environment: Map<string,string>
let rows: Record<string,Row[]>
let requests: Recorded[]
let rejectReads = false
let rejectWrites = false
let cap = 137
let writeDelay = 0
let deleteAfterTaskRead = false
let appliedKeyWrites = 0
const inValues = new Map<string,Set<string>>()

function split(value: string): string[] {
  const out: string[] = []; let depth=0, quoted=false, escaped=false, start=0
  for (let i=0;i<value.length;i++) {
    const c=value[i]
    if (escaped) { escaped=false; continue }
    if (c==='\\') { escaped=true; continue }
    if (c==='"') quoted=!quoted
    if (quoted) continue
    if (c==='(') depth++
    if (c===')') depth--
    if (c===',' && depth===0) { out.push(value.slice(start,i));start=i+1 }
  }
  out.push(value.slice(start)); return out
}
function scalar(value: string): unknown {
  try { return JSON.parse(value) } catch { return value }
}
function predicate(row: Row, filter: string): boolean {
  if (filter.startsWith('and(')) return split(filter.slice(4,-1)).every((s)=>predicate(row,s))
  if (filter.startsWith('or(')) return split(filter.slice(3,-1)).some((s)=>predicate(row,s))
  const [,column,operator,value] = filter.match(/^([^.]+)\.([^.]+)\.(.*)$/) ?? []
  const actual=row[column]
  const expected=scalar(value)
  if (operator==='eq') return String(actual)===String(expected)
  if (operator==='neq') return String(actual)!==String(expected)
  if (operator==='is') return expected===null ? actual==null : actual===expected
  if (operator==='gt') return actual!=null && (actual as string)>(expected as string)
  if (operator==='lt') return actual!=null && (actual as string)<(expected as string)
  if (operator==='gte') return actual!=null && (actual as string)>=(expected as string)
  if (operator==='lte') return actual!=null && (actual as string)<=(expected as string)
  if (operator==='in') {
    if (!inValues.has(value)) inValues.set(value,new Set(split(value.slice(1,-1)).map(scalar).map(String)))
    return inValues.get(value)!.has(String(actual))
  }
  if (operator==='ilike') return String(actual??'').toLowerCase().includes(String(expected).replaceAll('%','').toLowerCase())
  throw new Error('Unsupported fixture predicate: '+filter)
}

async function fetchFixture(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url=new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname!=='127.0.0.1') throw new Error('External network forbidden in verifier')
  const table=url.pathname.split('/').at(-1)!
  const method=init?.method??'GET'
  const body=typeof init?.body==='string' ? JSON.parse(init.body) as Row : null
  const params=url.searchParams
  requests.push({table,method,params:new URLSearchParams(params),body})
  if (rejectReads && method==='GET' && table==='tasks') return Response.json({message:'Synthetic unavailable',code:'PGRST000'},{status:503})
  if (rejectWrites && method==='PATCH') return Response.json({message:'Synthetic write denied',code:'42501'},{status:403})
  let data=(rows[table]??[]).filter(row => [...params].every(([key,value]) => {
    if (['select','order','limit','offset','on_conflict'].includes(key)) return true
    if (key==='or') return split(value.slice(1,-1)).some(s=>predicate(row,s))
    return predicate(row,`${key}.${value}`)
  }))
  if (method==='PATCH') {
    if (writeDelay) await new Promise(done=>setTimeout(done,writeDelay))
    // Re-evaluate the atomic conditional update after competing writes settle.
    data=data.filter(row => params.getAll('or').every(value=>split(value.slice(1,-1)).some(s=>predicate(row,s))))
    for (const row of data) Object.assign(row,body)
    if (table==='api_keys') appliedKeyWrites+=data.length
    if (params.has('select')) {
      if (new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object')) {
        if (data.length!==1) return Response.json({message:'No rows',code:'PGRST116',details:'The result contains 0 rows'},{status:406})
        return Response.json(data[0])
      }
      return Response.json(data)
    }
    return new Response(null,{status:204})
  }
  if (method==='POST') { rows[table]??=[];rows[table].push(body!);return Response.json(body,{status:201}) }
  if (method==='DELETE') { rows[table]=(rows[table]??[]).filter(r=>!data.includes(r));return Response.json(data) }
  const order=(params.get('order')??'').split(',').filter(Boolean)
  data.sort((a,b)=>{
    for(const part of order) {
      const [column,direction]=part.split('.')
      if (a[column]===b[column]) continue
      return (a[column]!<b[column]! ? -1 : 1)*(direction==='desc'?-1:1)
    }
    return 0
  })
  data=data.slice(0,Math.min(cap,Number(params.get('limit')??cap)))
  const headers=new Headers(init?.headers)
  if (deleteAfterTaskRead && table==='tasks') { rows.tasks=[];deleteAfterTaskRead=false }
  if (headers.get('accept')?.includes('vnd.pgrst.object')) {
    if (data.length!==1) return Response.json({message:'No rows',code:'PGRST116',details:'The result contains 0 rows'},{status:406})
    return Response.json(data[0])
  }
  const selection=params.get('select')
  if (selection && selection!=='*') data=data.map(row=>Object.fromEntries(selection.split(',').map(k=>[k.trim(),row[k.trim()]])))
  return Response.json(data)
}
const client = (): SupabaseClient => createClient('http://127.0.0.1:9988','synthetic-service-key',{
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchFixture}
})

beforeAll(async()=>{
  const result=await build({entryPoints:[new URL('./index.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{
    name:'isolated-deno-runtime',setup(b) {
      b.onResolve({filter:/^(mcp-lite|npm:)/},a=>({path:a.path,namespace:'fixture'}))
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.startsWith('npm:@supabase/')
        ? 'export const createClient=(...args)=>globalThis.makeClient(...args)'
        : a.path.startsWith('npm:rrule') ? 'export default globalThis.rrule'
        : `export class McpServer { handlers=new Map(); tool(name,definition){this.handlers.set(name,definition.handler)} }
           export class StreamableHttpTransport {bind(server){return async(req,context)=>{const {tool,args}=await req.json();return Response.json(await server.handlers.get(tool)(args??{},context))}}}`
      }))
    }
  }]})
  const exports={};const runtime={module:{exports},exports,makeClient:()=>client(),rrule,console,URL,Response,Request,Headers,Date,TextEncoder,crypto,
    Deno:{env:{get:(name:string)=>environment.get(name)},serve:(fn:typeof serve)=>{serve=fn}}
  }
  runInNewContext(result.outputFiles[0].text,runtime,{filename:'isolated-mcp.cjs'})
  module=runtime.module.exports as Module
})
beforeEach(()=>{
  environment=new Map([['SUPABASE_URL','http://127.0.0.1:9988'],['SUPABASE_SERVICE_ROLE_KEY','synthetic-service-key']])
  rows={}; requests=[]; rejectReads=false;rejectWrites=false;cap=137;writeDelay=0;deleteAfterTaskRead=false;appliedKeyWrites=0
  inValues.clear()
})

function task(n: number, project='p', owner='alice'): Row {
  return {id:`task-${String(n).padStart(5,'0')}`,project_id:project,owner_id:owner,title:`Task ${n}`,description:'searchable',
    parent_id:null,is_archived:0,is_template:0,is_in_my_day:1,deleted_at:null,order_index:1500-n,status_id:'open',updated_at:'2026-01-01T00:00:00Z'}
}
function repository(user='alice', projects=['p']): TaskRepository {
  return new module.TaskRepo(client(),user,{idArray:async()=>projects,isMember:async(p:string)=>projects.includes(p)})
}
async function key(raw: string,user: string,last: string | null = null): Promise<void> {
  rows.api_keys??=[];rows.api_keys.push({key_hash:await hashApiKey(raw),user_id:user,last_used_at:last})
  rows.project_members??=[];rows.project_members.push({project_id:user+'-project',user_id:user})
}
async function call(raw: string, tool: string,args: Row={}): Promise<Response> {
  return serve(new Request('http://127.0.0.1:9988/functions/v1/mcp',{method:'POST',headers:{Authorization:'Bearer '+raw,'Content-Type':'application/json'},body:JSON.stringify({tool,args})}))
}
const settle = async():Promise<void>=>{for(let i=0;i<5;i++)await new Promise(setImmediate)}

it('returns 1,201 tasks across more than two lower-cap pages in intended order without duplicates',async()=>{
  rows.tasks=Array.from({length:1201},(_,n)=>task(n))
  const actual=await repository().findByProjectId('p')
  expect(actual).toHaveLength(1201)
  expect(new Set(actual.map(r=>r.id)).size).toBe(1201)
  expect(actual[0].order_index).toBe(300)
  expect(actual.at(-1)!.order_index).toBe(1500)
  expect(requests.filter(r=>r.table==='tasks')).toHaveLength(10)
})

it('paginates filtered search, My Day and subtasks without widening project scope',async()=>{
  rows.tasks=Array.from({length:721},(_,n)=>task(n))
  rows.tasks.push({...task(9999,'private','bob')})
  const repo=repository()
  expect(await repo.search({keyword:'Task'})).toHaveLength(721)
  expect(await repo.findMyDay('alice')).toHaveLength(721)
  rows.tasks=rows.tasks.map(r=>({...r,parent_id:'parent'}))
  expect(await repo.findSubtasks('parent')).toHaveLength(721)
  expect((await repo.search({keyword:'Task 720'})).map(r=>r.id)).toEqual(['task-00720'])
})

it('propagates read outages and rejected reorder writes as tool errors',async()=>{
  rows.tasks=[task(0)]
  const repo=repository()
  const handlers=module.createHandlers({tasks:repo,settings:{get:async()=>null}},'alice')
  rejectReads=true
  await expect(handlers.list_tasks({project_id:'p'})).rejects.toThrow(/Synthetic unavailable/)
  rejectReads=false;rejectWrites=true
  await expect(handlers.reorder_tasks({task_ids:['task-00000']})).rejects.toThrow(/Synthetic write denied/)
})

it('does not acknowledge a reorder if access disappears after the preflight read',async()=>{
  const repo=repository()
  rows.tasks=[task(0)]
  deleteAfterTaskRead=true
  const handlers=module.createHandlers({tasks:repo,settings:{get:async()=>null}},'alice')
  await expect(handlers.reorder_tasks({task_ids:['task-00000']})).rejects.toThrow()
})

it('reorders successfully with narrow patches and preserves unrelated fields',async()=>{
  rows.tasks=[task(0),task(1)]
  const repo=repository()
  const handlers=module.createHandlers({tasks:repo,settings:{get:async()=>null}},'alice')
  await expect(handlers.reorder_tasks({task_ids:['task-00001','task-00000']})).resolves.toMatchObject({reordered:true,count:2})
  expect(rows.tasks.map(r=>({id:r.id,title:r.title,index:r.order_index}))).toEqual([
    {id:'task-00000',title:'Task 0',index:1},{id:'task-00001',title:'Task 1',index:0}
  ])
  for(const request of requests.filter(r=>r.method==='PATCH')) expect(Object.keys(request.body!).sort()).toEqual(['order_index','updated_at'])
})

it('denies ordinary global release-note publishing by default and permits only the configured administrator',async()=>{
  const normal=module.createHandlers({},'alice')
  await expect(normal.set_whats_new({content:'Synthetic note'})).rejects.toThrow(/release administrator/)
  expect(requests).toHaveLength(0)
  environment.set('TODOOZY_RELEASE_ADMIN_IDS',' bob, carol ')
  await expect(normal.set_whats_new({content:'Synthetic note'})).rejects.toThrow(/release administrator/)
  const admin=module.createHandlers({},'bob')
  await expect(admin.set_whats_new({content:'Synthetic note',version:'synthetic'})).resolves.toMatchObject({success:true})
  expect(rows.release_notes).toHaveLength(1)
})

it('authenticates each request but coalesces recent-key last-used writes and honors revocation',async()=>{
  await key('synthetic-alice','alice')
  for(let n=0;n<4;n++) {
    const result=await call('synthetic-alice','list_my_day')
    expect(result.status).toBe(200)
    expect((await result.json()).isError).not.toBe(true)
    await settle()
  }
  expect(requests.filter(r=>r.table==='api_keys'&&r.method==='GET')).toHaveLength(4)
  expect(requests.filter(r=>r.table==='api_keys'&&r.method==='PATCH')).toHaveLength(1)
  rows.api_keys=[]
  expect((await call('synthetic-alice','list_my_day')).status).toBe(401)
})

it('keeps delayed concurrent users and their membership queries isolated',async()=>{
  await key('synthetic-alice','alice',new Date().toISOString())
  await key('synthetic-bob','bob',new Date().toISOString())
  rows.tasks=[task(1,'alice-project','alice'),task(2,'bob-project','bob')]
  const responses=await Promise.all([call('synthetic-alice','list_my_day'),call('synthetic-bob','list_my_day')])
  const envelopes=await Promise.all(responses.map(r=>r.json()))
  expect(JSON.parse(envelopes[0].content[0].text).map((r:Row)=>r.owner_id)).toEqual(['alice'])
  expect(JSON.parse(envelopes[1].content[0].text).map((r:Row)=>r.owner_id)).toEqual(['bob'])
})

it('coalesces concurrent usage mutations across isolates without skipping authentication',async()=>{
  await key('synthetic-alice','alice')
  writeDelay=5
  const results=await Promise.all(Array.from({length:5},()=>call('synthetic-alice','list_my_day')))
  expect(results.map(r=>r.status)).toEqual([200,200,200,200,200])
  await new Promise(done=>setTimeout(done,15))
  expect(requests.filter(r=>r.table==='api_keys'&&r.method==='GET')).toHaveLength(5)
  expect(appliedKeyWrites).toBe(1)
})

it('returns every project label beyond the API row cap',async()=>{
  await key('synthetic-alice','alice',new Date().toISOString())
  rows.project_labels=Array.from({length:701},(_,n)=>({project_id:'alice-project',label_id:`label-${String(n).padStart(5,'0')}`,deleted_at:null}))
  rows.user_labels=rows.project_labels.map(r=>({id:r.label_id,name:r.label_id,color:'#fff',user_id:'bob'}))
  const response=await call('synthetic-alice','list_labels',{project_id:'alice-project'})
  const result=await response.json()
  expect(result.isError).not.toBe(true)
  expect(JSON.parse(result.content[0].text)).toHaveLength(701)
})

it('loads membership beyond the response cap so late projects remain accessible',async()=>{
  rows.project_members=Array.from({length:701},(_,n)=>({project_id:`p-${String(n).padStart(5,'0')}`,user_id:'alice'}))
  const scope=new ProjectScope(client() as unknown as ScopeClient,'alice')
  expect(await scope.isMember('p-00700')).toBe(true)
})

it('shares one membership load across concurrent scope checks',async()=>{
  rows.project_members=[{project_id:'p',user_id:'alice'}]
  const scope=new ProjectScope(client() as unknown as ScopeClient,'alice')
  expect(await Promise.all([scope.isMember('p'),scope.idArray(),scope.isMember('other')])).toEqual([true,['p'],false])
  expect(requests.filter(r=>r.table==='project_members')).toHaveLength(2) // one page + terminal empty page
})

it.each(['duplicate','saveAsTemplate'] as const)('%s preserves grandchildren and reference links through the MCP route',async(method)=>{
  rows.tasks=[
    {...task(1),reference_url:'https://example.invalid/root'},
    {...task(2),parent_id:'task-00001',reference_url:'https://example.invalid/child'},
    {...task(3),parent_id:'task-00002',reference_url:'https://example.invalid/grandchild'}
  ]
  const originals=new Set(rows.tasks.map(t=>t.id))
  const created=await repository()[method]('task-00001','copied-root')
  expect(created?.id).toBe('copied-root')
  const copies=rows.tasks.filter(t=>!originals.has(t.id))
  expect(copies).toHaveLength(3)
  expect(copies.map(t=>t.reference_url).sort()).toEqual([
    'https://example.invalid/root','https://example.invalid/child','https://example.invalid/grandchild'
  ].sort())
  const child=copies.find(t=>t.parent_id==='copied-root')!
  expect(copies.some(t=>t.parent_id===child.id)).toBe(true)
  if(method==='saveAsTemplate')expect(copies.every(t=>t.is_template===1)).toBe(true)
})

it.each(['duplicate','saveAsTemplate'] as const)('%s rejects a cyclic source hierarchy rather than recursing indefinitely',async(method)=>{
  rows.tasks=[{...task(1),parent_id:'task-00002'},{...task(2),parent_id:'task-00001'}]
  await expect(repository()[method]('task-00001','copied-root')).rejects.toThrow(/cyclic task hierarchy/)
  expect(requests.length).toBeLessThan(30)
  expect(requests.filter(r=>r.method!=='GET')).toHaveLength(0)
  expect(rows.tasks).toHaveLength(2)
})

async function sharedLabelFixture(): Promise<void> {
  await key('synthetic-alice','alice',new Date().toISOString())
  rows.project_members.push({project_id:'other-member-project',user_id:'alice'})
  rows.tasks=[task(1,'alice-project','bob'),{...task(2,'alice-project','bob'),parent_id:'task-00001'}]
  rows.user_labels=[
    {id:'own',user_id:'alice',name:'Own',color:'#123456',deleted_at:null},
    {id:'shared',user_id:'bob',name:'Shared',color:'#abcdef',deleted_at:null},
    {id:'private',user_id:'bob',name:'Private',color:'#fff',deleted_at:null},
    {id:'wrong-project',user_id:'bob',name:'Wrong project',color:'#fff',deleted_at:null},
    {id:'deleted-label',user_id:'bob',name:'Deleted',color:'#fff',deleted_at:'2026-01-01'},
    {id:'deleted-link',user_id:'bob',name:'Deleted link',color:'#fff',deleted_at:null}
  ]
  rows.project_labels=[
    {project_id:'alice-project',label_id:'shared',deleted_at:null},
    {project_id:'other-member-project',label_id:'wrong-project',deleted_at:null},
    {project_id:'alice-project',label_id:'deleted-label',deleted_at:null},
    {project_id:'alice-project',label_id:'deleted-link',deleted_at:'2026-01-01'},
    {project_id:'alice-project',label_id:'missing-label',deleted_at:null}
  ]
  rows.task_labels=[]
}

it('assigns an active own label or another member’s active same-project label through the authenticated MCP route',async()=>{
  await sharedLabelFixture()
  for(const labelId of ['own','shared']) {
    const envelope=await (await call('synthetic-alice','assign_label_to_task',{task_id:'task-00001',label_id:labelId})).json()
    expect(envelope.isError).not.toBe(true)
    expect(JSON.parse(envelope.content[0].text)).toMatchObject({assigned:true,label_id:labelId})
  }
  expect(rows.task_labels.map(r=>r.label_id).sort()).toEqual(['own','shared'])
  expect(JSON.parse(String(rows.tasks[0].label_names))).toEqual([
    {name:'Own',color:'#123456'},{name:'Shared',color:'#abcdef'}
  ])
})

it.each(['duplicate_task','save_task_as_template'])('%s preserves another member’s legitimate project labels on root and descendant',async(tool)=>{
  await sharedLabelFixture()
  rows.task_labels=[{task_id:'task-00001',label_id:'own'},{task_id:'task-00001',label_id:'shared'},{task_id:'task-00002',label_id:'shared'}]
  const envelope=await (await call('synthetic-alice',tool,{task_id:'task-00001'})).json()
  expect(envelope.isError).not.toBe(true)
  const root=JSON.parse(envelope.content[0].text) as Row
  const child=rows.tasks.find(t=>t.parent_id===root.id)!
  expect(child).toBeDefined()
  expect(rows.tasks).toHaveLength(4)
  expect(rows.task_labels.filter(r=>r.task_id===root.id).map(r=>r.label_id).sort()).toEqual(['own','shared'])
  expect(rows.task_labels.filter(r=>r.task_id===child.id).map(r=>r.label_id)).toEqual(['shared'])
  if(tool==='save_task_as_template')expect([root.is_template,child.is_template]).toEqual([1,1])
})

const unavailableLabels=['private','wrong-project','deleted-label','deleted-link','missing-label']
it.each(unavailableLabels)('rejects unavailable label %s before assignment writes',async(labelId)=>{
  await sharedLabelFixture()
  const envelope=await (await call('synthetic-alice','assign_label_to_task',{task_id:'task-00001',label_id:labelId})).json()
  expect(envelope.isError).toBe(true)
  expect(envelope.content[0].text).toMatch(/Label not found/)
  expect(requests.filter(r=>r.method!=='GET')).toHaveLength(0)
  expect(rows.task_labels).toHaveLength(0)
})

it.each(['duplicate_task','save_task_as_template'].flatMap(tool=>unavailableLabels.map(labelId=>({tool,labelId}))))('$tool preflights invalid descendant label $labelId with zero writes',async({tool,labelId})=>{
  await sharedLabelFixture()
  rows.task_labels=[{task_id:'task-00001',label_id:'own'},{task_id:'task-00002',label_id:labelId}]
  const envelope=await (await call('synthetic-alice',tool,{task_id:'task-00001'})).json()
  expect(envelope.isError).toBe(true)
  expect(envelope.content[0].text).toMatch(/Label not found/)
  expect(requests.filter(r=>r.method!=='GET')).toHaveLength(0)
  expect(rows.tasks).toHaveLength(2)
  expect(rows.task_labels).toHaveLength(2)
})
