import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { RequestMetrics } from '../shared/supabaseTelemetry'

const harness=vi.hoisted(()=>({handlers:new Map<string,(event:unknown,...args:unknown[])=>unknown>(),directory:''}))
vi.mock('electron',()=>({ipcMain:{handle:(channel:string,handler:(event:unknown,...args:unknown[])=>unknown)=>harness.handlers.set(channel,handler)},safeStorage:{},BrowserWindow:{},dialog:{},shell:{},app:{getPath:()=>harness.directory,getVersion:()=> 'synthetic-version'}}))
vi.mock('keytar',()=>({default:{}}))
vi.mock('@electron-toolkit/utils',()=>({is:{dev:false}}))
vi.mock('./database',()=>({getDatabase:vi.fn(),switchDatabase:vi.fn(),clearDatabaseUserId:vi.fn(),getDatabasePath:vi.fn()}))
vi.mock('./quick-add',()=>({hideQuickAddWindow:vi.fn()}))
vi.mock('./index',()=>({registerQuickAddShortcut:vi.fn(),registerAppToggleShortcut:vi.fn(),getMainWindow:vi.fn()}))
vi.mock('./tray',()=>({setTrayUserId:vi.fn(),refreshTray:vi.fn(),setTimerState:vi.fn(),clearTimerState:vi.fn()}))
import { registerIpcHandlers } from './ipc-handlers'
import { trustedRendererUrl } from './navigation-security'

it('the actual IPC boundary persists only sanitized aggregates and reads private host history without secrets or expired rows',async()=>{
  harness.directory=mkdtempSync(join(tmpdir(),'todoozy-diagnostics-ipc-'))
  try {
    mkdirSync(join(harness.directory,'host-metrics'),{mode:0o700})
    const db=new DatabaseSync(join(harness.directory,'host-metrics','metrics.sqlite'))
    db.exec('CREATE TABLE samples(id INTEGER PRIMARY KEY,observed_at TEXT,summary TEXT)')
    const stamp=new Date().toISOString(),expired=new Date(Date.now()-9*86400_000).toISOString()
    const raw={observed_at:stamp,scrape_ok:true,credential:'sb_secret_SYNTHETIC',metrics:{disks:{disk0:{read_iops:0,write_iops:3,authorization:'hidden'}},burst_budget_balance_percent:null}}
    db.prepare('INSERT INTO samples(observed_at,summary) VALUES(?,?),(?,?),(?,?)').run(stamp,JSON.stringify(raw),expired,JSON.stringify({...raw,observed_at:expired}),stamp,'not-json')
    db.close()
    registerIpcHandlers()
    const trusted={senderFrame:{parent:null,url:trustedRendererUrl()}}
    const foreign={senderFrame:{parent:null,url:'https://untrusted.invalid/'}}
    expect(()=>harness.handlers.get('diagnostics:hostRecent')!(foreign)).toThrow(/Untrusted IPC/)
    expect(()=>harness.handlers.get('diagnostics:recent')!({senderFrame:{parent:{},url:trustedRendererUrl()}})).toThrow(/Untrusted IPC/)
    const history=harness.handlers.get('diagnostics:hostRecent')!(trusted) as unknown[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({scrapeOk:true,disks:[{device:'disk0',readIops:0,writeIops:3}],budgetBalancePercent:null})
    expect(JSON.stringify(history)).not.toMatch(/sb_secret_SYNTHETIC|authorization|hidden/)
    await harness.handlers.get('diagnostics:append')!(trusted,{...new RequestMetrics().snapshot(),secret:'never-store'})
    const traffic=harness.handlers.get('diagnostics:recent')!(trusted) as unknown[]
    expect(traffic).toHaveLength(1)
    expect(JSON.stringify(traffic)).not.toContain('never-store')
    expect(statSync(join(harness.directory,'diagnostics.db')).mode&0o777).toBe(0o600)
  }finally{rmSync(harness.directory,{recursive:true,force:true})}
})
