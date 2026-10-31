import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
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
  { name: 'Literal Name', unrelated: 'Literal Name extra', canonical: 'LITERAL NAME' }
]
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
  const knownColumns = new Set(['id','user_id','name','color','order_index','created_at','updated_at','deleted_at'])
  h.sandbox.fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET'
    expect(url.hostname).toBe('127.0.0.1'); expect(url.pathname.endsWith('/user_labels')).toBe(true)
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[labelId(1)])
    await pg.exec('SET ROLE authenticated')
    try {
      let rows: Array<Record<string,unknown>> = []
      const bind = (key: string, value: unknown): unknown => key==='user_id' && value==='u' ? labelId(1) : value
      if (method === 'POST') {
        const body = JSON.parse(String(init.body)), values = Array.isArray(body) ? body : [body]
        for (const row of values) {
          const columns = Object.keys(row); expect(columns.every(key=>knownColumns.has(key))).toBe(true)
          await pg.query(`INSERT INTO user_labels(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(key=>key!=='id').map(key=>`${key}=excluded.${key}`).join(',')}`,columns.map(key=>bind(key,row[key])))
        }
      } else {
        const params: unknown[] = []
        const where: string[] = []
        for (const [key,value] of url.searchParams) {
          if (['select','order','limit','offset'].includes(key)) continue
          expect(knownColumns.has(key)).toBe(true)
          const separator = value.indexOf('.'), operator = value.slice(0,separator), argument = value.slice(separator+1)
          expect(['eq','ilike']).toContain(operator)
          params.push(bind(key,argument)); where.push(`${key} ${operator==='ilike'?'ILIKE':'='} $${params.length}`)
        }
        if (method === 'PATCH') {
          const row = JSON.parse(String(init.body)), columns = Object.keys(row)
          expect(columns.every(key=>knownColumns.has(key))).toBe(true)
          const assignments = columns.map(key=>{params.push(bind(key,row[key]));return `${key}=$${params.length}`})
          rows = (await pg.query(`UPDATE user_labels SET ${assignments.join(',')} WHERE ${where.join(' AND ')} RETURNING *`,params)).rows
        } else {
          const limit = Number(url.searchParams.get('limit') ?? 1000); expect(Number.isInteger(limit)).toBe(true)
          rows = (await pg.query(`SELECT * FROM user_labels${where.length?' WHERE '+where.join(' AND '):''} LIMIT ${limit}`,params)).rows
          if (url.searchParams.has('name')) queries.push(...rows.map(row=>({user_id:String(row.user_id),name:String(row.name),color:String(row.color)})))
        }
      }
      const data = rows.map(row=>({...row,user_id:row.user_id===labelId(1)?'u':'other'}))
      const payload = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object') ? data[0] ?? null : data
      return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}})
    } catch (error) {
      const failure = error as {code:string;message:string}; denied.push(failure.code)
      return new Response(JSON.stringify({code:failure.code,message:failure.message}),{status:403,headers:{'Content-Type':'application/json'}})
    } finally { await pg.exec('RESET ROLE') }
  }
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
