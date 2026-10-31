import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { labelId, makeLabelAuthorizationDatabase } from './label-authorization-fixture'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Array<{ h: Harness; pg: Awaited<ReturnType<typeof makeLabelAuthorizationDatabase>> }> = []
afterEach(async () => { for (const {h,pg} of opened.splice(0)) { await h.stop(); await pg.close() } })
const sourceId = labelId(200), canonicalId = labelId(201), unrelatedId = labelId(202), foreignId = labelId(203)
const cases = [
  { name: 'Cost%2026', unrelated: 'CostXYZ2026', canonical: 'Cost%2026' },
  { name: 'Road_map', unrelated: 'RoadXmap', canonical: 'Road_map' },
  { name: String.raw`Folder\Archive`, unrelated: 'FolderArchive', canonical: String.raw`Folder\Archive` },
  { name: String.raw`Folder\Cost%_2026`, unrelated: 'FolderCostXYZ2026', canonical: String.raw`Folder\Cost%_2026` },
  { name: 'Cost*2026', unrelated: 'CostXYZ2026', canonical: 'Cost*2026' },
  { name: 'Star*Percent', unrelated: 'Star%Percent', canonical: 'Star*Percent' },
  { name: String.raw`Folder\Cost*%_2026`, unrelated: 'FolderCostXYZ2026', canonical: String.raw`Folder\Cost*%_2026` },
  { name: 'Regex.^$+?()[]{}|', unrelated: 'RegexX', canonical: 'Regex.^$+?()[]{}|' },
  { name: 'Étiquette', unrelated: 'Étiquette extra', canonical: 'éTIQUETTE' },
  { name: 'Literal Name', unrelated: 'Literal Name extra', canonical: 'LITERAL NAME' }
]
type Row = Record<string, unknown>
type Database = Awaited<ReturnType<typeof makeLabelAuthorizationDatabase>>
type TransportOptions = {
  denied?: string[]
  queries?: Array<{user_id: string; name: string; color: string}>
  roles?: Array<{current_user: string; rolbypassrls: boolean}>
  mismatch?: boolean
  rejectReads?: boolean
}
function labelTransport(pg: Database, role: 'authenticated' | 'service_role', options: TransportOptions = {}): (input: string, init?: RequestInit) => Promise<Response> {
  const columns = new Set(['id','user_id','name','color','order_index','created_at','updated_at','deleted_at','project_id','label_id','role'])
  const bind = (key: string, value: unknown): unknown => key==='user_id' && value==='u' ? labelId(1) : key==='project_id' && value==='p0' ? labelId(10) : value
  const unbind = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key==='user_id' && value===labelId(1)?'u':key==='project_id' && value===labelId(10)?'p0':value]))
  return async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', table = url.pathname.split('/').pop()!
    expect(url.hostname).toBe('127.0.0.1'); expect(['user_labels','project_members','project_labels']).toContain(table)
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[labelId(1),role])
    await pg.exec(`SET ROLE ${role}`)
    try {
      const roleRow = (await pg.query<{current_user: string; rolbypassrls: boolean}>('SELECT current_user,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
      options.roles?.push(roleRow)
      if (options.rejectReads && method==='GET' && table==='user_labels') throw Object.assign(new Error('Synthetic read failure'),{code:'57014'})
      let rows: Row[] = []
      if (method==='POST') {
        const body = JSON.parse(String(init.body)), values = Array.isArray(body) ? body : [body]
        const conflict = url.searchParams.get('on_conflict') ?? 'id'
        expect(['id','project_id,label_id']).toContain(conflict)
        for (const row of values) {
          const keys = Object.keys(row); expect(keys.every(key=>columns.has(key))).toBe(true)
          rows.push(...(await pg.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(${conflict}) DO UPDATE SET ${keys.filter(key=>!conflict.split(',').includes(key)).map(key=>`${key}=excluded.${key}`).join(',')} RETURNING *`,keys.map(key=>bind(key,row[key])))).rows)
        }
      } else {
        const params: unknown[] = [], where: string[] = []
        for (const [key,value] of url.searchParams) {
          if (['select','order','limit','offset'].includes(key)) continue
          if (key==='or') {
            const [column,operator,...rest] = value.slice(1,-1).split('.')
            expect(column).toBe('project_id'); expect(operator).toBe('gt')
            params.push(bind(column,JSON.parse(rest.join('.')))); where.push(`${column} > $${params.length}`); continue
          }
          expect(columns.has(key)).toBe(true)
          const separator = value.indexOf('.'), operator = value.slice(0,separator), argument = value.slice(separator+1)
          expect(['eq','ilike','imatch']).toContain(operator)
          params.push(bind(key,operator==='ilike'?argument.replace(/\*/g,'%'):argument))
          where.push(`${key} ${{eq:'=',ilike:'ILIKE',imatch:'~*'}[operator]} $${params.length}`)
        }
        if (method==='PATCH') {
          const row = JSON.parse(String(init.body)), keys = Object.keys(row)
          expect(keys.every(key=>columns.has(key))).toBe(true)
          const assignments = keys.map(key=>{params.push(bind(key,row[key]));return `${key}=$${params.length}`})
          rows = (await pg.query(`UPDATE ${table} SET ${assignments.join(',')} WHERE ${where.join(' AND ')} RETURNING *`,params)).rows
        } else {
          const limit = Number(url.searchParams.get('limit') ?? 1000); expect(Number.isInteger(limit)).toBe(true)
          rows = (await pg.query(`SELECT * FROM ${table}${where.length?' WHERE '+where.join(' AND '):''} LIMIT ${limit}`,params)).rows
          if (url.searchParams.has('name')) options.queries?.push(...rows.map(row=>({user_id:String(row.user_id),name:String(row.name),color:String(row.color)})))
        }
      }
      let data = rows.map(unbind)
      if (options.mismatch && method==='GET' && url.searchParams.has('name')) data = data.map(row=>({...row,name:'MISMATCHED LABEL'}))
      const payload = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object') ? data[0] ?? null : data
      return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}})
    } catch (error) {
      const failure = error as {code:string;message:string}; options.denied?.push(failure.code)
      return new Response(JSON.stringify({code:failure.code,message:failure.message}),{status:403,headers:{'Content-Type':'application/json'}})
    } finally { await pg.exec('RESET ROLE') }
  }
}
type LabelResult = {id: string; name: string; color: string}
let siblings: {
  SupabaseLabelRepository: new (client: SupabaseClient, userId: string) => {findByName(userId: string,name: string): Promise<LabelResult | undefined>}
  createRepos(client: SupabaseClient,userId: string): unknown
  createHandlers(repos: unknown,userId: string): unknown
  dispatchTool(tool: string,args: Row,context: {handlers: unknown}): Promise<{isError?: boolean;content: Array<{text: string}>}>
}
beforeAll(async () => {
  const root = fileURLToPath(new URL('../',import.meta.url))
  const readSource = (path: string): string => process.env.REVIEW_BASE_REF ? execFileSync('git',['show',`${process.env.REVIEW_BASE_REF}:${path}`],{cwd:root,encoding:'utf8'}) : readFileSync(new URL('../'+path,import.meta.url),'utf8')
  const result = await build({stdin:{contents:`import {createRepos,createHandlers,dispatchTool} from './supabase/functions/mcp/index.ts';import {SupabaseLabelRepository} from './src/main/supabase-repos/LabelRepository.ts';globalThis.siblings={createRepos,createHandlers,dispatchTool,SupabaseLabelRepository};`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',logLevel:'silent',plugins:[{name:'literal-sibling-runtime',setup(b) {
    b.onResolve({filter:/^(mcp-lite|npm:)/},a=>({path:a.path,namespace:'runtime'}))
    b.onLoad({filter:/.*/,namespace:'runtime'},a=>({loader:'js',contents:a.path==='mcp-lite' ? 'export class McpServer{tool(){}};export class StreamableHttpTransport{bind(){return ()=>{throw Error("HTTP shell is outside this test")}}}' : a.path.startsWith('npm:rrule') ? 'export default globalThis.rrule' : 'export const createClient=globalThis.createClient'}))
    b.onLoad({filter:/\.ts$/},a=>{if (!a.path.startsWith(root) || a.path.includes('/node_modules/')) return; const path=a.path.slice(root.length); return {loader:'ts',contents:readSource(path)+(path==='supabase/functions/mcp/index.ts'?'\nexport {createRepos,dispatchTool}':'')}})
  }}]})
  const runtime = {siblings:undefined,require,crypto:globalThis.crypto,console,URL,Request,Response,Headers,Date,TextEncoder,TextDecoder,rrule:require('rrule'),createClient:require('@supabase/supabase-js').createClient,Deno:{env:{get:()=>undefined},serve:()=>{}}}
  runInNewContext(result.outputFiles[0].text,runtime)
  siblings = runtime.siblings!
})
const schedules = cases.flatMap(names => ['push','reconcile'].flatMap(path => ['active','revive','absent'].map(state => ({...names,path,state}))))
it.each(schedules)('consolidates $name literally through $path ($state)', async ({name,unrelated,canonical,path,state}) => {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 1, connected: false })
  const pg = await makeLabelAuthorizationDatabase(); opened.push({h,pg})
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261031102321_label_junction_authorization.sql', import.meta.url), 'utf8'))
  const timestamp = '2026-10-30T00:00:00.000Z'
  const seed = async (id: string, owner: number, value: string, color: string, deleted: string | null = null): Promise<void> => {
    await pg.query('INSERT INTO user_labels(id,user_id,name,color,order_index,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,0,$5,$5,$6)', [id,labelId(owner),value,color,timestamp,deleted])
  }
  await seed(sourceId,2,'ALT OWNED ID','#444444')
  await seed(foreignId,2,canonical,'#333333')
  await seed(unrelatedId,1,unrelated,'#AA1100')
  if (state !== 'absent') await seed(canonicalId,1,canonical,'#00AA11',state==='revive'?timestamp:null)
  const source = h.repo.labels.create({id:sourceId,user_id:'u',project_id:'p0',name,color:'#444444'})
  h.repo.tasks.create({id:'literal-task',project_id:'p0',owner_id:'u',status_id:'s0',title:'PENDING TASK'})
  h.repo.tasks.addLabel('literal-task',sourceId)
  h.repo.syncQueue.enqueue('user_labels',sourceId,'UPDATE',JSON.stringify(source))
  const intent = h.repo.tasks.getLabelState('literal-task')[0]
  const denied: string[] = []
  const queries: Array<{ user_id: string; name: string; color: string }> = []
  h.sandbox.fetch = labelTransport(pg,'authenticated',{denied,queries})
  let effective: string | undefined
  if (path === 'push') effective = await h.services.personal.pushLabel(source,'u',h.producer())
  else {
    const pending = h.services.syncTables.SYNC_TABLES.labels.remoteUpsert(source,await h.context())
    if (state==='absent') await expect(pending).rejects.toMatchObject({code:'42501'})
    else await pending
  }
  await h.untilIdle()
  expect(denied).toEqual(['42501'])
  expect((await pg.query('SELECT user_id,name,color FROM user_labels WHERE id=$1',[sourceId])).rows).toEqual([{user_id:labelId(2),name:'ALT OWNED ID',color:'#444444'}])
  expect((await pg.query('SELECT name,color,deleted_at FROM user_labels WHERE id=$1',[unrelatedId])).rows).toEqual([{name:unrelated,color:'#AA1100',deleted_at:null}])
  if (state==='absent') {
    if (path==='push') { expect(effective).toBeUndefined(); expect(h.stores.useSyncStore.getState().status).toBe('error') }
    expect(h.repo.labels.findById(sourceId)).toEqual(source)
    expect(h.repo.tasks.getLabels('literal-task').map((row:{label_id:string})=>row.label_id)).toEqual([sourceId])
    expect(h.repo.labels.findByProjectId('p0').map((row:{id:string})=>row.id)).toEqual([sourceId])
    expect(h.repo.syncQueue.findAll().some((row:{table_name:string;row_id:string})=>row.table_name==='user_labels'&&row.row_id===sourceId)).toBe(true)
    expect(queries).toEqual([])
  } else {
    if (path==='push') expect(effective).toBe(canonicalId)
    expect(queries).toEqual([{user_id:labelId(1),name:canonical,color:'#00AA11'}])
    expect(h.repo.labels.findById(sourceId)).toBeUndefined()
    expect(h.repo.labels.findByTaskId('literal-task').map((row:{id:string;name:string;color:string})=>({id:row.id,name:row.name,color:row.color}))).toEqual([{id:canonicalId,name:canonical,color:'#00AA11'}])
    expect(h.repo.labels.findByProjectId('p0').map((row:{id:string})=>row.id)).toEqual([canonicalId])
    const remapped = h.repo.tasks.getLabelState('literal-task')[0]
    expect(remapped.label_id).toBe(canonicalId); expect(remapped.sync_pending).toBe(1); expect(remapped.local_version).toBeGreaterThanOrEqual(intent.local_version)
    const queue = h.repo.syncQueue.findAll()
    expect(queue.some((row:{table_name:string;row_id:string})=>row.table_name==='user_labels'&&row.row_id===sourceId)).toBe(false)
    expect(queue.filter((row:{table_name:string})=>row.table_name==='project_labels').every((row:{payload:string})=>JSON.parse(row.payload).labelId===canonicalId)).toBe(true)
    expect((await pg.query('SELECT deleted_at FROM user_labels WHERE id=$1',[canonicalId])).rows).toEqual([{deleted_at:null}])
  }
  expect(h.fixtureErrors).toEqual([])
},15000)

const siblingSchedules = cases.flatMap(names=>['main','mcp'].flatMap(surface=>['present','absent'].map(state=>({...names,surface,state}))))
it.each(siblingSchedules)('resolves $name literally through $surface ($state)', async ({name,unrelated,canonical,surface,state}) => {
  const h = await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:1,connected:false})
  const pg = await makeLabelAuthorizationDatabase(); opened.push({h,pg})
  await pg.exec('GRANT SELECT ON project_members TO service_role')
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261031102321_label_junction_authorization.sql',import.meta.url),'utf8'))
  await pg.query('INSERT INTO user_labels(id,user_id,name,color) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[foreignId,labelId(2),canonical,'#333333',unrelatedId,labelId(1),unrelated,'#AA1100'])
  if (state==='present') await pg.query('INSERT INTO user_labels(id,user_id,name,color) VALUES($1,$2,$3,$4)',[canonicalId,labelId(1),canonical,'#00AA11'])
  const roles: Array<{current_user: string;rolbypassrls: boolean}> = [], denied: string[] = []
  const role = surface==='mcp'?'service_role':'authenticated'
  h.sandbox.fetch = labelTransport(pg,role,{roles,denied})
  const client = (await h.context()).client
  let result: LabelResult | undefined
  if (surface==='main') result = await new siblings.SupabaseLabelRepository(client,'u').findByName('u',name)
  else {
    const envelope = await siblings.dispatchTool('create_label',{project_id:'p0',name,color:'#553399'},{handlers:siblings.createHandlers(siblings.createRepos(client,'u'),'u')})
    expect(envelope.isError).not.toBe(true)
    result = JSON.parse(envelope.content[0].text)
  }
  if (state==='present') expect(result).toMatchObject({id:canonicalId,name:canonical,color:'#00AA11'})
  else if (surface==='main') expect(result).toBeUndefined()
  else { expect(result).toMatchObject({name,color:'#553399'}); expect([canonicalId,unrelatedId,foreignId]).not.toContain(result!.id) }
  const links = (await pg.query('SELECT label_id FROM project_labels WHERE project_id=$1',[labelId(10)])).rows.map(row=>row.label_id).sort()
  expect(links).toEqual(surface==='mcp'?[result!.id,labelId(91)].sort():[labelId(91)])
  expect((await pg.query('SELECT name,color FROM user_labels WHERE id=$1',[unrelatedId])).rows).toEqual([{name:unrelated,color:'#AA1100'}])
  expect(roles.length).toBeGreaterThan(0); expect(roles.every(row=>row.current_user===role&&row.rolbypassrls===(role==='service_role'))).toBe(true)
  expect(denied).toEqual([]); expect(h.fixtureErrors).toEqual([])
},15000)

it.each(['push','reconcile'])('rejects a mismatched returned name before $0 revival and remapping', async path => {
  const h = await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:1,connected:false})
  const pg = await makeLabelAuthorizationDatabase(); opened.push({h,pg})
  const name = 'Cost*2026', tombstone = '2026-10-30T00:00:00.000Z'
  await pg.query('INSERT INTO user_labels(id,user_id,name,color,deleted_at) VALUES($1,$2,$3,$4,null),($5,$6,$7,$8,$9)',[sourceId,labelId(2),'FOREIGN','#444444',canonicalId,labelId(1),name,'#00AA11',tombstone])
  const source = h.repo.labels.create({id:sourceId,user_id:'u',project_id:'p0',name,color:'#444444'})
  h.repo.tasks.create({id:'literal-task',project_id:'p0',owner_id:'u',status_id:'s0',title:'PENDING TASK'})
  h.repo.tasks.addLabel('literal-task',sourceId)
  h.sandbox.fetch = labelTransport(pg,'authenticated',{mismatch:true})
  if (path==='push') expect(await h.services.personal.pushLabel(source,'u',h.producer())).toBeUndefined()
  else await expect(h.services.syncTables.SYNC_TABLES.labels.remoteUpsert(source,await h.context())).rejects.toMatchObject({code:'42501'})
  expect(h.repo.labels.findById(sourceId)).toEqual(source)
  expect(h.repo.labels.findByTaskId('literal-task').map((row:LabelResult)=>row.id)).toEqual([sourceId])
  expect(h.repo.labels.findByProjectId('p0').map((row:LabelResult)=>row.id)).toEqual([sourceId])
  expect((await pg.query('SELECT deleted_at FROM user_labels WHERE id=$1',[canonicalId])).rows[0].deleted_at).not.toBeNull()
  expect(h.fixtureErrors).toEqual([])
},15000)

it.each(['main','mcp'])('rejects a mismatched returned name through $0 lookup', async surface => {
  const h = await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:1,connected:false})
  const pg = await makeLabelAuthorizationDatabase(); opened.push({h,pg})
  await pg.exec('GRANT SELECT ON project_members TO service_role')
  const name = 'Cost*2026'
  await pg.query('INSERT INTO user_labels(id,user_id,name,color) VALUES($1,$2,$3,$4)',[canonicalId,labelId(1),name,'#00AA11'])
  h.sandbox.fetch = labelTransport(pg,surface==='mcp'?'service_role':'authenticated',{mismatch:true})
  const client = (await h.context()).client
  if (surface==='main') expect(await new siblings.SupabaseLabelRepository(client,'u').findByName('u',name)).toBeUndefined()
  else {
    const envelope = await siblings.dispatchTool('create_label',{project_id:'p0',name,color:'#553399'},{handlers:siblings.createHandlers(siblings.createRepos(client,'u'),'u')})
    expect(envelope.isError).not.toBe(true)
    const result = JSON.parse(envelope.content[0].text)
    expect(result).toMatchObject({name,color:'#553399'}); expect(result.id).not.toBe(canonicalId)
  }
  expect((await pg.query('SELECT * FROM project_labels WHERE label_id=$1',[canonicalId])).rows).toEqual([])
  expect(h.fixtureErrors).toEqual([])
},15000)

it('retains MCP project authorization and read failures during literal lookup', async () => {
  const h = await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:1,connected:false})
  const pg = await makeLabelAuthorizationDatabase(); opened.push({h,pg})
  await pg.exec('GRANT SELECT ON project_members TO service_role')
  const transportOptions: TransportOptions = {}
  h.sandbox.fetch = labelTransport(pg,'service_role',transportOptions)
  const client = (await h.context()).client
  const dispatch = (args: Row): ReturnType<typeof siblings.dispatchTool> => siblings.dispatchTool('create_label',args,{handlers:siblings.createHandlers(siblings.createRepos(client,'u'),'u')})
  const denied = await dispatch({project_id:labelId(11),name:'NEW * LABEL'})
  expect(denied.isError).toBe(true)
  expect((await pg.query('SELECT * FROM user_labels WHERE name=$1',['NEW * LABEL'])).rows).toEqual([])
  transportOptions.rejectReads = true
  const failed = await dispatch({project_id:'p0',name:'NEW * LABEL'})
  expect(failed.isError).toBe(true); expect(failed.content[0].text).toContain('Synthetic read failure')
  expect((await pg.query('SELECT * FROM user_labels WHERE name=$1',['NEW * LABEL'])).rows).toEqual([])
  expect(h.fixtureErrors).toEqual([])
},15000)
