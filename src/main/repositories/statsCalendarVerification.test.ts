import { DatabaseSync } from 'node:sqlite'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { migrations } from '../database/migrations'
import { createRepositories } from './index'
import { localDayBounds,localDateKey } from '../../shared/localDate'

let db:DatabaseSync
let repo:ReturnType<typeof createRepositories>
let originalZone:string|undefined
beforeEach(()=>{
  originalZone=process.env.TZ;process.env.TZ='Europe/Brussels'
  db=new DatabaseSync(':memory:');db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for(const migrate of migrations)migrate(db)
  repo=createRepositories(db)
  repo.users.create({id:'u',email:'u@example.invalid',display_name:null,avatar_url:null})
  repo.projects.create({id:'p',owner_id:'u',name:'Project'})
  db.prepare('INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?)').run('p','u','owner')
  repo.statuses.create({id:'done',project_id:'p',name:'Done',is_done:1})
})
afterEach(()=>{vi.useRealTimers();db.close();if(originalZone===undefined)delete process.env.TZ;else process.env.TZ=originalZone})

it.each([{month:2,day:29,hours:23,start:'2026-03-28T23:00:00.000Z',end:'2026-03-29T21:59:59.999Z'},
  {month:9,day:25,hours:25,start:'2026-10-24T22:00:00.000Z',end:'2026-10-25T22:59:59.999Z'}])(
  'groups completion/focus/activity data into the complete local $hours-hour DST day',({month,day,hours,start,end})=>{
    const date=new Date(2026,month,day,12)
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(date)
    const bounds=localDayBounds(date)
    expect(bounds).toEqual({start,end})
    expect(Date.parse(end)-Date.parse(start)+1).toBe(hours*3600_000)
    const stamps=[Date.parse(start)-1,Date.parse(start),Date.UTC(2026,month,day,0,30),Date.UTC(2026,month,day,1,30),Date.parse(end),Date.parse(end)+1]
    stamps.forEach((stamp,i)=>{
      const value=new Date(stamp).toISOString()
      repo.tasks.create({id:`t${i}`,owner_id:'u',project_id:'p',status_id:'done',title:`Task ${i}`,completed_date:value})
      repo.activityLog.applyRemote({id:`log${i}`,task_id:`t${i}`,user_id:'u',action:'Completed 25 min focus session',created_at:value})
    })
    const key=localDateKey(date)
    expect(repo.tasks.getCompletionStats('u',null,start,end)).toEqual([{date:key,count:4}])
    expect(repo.activityLog.getFocusStats('u',null,start,end)).toEqual([{date:key,minutes:100}])
    expect(repo.activityLog.getActivityHeatmap('u',start,end)).toEqual([{date:key,count:4,created:0,completed:0,updated:4}])
    expect(repo.tasks.getStatsTaskList('u','completed_today',null).map(row=>row.id).sort()).toEqual(['t1','t2','t3','t4'])
  }
)
