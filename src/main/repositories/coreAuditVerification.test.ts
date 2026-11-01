import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrations } from '../database/migrations'
import { createRepositories } from './index'
import { purgeOldTombstones } from '../services/PurgeService'
import { localDateKey } from '../../shared/localDate'
import { SyncQueueRepository } from './SyncQueueRepository'

let db: DatabaseSync
let repos: ReturnType<typeof createRepositories>
beforeEach(() => {
  db=new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  repos=createRepositories(db)
  repos.users.create({id:'u',email:'u@example.invalid',display_name:null,avatar_url:null})
  for (const id of ['p','other']) {
    repos.projects.create({id,owner_id:'u',name:id})
    repos.statuses.create({id:`open-${id}`,project_id:id,name:'Open',is_default:1})
    repos.statuses.create({id:`done-${id}`,project_id:id,name:'Done',is_done:1})
  }
})
afterEach(() => db.close())
const task=(id:string,parent:string|null=null)=>repos.tasks.create({id,owner_id:'u',project_id:'p',status_id:'open-p',title:id,parent_id:parent,reference_url:`https://example.invalid/${id}`})

it('duplicates an entire three-level task tree, references, labels and completed state atomically', () => {
  task('root');task('child','root');task('grandchild','child')
  repos.tasks.update('grandchild',{status_id:'done-p',completed_date:'2026-10-25T12:00:00.000Z'})
  repos.labels.create({id:'l',user_id:'u',name:'Label'})
  repos.tasks.addLabel('grandchild','l')
  const copy=repos.tasks.duplicate('root','copy')!
  const child=repos.tasks.findSubtasks(copy.id)[0]
  const grandchild=repos.tasks.findSubtasks(child.id)[0]
  expect(copy.reference_url).toBe('https://example.invalid/root')
  expect(child.reference_url).toBe('https://example.invalid/child')
  expect(grandchild.reference_url).toBe('https://example.invalid/grandchild')
  expect(grandchild.status_id).toBe('done-p')
  expect(grandchild.completed_date).toBe('2026-10-25T12:00:00.000Z')
  expect(repos.tasks.getLabels(grandchild.id).map(l=>l.label_id)).toEqual(['l'])
  expect(repos.tasks.findSubtasks('child')[0].id).toBe('grandchild')
})

it('rolls back the entire duplicate if an invalid legacy descendant cannot be copied',()=>{
  task('root')
  repos.tasks.create({id:'legacy-child',owner_id:'u',project_id:'other',status_id:'open-other',title:'Legacy invalid child'})
  db.prepare('UPDATE tasks SET parent_id=? WHERE id=?').run('root','legacy-child')
  const before=(db.prepare('SELECT count(*) AS n FROM tasks').get() as {n:number}).n
  expect(()=>repos.tasks.duplicate('root','copy')).toThrow(/same project/)
  expect(repos.tasks.findById('copy')).toBeUndefined()
  expect((db.prepare('SELECT count(*) AS n FROM tasks').get() as {n:number}).n).toBe(before)
})

it('rejects self/cyclic/foreign-project parent assignments without altering the graph', () => {
  task('root');task('child','root')
  repos.tasks.create({id:'foreign',owner_id:'u',project_id:'other',status_id:'open-other',title:'Foreign'})
  expect(()=>repos.tasks.update('root',{parent_id:'root'})).toThrow(/ancestor/)
  expect(()=>repos.tasks.update('root',{parent_id:'child'})).toThrow(/ancestor/)
  expect(()=>repos.tasks.update('root',{parent_id:'foreign'})).toThrow(/same project/)
  expect(repos.tasks.findById('root')!.parent_id).toBeNull()
})

it('preserves root and descendant reference links when saving a task tree as a template',()=>{
  task('root');task('child','root');task('grandchild','child')
  const template=repos.tasks.saveAsTemplate('root','template')!
  const child=repos.tasks.findSubtasks(template.id)[0]
  const grandchild=repos.tasks.findSubtasks(child.id)[0]
  expect(template.reference_url).toBe('https://example.invalid/root')
  expect(child.reference_url).toBe('https://example.invalid/child')
  expect(grandchild.reference_url).toBe('https://example.invalid/grandchild')
  expect(template.due_date).toBeNull()
})

it('does not create a cross-project child link when moving a parent task', () => {
  task('root');task('child','root')
  expect(()=>repos.tasks.update('root',{project_id:'other',status_id:'open-other'})).toThrow()
  expect(repos.tasks.findById('root')!.project_id).toBe('p')
  expect(repos.tasks.findById('child')!.project_id).toBe('p')
})

it('retains a status tombstone required by an unacknowledged command, then permits cleanup after acknowledgment', () => {
  repos.statuses.create({id:'custom',project_id:'p',name:'Custom'})
  repos.statuses.reassignAndDelete('custom','open-p')
  const old='2000-01-01T00:00:00.000Z'
  db.prepare('UPDATE statuses SET deleted_at=? WHERE id=?').run(old,'custom')
  purgeOldTombstones(db)
  expect(repos.statuses.findById('custom')).toBeDefined()
  const queue=new SyncQueueRepository(db)
  const command=queue.findAll().find(row=>row.row_id==='custom')!
  expect(command).toBeDefined()
  queue.dequeue(command.id)
  purgeOldTombstones(db)
  expect(repos.statuses.findById('custom')).toBeUndefined()
})

it('does not retain unrelated project tombstones because another project has a pending status command',()=>{
  repos.statuses.create({id:'custom',project_id:'p',name:'Custom'})
  repos.statuses.reassignAndDelete('custom','open-p')
  repos.tasks.create({id:'old-other',owner_id:'u',project_id:'other',status_id:'open-other',title:'Old unrelated'})
  db.prepare("UPDATE tasks SET deleted_at='2000-01-01T00:00:00.000Z' WHERE id='old-other'").run()
  purgeOldTombstones(db)
  expect(repos.statuses.findById('custom')).toBeDefined()
  expect(repos.tasks.findById('old-other')).toBeUndefined()
})

it('uses the same local calendar day for automatic My Day as the date utilities', () => {
  const previous=process.env.TZ
  // Whichever UTC hour the test runs, choose a valid zone on the other calendar day.
  process.env.TZ=new Date().getUTCHours()>=10?'Pacific/Kiritimati':'Pacific/Pago_Pago'
  try {
    const today=localDateKey()
    repos.tasks.create({id:'today',owner_id:'u',project_id:'p',status_id:'open-p',title:'Today',due_date:today})
    expect(repos.tasks.autoAddMyDayTasks('u','due_today')).toEqual(['today'])
  } finally {
    if(previous===undefined) delete process.env.TZ
    else process.env.TZ=previous
  }
})

it('includes a local-today timestamp in automatic My Day when its UTC date differs',()=>{
  const previous=process.env.TZ
  process.env.TZ=new Date().getUTCHours()>=10?'Pacific/Kiritimati':'Pacific/Pago_Pago'
  try {
    repos.tasks.create({id:'instant',owner_id:'u',project_id:'p',status_id:'open-p',title:'Current local day',due_date:new Date().toISOString()})
    expect(repos.tasks.autoAddMyDayTasks('u','due_today')).toEqual(['instant'])
  } finally {
    if(previous===undefined)delete process.env.TZ
    else process.env.TZ=previous
  }
})

it('tombstones native and remotely deleted subtrees and validates ancestor-first restoration',()=>{
  task('root');task('child','root');task('grandchild','child');task('sibling')
  const originals=['root','child','grandchild'].map(id=>repos.tasks.findById(id)!)
  expect(repos.tasks.delete('root')).toBe(true)
  expect(repos.tasks.delete('root')).toBe(false)
  for(const row of originals)expect(repos.tasks.findById(row.id)?.deleted_at).toBeTruthy()
  expect(repos.tasks.update('sibling',{title:'Ordinary edit'})?.title).toBe('Ordinary edit')
  const restoredAt=new Date(Date.now()+60_000).toISOString()
  expect(()=>repos.tasks.applyRemoteTask({...originals[2],updated_at:restoredAt})).toThrow(/active task/)
  for(const row of originals)repos.tasks.applyRemoteTask({...row,updated_at:restoredAt})
  expect(repos.tasks.update('grandchild',{title:'Restored edit'})?.title).toBe('Restored edit')
  const deletedAt=new Date(Date.now()+120_000).toISOString()
  repos.tasks.applyRemoteTask({...originals[0],updated_at:deletedAt,deleted_at:deletedAt})
  for(const row of originals)expect(repos.tasks.findById(row.id)?.deleted_at).toBe(deletedAt)
  repos.tasks.applyRemoteTask({...originals[1],updated_at:restoredAt})
  expect(repos.tasks.findById('child')?.deleted_at).toBe(deletedAt)
})

it.each(['tasks','statuses','attachments','activity_log','projects'])('retains every dependency of a queued %s record until acknowledgment',table=>{
  task('root');task('child','root');task('grandchild','child')
  const attachment=repos.attachments.create({id:'file',task_id:'grandchild',filename:'synthetic.txt',mime_type:'text/plain',size_bytes:3,file_data:Buffer.from('abc')})
  repos.activityLog.create({id:'event',task_id:'grandchild',user_id:'u',action:'created'})
  const old='2000-01-01T00:00:00.000Z'
  for(const name of ['tasks','statuses','projects','attachments'])db.prepare(`UPDATE ${name} SET deleted_at=?`).run(old)
  const id=({tasks:'grandchild',statuses:'open-p',attachments:attachment.id,activity_log:'event',projects:'p'} as Record<string,string>)[table]
  const queue=new SyncQueueRepository(db)
  const entry=queue.enqueue(table,id,'DELETE',JSON.stringify({id}))
  expect(()=>purgeOldTombstones(db)).not.toThrow()
  expect(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)).toBeDefined()
  if(['tasks','attachments','activity_log'].includes(table)) {
    expect(repos.tasks.findById('root')).toBeDefined()
    expect(repos.tasks.findById('child')).toBeDefined()
    expect(repos.statuses.findById('open-p')).toBeDefined()
  }
  expect(repos.projects.findById('p')).toBeDefined()
  queue.dequeue(entry.id)
  purgeOldTombstones(db)
  expect(repos.projects.findById('p')).toBeUndefined()
  expect(repos.tasks.findById('grandchild')).toBeUndefined()
  expect(db.prepare('SELECT id FROM attachments WHERE id=?').get('file')).toBeUndefined()
})
