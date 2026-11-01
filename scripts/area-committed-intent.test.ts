import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, expect, it } from 'vitest'
const require=createRequire(import.meta.url)
const {makeHarness}=require('./benchmark-sync.cjs')
const opened:Array<{h:Awaited<ReturnType<typeof makeHarness>>;pg:PGlite}>=[]
afterEach(async()=>{for(const {h,pg} of opened.splice(0)){await h.stop();await pg.close()}})
const areaId='00000000-0000-4000-8000-000000000010',actor='00000000-0000-4000-8000-000000000001'
const schedules=['both-fail','first-success','second-success','both-success'].flatMap(mode=>[false,true].map(reverse=>({mode,reverse}))).concat([{mode:'normal',reverse:false}])
it.each(schedules)('delivers only committed area intent under owner RLS ($mode, reverse=$reverse)',async({mode,reverse})=>{
  const h=await makeHarness({ref:process.env.REVIEW_BASE_REF,projectCount:0,connected:false}),pg=new PGlite();opened.push({h,pg})
  await pg.exec(`CREATE ROLE authenticated;CREATE SCHEMA auth;GRANT USAGE ON SCHEMA public,auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${actor}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.sub',true)::uuid$$;`)
  const migration=readFileSync(new URL('../supabase/migrations/001_rename_shared_tables.sql',import.meta.url),'utf8')
  await pg.exec(migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS user_project_areas'),migration.indexOf('-- User themes')))
  await pg.exec('ALTER TABLE user_project_areas ADD COLUMN created_at timestamptz,ADD COLUMN deleted_at timestamptz;GRANT SELECT,INSERT,UPDATE,DELETE ON user_project_areas TO authenticated')
  await pg.query('INSERT INTO user_project_areas(id,user_id,name,color,icon,sidebar_order,is_collapsed,created_at,updated_at) VALUES($1,$2,$3,$4,$5,7,1,$6,$7)',[areaId,actor,'OTHER DEVICE','#ABCDEF','star','2020-01-01','2025-01-01'])
  const sentinel=(await pg.query('SELECT * FROM user_project_areas WHERE id=$1',[areaId])).rows[0]
  h.repo.projectAreas.create({id:areaId,user_id:'u',name:'LOCAL AREA',color:'#123456'})
  h.services.db.prepare('UPDATE project_areas SET updated_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',areaId)
  await h.stores.useProjectAreaStore.getState().hydrate('u')
  const initial=h.repo.projectAreas.findById(areaId)
  h.services.db.exec("CREATE TEMP TABLE area_failure(enabled INTEGER);INSERT INTO area_failure VALUES(0);CREATE TEMP TRIGGER reject_area_write BEFORE UPDATE ON project_areas WHEN (SELECT enabled FROM area_failure)=1 BEGIN SELECT RAISE(ABORT,'Synthetic area failure');END")
  const update=h.repo.projectAreas.update.bind(h.repo.projectAreas),releases:Array<()=>void>=[]
  h.repo.projectAreas.update=async(...args:unknown[])=>{
    const first=releases.length===0
    const fails=mode==='both-fail'||(mode==='first-success'&&!first)||(mode==='second-success'&&first)
    h.services.db.prepare('UPDATE area_failure SET enabled=?').run(fails?1:0)
    let row:unknown,error:unknown
    try{row=update(...args)}catch(value){error=value}
    await new Promise<void>(resolve=>{releases.push(resolve)})
    if(error)throw error
    return row
  }
  const writes:Record<string,unknown>[]=[],transport=h.sandbox.fetch
  h.sandbox.fetch=async(url:string,init:RequestInit)=>{
    if(!new URL(String(url)).pathname.endsWith('/user_project_areas'))return transport(url,init)
    expect(init.method).toBe('POST')
    const body=JSON.parse(String(init.body)),rows=Array.isArray(body)?body:[body]
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await pg.exec('SET ROLE authenticated')
    try{
      expect((await pg.query('SELECT current_user,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows).toEqual([{current_user:'authenticated',rolbypassrls:false}])
      for(const row of rows){
        writes.push({...row})
        const keys=Object.keys(row)
        expect(keys.every(key=>['id','user_id','name','icon','color','sidebar_order','is_collapsed','created_at','updated_at','deleted_at'].includes(key))).toBe(true)
        const values=keys.map(key=>key==='user_id'&&row[key]==='u'?actor:row[key])
        await pg.query(`INSERT INTO user_project_areas(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter(key=>key!=='id').map(key=>key+'=EXCLUDED.'+key).join(',')}`,values)
      }
      return new Response('[]',{headers:{'Content-Type':'application/json'}})
    }finally{await pg.exec('RESET ROLE')}
  }
  const store=h.stores.useProjectAreaStore
  store.getState().toggleCollapsed(areaId);await h.untilIdle()
  if(mode!=='normal'){store.getState().toggleCollapsed(areaId);await h.untilIdle()}
  const order=mode==='normal'?[0]:reverse?[1,0]:[0,1]
  for(const index of order){releases[index]();await h.untilIdle()}
  const native=h.repo.projectAreas.findById(areaId),remote=(await pg.query('SELECT * FROM user_project_areas WHERE id=$1',[areaId])).rows[0]
  expect(store.getState().areas[0].is_collapsed).toBe(native.is_collapsed)
  if(mode==='both-fail'){
    expect(native).toEqual(initial)
    expect(h.repo.syncQueue.findAll().filter((row:{table_name:string})=>row.table_name==='user_project_areas')).toEqual([])
    expect(writes).toEqual([])
    expect(remote).toEqual(sentinel)
  }else{
    expect(writes.length).toBeGreaterThan(0)
    expect(remote).toMatchObject({name:native.name,color:native.color,sidebar_order:native.sidebar_order,is_collapsed:native.is_collapsed,user_id:actor})
    expect(h.repo.syncQueue.findAll().filter((row:{table_name:string})=>row.table_name==='user_project_areas')).toEqual([])
  }
  expect(h.fixtureErrors).toEqual([])
},20000)
