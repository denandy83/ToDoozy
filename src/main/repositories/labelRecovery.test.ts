import { DatabaseSync } from 'node:sqlite'
import { expect,it } from 'vitest'
import { migrations } from '../database/migrations'
import { createRepositories } from './index'
it('retains authored label fields, references and queued intent when snapshotting an unverified identity',()=>{
  const db=new DatabaseSync(':memory:')
  try{
    db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
    for(const migrate of migrations)migrate(db)
    const repo=createRepositories(db)
    repo.users.create({id:'u',email:'u@example.invalid'})
    repo.projects.create({id:'p',owner_id:'u',name:'P'})
    repo.projects.addMember('p','u','owner')
    repo.statuses.create({id:'s',project_id:'p',name:'OPEN'})
    repo.tasks.create({id:'t',project_id:'p',owner_id:'u',status_id:'s',title:'TASK'})
    const local=repo.labels.create({id:'ambiguous',user_id:'u',project_id:'p',name:'AUTHORED',color:'#123456'})
    repo.tasks.addLabel('t',local.id)
    repo.syncQueue.enqueue('user_labels',local.id,'UPDATE',JSON.stringify(local))
    repo.labels.applyRemote({...local,user_id:'other',name:'AUTHORED',updated_at:'2099-01-01'})
    expect(repo.labels.findById(local.id)?.user_id).toBe('u')
    const owned=repo.labels.snapshotOwned('u',local.id)
    expect(owned.id).not.toBe(local.id)
    expect(owned).toMatchObject({name:'AUTHORED',color:'#123456',user_id:'u'})
    expect(repo.labels.findByProjectId('p').map(l=>l.id)).toEqual([owned.id])
    expect(repo.tasks.getLabels('t').map(l=>l.label_id)).toEqual([owned.id])
    expect(repo.tasks.getLabelState('t').every(l=>l.sync_pending===1)).toBe(true)
    const queue=repo.syncQueue.findAll()
    expect(queue.some(e=>e.table_name==='user_labels'&&e.row_id===local.id)).toBe(false)
    expect(queue.some(e=>e.table_name==='user_labels'&&e.row_id===owned.id&&JSON.parse(e.payload).name==='AUTHORED')).toBe(true)
    expect(queue.filter(e=>e.table_name==='project_labels').every(e=>JSON.parse(e.payload).labelId===owned.id)).toBe(true)
  }finally{db.close()}
})
