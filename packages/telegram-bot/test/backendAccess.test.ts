import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import TelegramBot from 'node-telegram-bot-api'

type Row = Record<string, unknown>
interface Recorded { table: string; method: string; params: URLSearchParams; body: Row | Row[] | null; returnedRows?: number }
let api: typeof import('../src/supabase')
let rows: Record<string,Row[]>
let requests: Recorded[]
let failure: { table: string; method: string; status: number } | null
let cap = 137
const inValues = new Map<string,Set<string>>()

function split(value: string): string[] {
  const result:string[]=[]; let depth=0,quoted=false,escaped=false,start=0
  for(let n=0;n<value.length;n++) {
    const c=value[n]
    if(escaped){escaped=false;continue}
    if(c==='\\'){escaped=true;continue}
    if(c==='"')quoted=!quoted
    if(quoted)continue
    if(c==='(')depth++
    if(c===')')depth--
    if(c===','&&depth===0){result.push(value.slice(start,n));start=n+1}
  }
  result.push(value.slice(start));return result
}
function scalar(value:string):unknown { try{return JSON.parse(value)}catch{return value} }
function match(row:Row,filter:string):boolean {
  if(filter.startsWith('and('))return split(filter.slice(4,-1)).every(f=>match(row,f))
  if(filter.startsWith('or('))return split(filter.slice(3,-1)).some(f=>match(row,f))
  const [,column,operator,value]=filter.match(/^([^.]+)\.([^.]+)\.(.*)$/)??[]
  const actual=row[column], expected=scalar(value)
  if(operator==='not')return !match(row,`${column}.${value}`)
  if(operator==='eq')return String(actual)===String(expected)
  if(operator==='neq')return String(actual)!==String(expected)
  if(operator==='is')return expected===null?actual==null:actual===expected
  if(operator==='gt')return actual!=null&&(actual as string)>(expected as string)
  if(operator==='lt')return actual!=null&&(actual as string)<(expected as string)
  if(operator==='lte')return actual!=null&&(actual as string)<=(expected as string)
  if(operator==='in') {
    if(!inValues.has(value))inValues.set(value,new Set(split(value.slice(1,-1)).map(scalar).map(String)))
    return inValues.get(value)!.has(String(actual))
  }
  throw new Error('Unsupported isolated query: '+filter)
}
async function fetchFixture(input:string|URL|Request,init?:RequestInit):Promise<Response> {
  const url=new URL(input instanceof Request?input.url:String(input))
  if(url.hostname!=='127.0.0.1')throw new Error('External request forbidden in bot verifier')
  const table=url.pathname.split('/').at(-1)!,method=init?.method??'GET',params=url.searchParams
  const body=typeof init?.body==='string'?JSON.parse(init.body) as Row|Row[]:null
  const request: Recorded = {table,method,params:new URLSearchParams(params),body}
  requests.push(request)
  if(failure?.table===table&&failure.method===method) return Response.json({message:'Synthetic backend failure',code:failure.status===409?'23503':'PGRST000'},{status:failure.status})
  const selected=(rows[table]??[]).filter(row=>[...params].every(([column,value])=>{
    if(['select','limit','order','offset','on_conflict'].includes(column))return true
    if(column==='or')return split(value.slice(1,-1)).some(f=>match(row,f))
    return match(row,`${column}.${value}`)
  }))
  if(method==='POST') {
    rows[table]??=[];rows[table].push(...(Array.isArray(body)?body:[body!]))
    return Response.json(body,{status:201})
  }
  if(method==='PATCH') {
    for(const row of selected)Object.assign(row,body)
    if(new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object')) {
      if(selected.length!==1)return Response.json({message:'No rows',details:'The result contains 0 rows',code:'PGRST116'},{status:406})
      return Response.json(selected[0])
    }
    return params.has('select')?Response.json(selected):new Response(null,{status:204})
  }
  const order=(params.get('order')??'').split(',').filter(Boolean)
  selected.sort((a,b)=>{
    for(const item of order){const[column,direction]=item.split('.');if(a[column]!==b[column])return(a[column]!<b[column]!?-1:1)*(direction==='desc'?-1:1)}
    return 0
  })
  let data=selected.slice(0,Math.min(cap,Number(params.get('limit')??cap)))
  request.returnedRows=data.length
  if(new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object')) {
    if(data.length!==1)return Response.json({message:'No rows',details:'The result contains 0 rows',code:'PGRST116'},{status:406})
    return Response.json(data[0])
  }
  const projection=params.get('select')
  if(projection&&projection!=='*')data=data.map(row=>Object.fromEntries(projection.split(',').map(k=>[k.trim(),row[k.trim()]])))
  return Response.json(data)
}
beforeAll(async()=>{
  vi.stubEnv('SUPABASE_URL','http://127.0.0.1:9989')
  vi.stubEnv('SUPABASE_SERVICE_KEY','synthetic-service-key-never-real')
  vi.stubEnv('TODOOZY_USER_ID','alice')
  vi.stubEnv('TODOOZY_TIME_ZONE','Europe/Brussels')
  vi.stubGlobal('fetch',fetchFixture)
  api=await import('../src/supabase')
})
afterAll(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers()})
function project(id='p',owner='alice'):Row{return{id,name:id,owner_id:owner,is_archived:0,deleted_at:null}}
function status(project_id='p',done=false):Row{return{id:project_id+(done?'-done':'-open'),project_id,name:done?'Done':'Open',is_default:done?0:1,is_done:done?1:0,order_index:done?1:0,deleted_at:null}}
function task(n:number,project_id='p',owner_id='alice'):Row{return{id:`task-${String(n).padStart(5,'0')}`,project_id,owner_id,title:`Task ${n}`,status_id:project_id+'-open',is_archived:0,is_template:0,is_in_my_day:1,parent_id:null,deleted_at:null,due_date:null,order_index:n,created_at:`2026-10-${String(n%28+1).padStart(2,'0')}T10:00:00Z`,updated_at:'2026-10-01T10:00:00Z',completed_date:null}}
beforeEach(()=>{
  rows={projects:[project()],project_members:[{project_id:'p',user_id:'alice'}],statuses:[status(),status('p',true)],tasks:[],user_labels:[],task_labels:[],user_settings:[]}
  requests=[];failure=null;cap=137;inValues.clear()
})
const createParams=()=>({projectId:'p',title:'Synthetic task',priority:0,dueDate:null,referenceUrl:null,statusId:null,labelIds:[] as string[]})

it('My Day restricts owner and membership while recent shared tasks remain visible',async()=>{
  rows.projects.push(project('shared','bob'),project('private','bob'))
  rows.project_members.push({project_id:'shared',user_id:'alice'},{project_id:'private',user_id:'bob'})
  rows.statuses.push(status('shared'),status('private'))
  rows.tasks=[task(1),task(2,'shared','bob'),task(3,'shared','alice'),task(4,'private','bob')]
  expect((await api.getMyDayTasks()).map(t=>t.id).sort()).toEqual(['task-00001','task-00003'])
  expect((await api.getRecentTasks(20)).map(t=>t.id).sort()).toEqual(['task-00001','task-00002','task-00003'])
  await expect(api.getProjectTasks('private')).rejects.toThrow(/unavailable|revoked/)
  expect(await api.completeTask('task-00004')).toBe(false)
  expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(0)
})

it('hides deleted and archived projects plus deleted/template/archived tasks in every active list',async()=>{
  rows.projects.push({...project('deleted'),deleted_at:'2026-01-01'}, {...project('archived'),is_archived:1})
  rows.project_members.push({project_id:'deleted',user_id:'alice'},{project_id:'archived',user_id:'alice'})
  rows.tasks=[task(1),{...task(2),deleted_at:'2026-01-01'},{...task(3),is_template:1},{...task(4),is_archived:1},task(5,'deleted'),task(6,'archived')]
  expect((await api.getProjects()).map(p=>p.id)).toEqual(['p'])
  expect((await api.getProjectTasks('p')).map(t=>t.id)).toEqual(['task-00001'])
  expect((await api.getMyDayTasks()).map(t=>t.id)).toEqual(['task-00001'])
  expect((await api.getRecentTasks(20)).map(t=>t.id)).toEqual(['task-00001'])
  expect(await api.completeTask('task-00002')).toBe(false)
  expect(await api.completeTask('task-00003')).toBe(false)
})

it('does not complete an archived task via an arbitrary id',async()=>{
  rows.tasks=[{...task(1),is_archived:1}]
  expect(await api.completeTask('task-00001')).toBe(false)
  expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(0)
})

it('pages 1,001 tasks and more than 200 membership/association ids without truncation',async()=>{
  rows.projects=Array.from({length:221},(_,n)=>project(`p-${String(n).padStart(4,'0')}`))
  rows.project_members=rows.projects.map(p=>({project_id:p.id,user_id:'alice'}))
  rows.statuses=rows.projects.map(p=>status(String(p.id)))
  rows.tasks=Array.from({length:1001},(_,n)=>task(n,String(rows.projects[n%rows.projects.length].id)))
  rows.user_labels=rows.tasks.map(t=>({id:'label-'+t.id,user_id:'alice',name:'Label '+t.id,color:'#fff',deleted_at:null}))
  rows.task_labels=rows.tasks.map(t=>({task_id:t.id,label_id:'label-'+t.id,deleted_at:null}))
  const results=await api.getMyDayTasks()
  expect(results).toHaveLength(1001)
  expect(new Set(results.map(t=>t.id)).size).toBe(1001)
  expect(results.every(t=>t.labels.length===1)).toBe(true)
  for(const request of requests)for(const [column,value]of request.params) {
    if(value.startsWith('in.('))expect(split(value.slice(4,-1)).length,`${request.table}.${column}`).toBeLessThanOrEqual(200)
  }
})

it('pages a large single-project list and honors deliberate recent/completed limits after filtering',async()=>{
  rows.tasks=Array.from({length:1001},(_,n)=>task(n))
  expect(await api.getProjectTasks('p')).toHaveLength(1001)
  expect(await api.getRecentTasks(7)).toHaveLength(7)
  rows.tasks=rows.tasks.map((row,n)=>({...row,status_id:n%2?'p-done':'p-open',completed_date:n%2?'2026-10-30T10:00:00Z':null}))
  expect(await api.getRecentlyCompletedTasks(9)).toHaveLength(9)
  expect(await api.getProjectTasks('p')).toHaveLength(501)
})

it.each([false,true])('downloads only the requested recent results across timestamp ties under a two-row server cap (completed=%s)',async(completed)=>{
  cap=2
  rows.projects.push(project('shared','bob'),project('private','bob'))
  rows.project_members.push({project_id:'shared',user_id:'alice'},{project_id:'private',user_id:'bob'})
  rows.statuses.push(status('shared'),status('shared',true),status('private'),status('private',true))
  const column=completed?'completed_date':'created_at', wantedStatus=completed?'p-done':'p-open'
  rows.tasks=Array.from({length:1000},(_,n)=>({...task(n),status_id:wantedStatus,[column]:'2025-01-01T10:00:00Z'}))
  const tied=Array.from({length:6},(_,n)=>({...task(2000+n),status_id:wantedStatus,[column]:'2026-10-30T10:00:00Z'}))
  // A shared-project result belongs to Bob but is still visible through Alice's membership.
  tied[5]={...tied[5],project_id:'shared',owner_id:'bob',status_id:completed?'shared-done':'shared-open'}
  rows.tasks.push(...tied,
    {...task(3000,'private','bob'),status_id:completed?'private-done':'private-open',[column]:'2026-10-31T10:00:00Z'},
    {...task(3001),status_id:completed?'p-open':'p-done',[column]:'2026-10-31T10:00:00Z'},
    {...task(3002),status_id:wantedStatus,is_archived:1,[column]:'2026-10-31T10:00:00Z'},
    {...task(3003),status_id:wantedStatus,is_template:1,[column]:'2026-10-31T10:00:00Z'},
    {...task(3004),status_id:wantedStatus,deleted_at:'2026-10-31T10:00:00Z',[column]:'2026-10-31T10:00:00Z'})
  if(completed)rows.tasks.push({...task(3005),status_id:wantedStatus,completed_date:null})
  const result=await (completed?api.getRecentlyCompletedTasks(5):api.getRecentTasks(5))
  expect(result.map(t=>t.id)).toEqual(['task-02005','task-02004','task-02003','task-02002','task-02001'])
  expect(result[0].project_name).toBe('shared')
  const taskReads=requests.filter(r=>r.table==='tasks'&&r.method==='GET')
  expect(taskReads).toHaveLength(3)
  expect(taskReads.map(r=>r.returnedRows)).toEqual([2,2,1])
  expect(taskReads.reduce((n,r)=>n+(r.returnedRows??0),0)).toBe(5)
  expect(taskReads.slice(1).every(r=>r.params.has('or'))).toBe(true)
})

it('clearly reports partial task creation if requested labels cannot be saved',async()=>{
  rows.user_labels=[{id:'label-1',user_id:'alice',name:'One',color:'#fff',deleted_at:null}]
  failure={table:'task_labels',method:'POST',status:409}
  await expect(api.createTask({...createParams(),labelIds:['label-1']})).rejects.toThrow(/Task created \(.+\).*labels were not saved.*do not recreate/i)
  expect(rows.tasks).toHaveLength(1)
  expect(rows.task_labels).toHaveLength(0)
})

it('tells the message sender that a task already exists when label assignment fails',async()=>{
  rows.user_labels=[{id:'label-1',user_id:'alice',name:'One',color:'#fff',deleted_at:null}]
  failure={table:'task_labels',method:'POST',status:409}
  const handlers=new Map<string,(message:unknown)=>Promise<void>>()
  const sent:string[]=[]
  const output=await build({entryPoints:[new URL('../src/index.ts',import.meta.url).pathname],platform:'node',format:'cjs',bundle:true,write:false,logLevel:'silent',plugins:[{
    name:'isolated-bot-effects',setup(b) {
      b.onResolve({filter:/^(fs|node:fs|node-telegram-bot-api)$/},a=>({path:a.path,namespace:'fixture'}))
      b.onResolve({filter:/^\.\/pollingWatchdog$/},a=>a.importer.endsWith('/src/index.ts')?{path:'watchdog',namespace:'fixture'}:undefined)
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='node-telegram-bot-api'
        ? `export default class Bot {on(name,handler){globalThis.captureHandler(name,handler)} async setMyCommands(){} async sendMessage(_chat,text){globalThis.recordMessage(text)} async answerCallbackQuery(){} }`
        : a.path==='watchdog' ? 'export const startPollingWatchdog=()=>({shutdown:async()=>{}}); export const logBotFailure=()=>{}'
        : 'export const existsSync=()=>false; export const writeFileSync=()=>{}; export const unlinkSync=()=>{}; export const readFileSync=()=>{throw Error("No real files in verifier")}'}))
    }
  }]})
  const syntheticProcess={...process,env:{SUPABASE_URL:'http://127.0.0.1:9989',SUPABASE_SERVICE_KEY:'synthetic-service-key',TODOOZY_USER_ID:'alice',TELEGRAM_BOT_TOKEN:'12345:SYNTHETIC_ONLY',ALLOWED_TELEGRAM_IDS:'42'},
    on:()=>{},kill:()=>{throw new Error('Process mutation forbidden')},exit:()=>{throw new Error('Process exit forbidden')},pid:999999}
  const exports={}
  runInNewContext(output.outputFiles[0].text,{module:{exports},exports,require:createRequire(import.meta.url),process:syntheticProcess,
    __dirname:'/isolated-bot',console:{...console,log:()=>{}},fetch:fetchFixture,URL,Request,Response,Headers,TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,setTimeout,clearTimeout,setInterval,clearInterval,Buffer,
    captureHandler:(name:string,handler:(message:unknown)=>Promise<void>)=>handlers.set(name,handler),recordMessage:(text:string)=>sent.push(text)
  },{filename:'isolated-bot.cjs'})
  await handlers.get('message')!({text:'Synthetic task @one /p',from:{id:42},chat:{id:42}})
  expect(rows.tasks).toHaveLength(1)
  expect(sent.at(-1)).toMatch(/task created|task already|do not recreate|labels were not saved/i)
  expect(sent.at(-1)).toContain(String(rows.tasks[0].id))
  expect(sent.at(-1)).not.toMatch(/Please try again/)
})

it('rejects private-project, foreign-label and deleted-label arguments before creating a task',async()=>{
  rows.projects.push(project('private','bob'))
  await expect(api.createTask({...createParams(),projectId:'private'})).rejects.toThrow(/unavailable|revoked/)
  rows.user_labels=[{id:'foreign',user_id:'bob',name:'Foreign',color:'#fff',deleted_at:null},{id:'deleted',user_id:'alice',name:'Deleted',color:'#fff',deleted_at:'2026-01-01'}]
  await expect(api.createTask({...createParams(),labelIds:['foreign']})).rejects.toThrow(/label is unavailable/)
  await expect(api.createTask({...createParams(),labelIds:['deleted']})).rejects.toThrow(/label is unavailable/)
  expect(rows.tasks).toHaveLength(0)
  expect(requests.filter(r=>r.method==='POST')).toHaveLength(0)
})

it.each(['private-open','missing-status','deleted-status'])('rejects unavailable supplied status %s before writing a task',async(statusId)=>{
  rows.statuses.push(status('private'),{...status('p'),id:'deleted-status',deleted_at:'2026-01-01'})
  await expect(api.createTask({...createParams(),statusId})).rejects.toThrow(/status/i)
  expect(rows.tasks).toHaveLength(0)
})

it('creates an owned task with deduplicated labels and completes only the scoped task',async()=>{
  rows.user_labels=[{id:'label-1',user_id:'alice',name:'One',color:'#fff',deleted_at:null}]
  const created=await api.createTask({...createParams(),labelIds:['label-1','label-1']})
  expect(rows.tasks).toHaveLength(1)
  expect(rows.tasks[0].owner_id).toBe('alice')
  expect(rows.task_labels).toHaveLength(1)
  expect(await api.completeTask(created.id)).toBe(true)
  expect(rows.tasks[0].status_id).toBe('p-done')
  expect(rows.tasks[0].completed_date).toMatch(/Z$/)
})

it.each(['project_members','tasks','statuses','user_labels'])('surfaces %s backend read failures instead of reporting empty data',async(table)=>{
  rows.tasks=[task(1)]
  failure={table,method:'GET',status:503}
  await expect(api.getMyDayTasks()).rejects.toThrow(/Synthetic backend failure/)
})

it('uses the configured local calendar day for timestamp due dates at midnight',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-15T23:30:00Z'))
  try {
    rows.tasks=[{...task(1),is_in_my_day:0,due_date:'2026-01-15T23:45:00Z'}, {...task(2),is_in_my_day:0,due_date:'2026-01-16T23:30:00Z'}]
    expect((await api.getMyDayTasks()).map(t=>t.id)).toEqual(['task-00001'])
  }finally{vi.useRealTimers()}
})

it('keeps the real Telegram HTTP/form serialization consumer working after the qs patch',async()=>{
  const received:Array<{path:string;body:URLSearchParams}>=[]
  const server=createServer(async(request,response)=>{
    const chunks:Buffer[]=[]
    for await(const chunk of request)chunks.push(Buffer.from(chunk))
    const body=new URLSearchParams(Buffer.concat(chunks).toString())
    received.push({path:request.url??'',body})
    response.setHeader('Content-Type','application/json')
    response.end(JSON.stringify({ok:true,result:{message_id:1,date:0,chat:{id:42,type:'private'},text:body.get('text')}}))
  })
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done))
  try {
    const address=server.address()
    if(!address||typeof address==='string')throw new Error('Missing isolated server address')
    const bot=new TelegramBot('12345:SYNTHETIC_ONLY',{polling:false,baseApiUrl:`http://127.0.0.1:${address.port}`})
    const result=await bot.sendMessage(42,'Synthetic transport check',{reply_markup:{inline_keyboard:[[{text:'Done',callback_data:'done:synthetic'}]]}})
    expect(result.text).toBe('Synthetic transport check')
    expect(received).toHaveLength(1)
    expect(received[0].path).toBe('/bot12345:SYNTHETIC_ONLY/sendMessage')
    expect(received[0].body.get('chat_id')).toBe('42')
    expect(JSON.parse(received[0].body.get('reply_markup')!)).toEqual({inline_keyboard:[[{text:'Done',callback_data:'done:synthetic'}]]})
  }finally{
    server.closeAllConnections()
    await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()))
  }
})
