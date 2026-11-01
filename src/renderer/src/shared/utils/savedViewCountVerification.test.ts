import { DatabaseSync } from 'node:sqlite'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { migrations } from '../../../../main/database/migrations'
import { createRepositories } from '../../../../main/repositories'

let db:DatabaseSync
let repo:ReturnType<typeof createRepositories>
let previousZone:string|undefined
beforeEach(()=>{
  previousZone=process.env.TZ;process.env.TZ='Europe/Brussels'
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'))
  db=new DatabaseSync(':memory:');db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for(const migrate of migrations)migrate(db)
  repo=createRepositories(db)
  for(const id of ['u','a','b'])repo.users.create({id,email:`${id}@example.invalid`,display_name:null,avatar_url:null})
  repo.projects.create({id:'p',owner_id:'u',name:'Project'})
  repo.statuses.create({id:'open',project_id:'p',name:'Open',is_default:1})
  repo.statuses.create({id:'done',project_id:'p',name:'Done',is_done:1})
  const rows=[{id:'today-a',assigned_to:'a',due_date:'2026-01-16'},
    {id:'today-b',assigned_to:'b',due_date:'2026-01-15T23:00:00.000Z'},
    {id:'tomorrow-a',assigned_to:'a',due_date:'2026-01-17'},
    {id:'yesterday-a',assigned_to:'a',due_date:'2026-01-15'},
    {id:'none-unassigned',assigned_to:null,due_date:null},
    {id:'deleted-a',assigned_to:'a',due_date:'2026-01-16'},
    {id:'template-a',assigned_to:'a',due_date:'2026-01-16',is_template:1},
    {id:'archived-a',assigned_to:'a',due_date:'2026-01-16',is_archived:1},
    {id:'done-a',assigned_to:'a',due_date:'2026-01-16',status_id:'done'},
    {id:'child-a',assigned_to:'a',due_date:'2026-01-16',parent_id:'today-a'}]
  for(const row of rows)repo.tasks.create({owner_id:'u',project_id:'p',status_id:'open',title:row.id,...row})
  repo.tasks.delete('deleted-a')
})
afterEach(()=>{db.close();vi.useRealTimers();if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone})

it.each([
  {config:{dueDatePreset:'today',assigneeIds:['a']},ids:['today-a']},
  {config:{dueDatePreset:'today',excludeAssigneeIds:['a']},ids:['today-b']},
  {config:{dueDatePreset:'no_date',assigneeIds:['']},ids:['none-unassigned']},
  {config:{dueDatePreset:'overdue',assigneeIds:['a']},ids:['yesterday-a']},
  {config:{dueDateRange:{mode:'relative',fromOffset:0,toOffset:1},assigneeIds:['a']},ids:['today-a','tomorrow-a']},
  {config:{dueDateRange:{mode:'absolute',fromDate:'2026-01-15',toDate:'2026-01-16'},excludeAssigneeIds:['b']},ids:['yesterday-a','today-a']}
])('counts only the actual eligible root task records for $config',({config,ids})=>{
  for(const id of ids)expect(repo.tasks.findById(id)).toBeDefined()
  expect(repo.savedViews.countMatchingTasks(JSON.stringify(config),'u')).toBe(ids.length)
})
