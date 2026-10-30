import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync,readFileSync,rmSync,statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { migrations } from './database/migrations'
import { createRepositories } from './repositories'
import { trustedRendererUrl } from './navigation-security'
import { purgeOldTombstones } from './services/PurgeService'

const h=vi.hoisted(()=>({handlers:new Map<string,(...args:unknown[])=>unknown>(),database:null as unknown as DatabaseSync,temp:'',opened:[] as string[]}))
vi.mock('electron',()=>({ipcMain:{handle:(name:string,fn:(...args:unknown[])=>unknown)=>h.handlers.set(name,fn)},safeStorage:{},BrowserWindow:{},dialog:{},shell:{openPath:async(path:string)=>{h.opened.push(path);return ''}},app:{getPath:()=>h.temp}}))
vi.mock('keytar',()=>({default:{}}))
vi.mock('@electron-toolkit/utils',()=>({is:{dev:false}}))
vi.mock('./database',()=>({getDatabase:()=>h.database,switchDatabase:vi.fn(),getDatabasePath:vi.fn()}))
vi.mock('./quick-add',()=>({hideQuickAddWindow:vi.fn()}))
vi.mock('./index',()=>({registerQuickAddShortcut:vi.fn(),registerAppToggleShortcut:vi.fn(),getMainWindow:vi.fn()}))
vi.mock('./tray',()=>({setTrayUserId:vi.fn(),refreshTray:vi.fn(),setTimerState:vi.fn(),clearTimerState:vi.fn()}))
import { registerIpcHandlers } from './ipc-handlers'

beforeEach(()=>{
  h.temp=mkdtempSync(join(tmpdir(),'todoozy-attachment-verifier-'));h.opened=[];h.handlers.clear()
  h.database=new DatabaseSync(':memory:');h.database.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for(const migrate of migrations)migrate(h.database)
  const repo=createRepositories(h.database)
  repo.users.create({id:'u',email:'u@example.invalid',display_name:null,avatar_url:null})
  repo.projects.create({id:'p',owner_id:'u',name:'Project'})
  repo.statuses.create({id:'s',project_id:'p',name:'Open',is_default:1})
  repo.tasks.create({id:'t',owner_id:'u',project_id:'p',status_id:'s',title:'Synthetic'})
  for(const id of ['a','b']) repo.attachments.create({id,task_id:'t',filename:'report.txt',mime_type:'text/plain',size_bytes:1,file_data:Buffer.from(id)})
  registerIpcHandlers()
})
afterEach(()=>{h.database.close();rmSync(h.temp,{recursive:true,force:true})})
it('opens same-name attachments at distinct private paths with stable bytes',async()=>{
  const event={senderFrame:{url:trustedRendererUrl(),parent:null}}
  await h.handlers.get('auth:switchDatabase')!(event,'u')
  await h.handlers.get('attachments:open')!(event,'a')
  await h.handlers.get('attachments:open')!(event,'b')
  expect(h.opened).toHaveLength(2)
  expect(h.opened[0]).not.toBe(h.opened[1])
  expect(readFileSync(h.opened[0],'utf8')).toBe('a')
  expect(readFileSync(h.opened[1],'utf8')).toBe('b')
  expect(statSync(h.opened[0]).mode&0o777).toBe(0o600)
})
it('rejects attachment operations from an untrusted frame before opening files',async()=>{
  await expect(async()=>h.handlers.get('attachments:open')!({senderFrame:{url:'https://example.invalid',parent:null}},'a')).rejects.toThrow(/Untrusted/)
  expect(h.opened).toEqual([])
})

it('soft-deletes and restores exact attachment bytes through registered IPC',async()=>{
  const event={senderFrame:{url:trustedRendererUrl(),parent:null}}
  await h.handlers.get('auth:switchDatabase')!(event,'u')
  const bytes=Buffer.from([0,1,2,255,128,0,65,66,10])
  h.database.prepare('UPDATE attachments SET file_data=?,size_bytes=? WHERE id=?').run(bytes,bytes.length,'a')
  expect(await h.handlers.get('attachments:delete')!(event,'a')).toBe(true)
  expect(await h.handlers.get('attachments:delete')!(event,'a')).toBe(false)
  expect(createRepositories(h.database).attachments.getFileData('a')).toBeUndefined()
  expect(createRepositories(h.database).attachments.findByTaskId('t').map(row=>row.id)).toEqual(['b'])
  const stored=h.database.prepare('SELECT file_data FROM attachments WHERE id=?').get('a') as {file_data:Uint8Array}
  expect(Buffer.from(stored.file_data)).toEqual(bytes)
  const restored=await h.handlers.get('attachments:restore')!(event,'a')
  expect(restored).toMatchObject({id:'a',task_id:'t',filename:'report.txt',size_bytes:bytes.length})
  expect(createRepositories(h.database).attachments.getFileData('a')!.file_data).toEqual(bytes)
})

it('rejects a stale account-bound Undo without restoring another database',async()=>{
  const event={senderFrame:{url:trustedRendererUrl(),parent:null}}
  await h.handlers.get('auth:switchDatabase')!(event,'u')
  const origin=await h.handlers.get('sync:captureContext')!(event)
  await h.handlers.get('attachments:delete')!(event,'a')
  await h.handlers.get('auth:switchDatabase')!(event,'other-user')
  await expect(async()=>h.handlers.get('sync:invokeContext')!(event,origin,'attachments:restore',['a'])).rejects.toThrow(/changed/)
  expect(createRepositories(h.database).attachments.getFileData('a')).toBeUndefined()
})

it('allows actual stats queries through bound IPC and rejects the captured route after an account switch',async()=>{
  const event={senderFrame:{url:trustedRendererUrl(),parent:null}}
  h.database.prepare("INSERT INTO project_members(project_id,user_id,role) VALUES ('p','u','owner')").run()
  await h.handlers.get('auth:switchDatabase')!(event,'u')
  const origin=await h.handlers.get('sync:captureContext')!(event)
  const expected=createRepositories(h.database).tasks.getTaskSummaryStats('u',null)
  expect(expected.total).toBe(1)
  const actual=await h.handlers.get('sync:invokeContext')!(event,origin,'stats:summary',['u',null])
  expect(actual).toEqual(expected)
  const tasks=await h.handlers.get('sync:invokeContext')!(event,origin,'stats:taskList',['u','open',null])
  expect(tasks).toMatchObject([{id:'t',title:'Synthetic'}])
  await h.handlers.get('auth:switchDatabase')!(event,'other-user')
  await expect(async()=>h.handlers.get('sync:invokeContext')!(event,origin,'stats:summary',['u',null])).rejects.toThrow(/changed/)
})

it('purges only expired removed attachments, preserving active and recently removed bytes',()=>{
  const repo=createRepositories(h.database).attachments
  repo.delete('a')
  expect(purgeOldTombstones(h.database).byTable.attachments).toBe(0)
  expect(repo.restore('a')).toBeDefined()
  repo.delete('a')
  h.database.prepare('UPDATE attachments SET deleted_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z','a')
  expect(purgeOldTombstones(h.database).byTable.attachments).toBe(1)
  expect(repo.restore('a')).toBeUndefined()
  expect(repo.getFileData('b')!.file_data.toString()).toBe('b')
})
