import { DatabaseSync } from 'node:sqlite'
import { beforeEach, afterEach, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TodoozyAPI } from '../../../preload/index.d'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { writeProjectLabelChoices } from './projectLabelIntent'

let db: DatabaseSync, repo: ReturnType<typeof createRepositories>, api: TodoozyAPI
let writes: Array<Array<{project_id:string;label_id:string;created_at:string;deleted_at:string|null}>>
let beforeWrite: (()=>Promise<void>) | undefined
let fail: boolean, current: boolean
let client: SupabaseClient
beforeEach(()=>{
  db=new DatabaseSync(':memory:');db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for(const migration of migrations) migration(db)
  repo=createRepositories(db)
  repo.users.create({id:'u',email:'u@example.invalid',display_name:null,avatar_url:null})
  repo.projects.create({id:'p',owner_id:'u',name:'Project'})
  api=new Proxy({}, {get:(_,namespace:keyof typeof repo)=>new Proxy({}, {get:(_,method:string)=>(...args:unknown[])=>{
    if(namespace as string==='sync') return (repo.syncQueue as unknown as Record<string,(...args:unknown[])=>unknown>)[method](...args)
    return (repo[namespace] as unknown as Record<string,(...args:unknown[])=>unknown>)[method](...args)
  }})}) as TodoozyAPI
  writes=[];fail=false;current=true;beforeWrite=undefined
  client={from:()=>({upsert:async(rows:typeof writes[number])=>{
    if(beforeWrite) {const hook=beforeWrite;beforeWrite=undefined;await hook()}
    if(fail) return {error:{message:'Synthetic failure'}}
    writes.push(rows)
    return {error:null}
  }})} as unknown as SupabaseClient
})
afterEach(()=>db.close())
const assertCurrent=():void=>{if(!current) throw new Error('Account changed')}
function seed(id:string): typeof writes[number][number] {
  repo.labels.create({id,user_id:'u',name:id})
  const link={project_id:'p',label_id:id,created_at:'2020-01-01T00:00:00.000Z',deleted_at:null}
  repo.labels.applyRemoteProjectLabel(link)
  return link
}
it('batches 500 project choices within 200 rows while unrelated jobs progress',async()=>{
  const links=Array.from({length:500},(_,index)=>seed('l'+index))
  let release!:()=>void,entered!:()=>void
  const gate=new Promise<void>((resolve)=>{release=resolve}),held=new Promise<void>((resolve)=>{entered=resolve})
  beforeWrite=async()=>{entered();await gate}
  const blocked=writeProjectLabelChoices(client,api,links,assertCurrent)
  await held
  await writeProjectLabelChoices(client,api,[seed('unrelated')],assertCurrent)
  expect(writes.some((batch)=>batch[0].label_id==='unrelated')).toBe(true)
  release();await blocked
  expect(writes.filter((batch)=>batch[0].label_id!=='unrelated').map((batch)=>batch.length).sort((a,b)=>b-a)).toEqual([200,200,100])
})
it('retains the current choice durably when repairing a superseded write fails',async()=>{
  const original=seed('l')
  beforeWrite=async()=>{repo.labels.removeFromProject('p','l')}
  let count=0
  client={from:()=>({upsert:async(rows:typeof writes[number])=>{
    if(++count===1) {await beforeWrite!();writes.push(rows);return {error:null}}
    return {error:{message:'Repair failed'}}
  }})} as unknown as SupabaseClient
  await expect(writeProjectLabelChoices(client,api,[original],assertCurrent)).rejects.toThrow('Repair failed')
  const commands=repo.syncQueue.findAll().filter((row)=>row.table_name==='project_labels').map((row)=>JSON.parse(row.payload))
  expect(commands).toHaveLength(1)
  expect(commands[0].deletedAt).toBe(repo.labels.getProjectLabelsForOwner('u')[0].deleted_at)
})
it('does not read or repair another account after a held write returns',async()=>{
  const original=seed('l')
  let release!:()=>void,entered!:()=>void
  const gate=new Promise<void>((resolve)=>{release=resolve}),held=new Promise<void>((resolve)=>{entered=resolve})
  beforeWrite=async()=>{entered();await gate}
  const work=writeProjectLabelChoices(client,api,[original],assertCurrent)
  const rejected=expect(work).rejects.toThrow('Account changed')
  await held;current=false;release();await rejected
  expect(writes).toHaveLength(1);expect(repo.syncQueue.count()).toBe(0)
})
