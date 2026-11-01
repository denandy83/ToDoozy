import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RequestMetrics, validateTrafficSummary } from './supabaseTelemetry'
import { sanitizeHostMetrics } from './hostMetrics'
import { DiagnosticsJournal } from '../main/services/DiagnosticsJournal'

afterEach(()=>vi.useRealTimers())

it('counts concurrent completions exactly once across snapshots without consuming response bodies',async()=>{
  const metrics=new RequestMetrics()
  const pending:Array<(value:Response)=>void>=[]
  const implementation:typeof fetch=async()=>new Promise<Response>(resolve=>pending.push(resolve))
  const fetch=metrics.wrap(implementation,'https://synthetic.invalid')
  const a=fetch('https://synthetic.invalid/rest/v1/tasks?token=secret-query',{headers:{Authorization:'Bearer secret-token'}})
  const b=fetch('https://synthetic.invalid/rest/v1/projects',{method:'PATCH',body:'secret-body'})
  expect(metrics.snapshot().requests).toBe(0)
  const failed=new Response('private error',{status:503})
  pending[1](failed)
  expect(await b).toBe(failed)
  const first=metrics.snapshot()
  expect(first.requests).toBe(1);expect(first.errors).toBe(1)
  expect(first.routes[0]).toMatchObject({route:'rest/projects',method:'PATCH',unknownResponseSizes:1})
  const success=new Response('private response',{status:200,headers:{'Content-Length':'16'}})
  pending[0](success)
  expect(await a).toBe(success)
  expect(await success.text()).toBe('private response')
  const second=metrics.snapshot()
  expect(second.requests).toBe(1);expect(second.errors).toBe(0)
  expect(second.routes[0]).toMatchObject({route:'rest/tasks',method:'GET',declaredResponseBytes:16})
  const text=JSON.stringify([first,second])
  for(const secret of ['secret-query','secret-token','secret-body','private response','private error'])expect(text).not.toContain(secret)
  expect(metrics.snapshot().requests).toBe(0)
})

it('preserves fetch cancellation and counts the rejected request without its private error message',async()=>{
  const metrics=new RequestMetrics(), controller=new AbortController()
  const reason=new DOMException('secret failure detail','AbortError')
  const implementation:typeof fetch=async(_input,options)=>new Promise<Response>((_resolve,reject)=>{
    options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true})
  })
  const promise=metrics.wrap(implementation,'https://synthetic.invalid')('https://synthetic.invalid/rest/v1/tasks',{signal:controller.signal})
  controller.abort(reason)
  await expect(promise).rejects.toBe(reason)
  const sample=metrics.snapshot()
  expect(sample.requests).toBe(1);expect(sample.errors).toBe(1)
  expect(JSON.stringify(sample)).not.toContain('secret failure detail')
})

it('retains Request method and passes unrelated-origin requests through without attributing them to Supabase',async()=>{
  const metrics=new RequestMetrics(), supplied=new Request('https://synthetic.invalid/rest/v1/tasks',{method:'POST',body:'private payload'})
  const inputs:unknown[]=[]
  const implementation:typeof fetch=async(input)=>{inputs.push(input);return new Response(null,{status:204,headers:{'content-length':'0'}})}
  const fetch=metrics.wrap(implementation,'https://synthetic.invalid')
  await fetch(supplied)
  await fetch('https://unrelated.invalid/private?credential=do-not-log')
  expect(inputs[0]).toBe(supplied)
  expect(await supplied.text()).toBe('private payload')
  const sample=metrics.snapshot()
  expect(sample.requests).toBe(1)
  expect(sample.routes[0]).toMatchObject({method:'POST',declaredResponseBytes:0,unknownResponseSizes:0})
  expect(JSON.stringify(sample)).not.toContain('unrelated')
})

it('persists sanitized aggregate history after closing and reopening the local journal',()=>{
  const directory=mkdtempSync(join(tmpdir(),'todoozy-diagnostics-verifier-')),path=join(directory,'history.sqlite')
  let db=new DatabaseSync(path)
  try {
    const metrics=new RequestMetrics(),journal=new DiagnosticsJournal(db)
    journal.append({...metrics.snapshot(),Authorization:'secret-token',body:'private title',appVersion:'untrusted-value'},'trusted-version')
    db.close();db=new DatabaseSync(path)
    const history=new DiagnosticsJournal(db).recent()
    expect(history).toHaveLength(1)
    expect(history[0].appVersion).toBe('trusted-version')
    expect(JSON.stringify(history)).not.toMatch(/secret-token|private title|untrusted-value/)
  }finally{db.close();rmSync(directory,{recursive:true,force:true})}
})

it('excludes expired history immediately on restart without requiring another append',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
  const db=new DatabaseSync(':memory:')
  try {
    new DiagnosticsJournal(db).append(new RequestMetrics().snapshot(),'old')
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
    expect(new DiagnosticsJournal(db).recent()).toEqual([])
  }finally{db.close()}
})

it('caps retained local aggregates after an append and rejects invalid metrics before persistence',()=>{
  const db=new DatabaseSync(':memory:')
  try {
    const journal=new DiagnosticsJournal(db),sample=new RequestMetrics().snapshot(),now=new Date().toISOString()
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10082)
      INSERT INTO traffic(recorded_at,summary) SELECT ?,? FROM n`).run(now,JSON.stringify(sample))
    journal.append(sample,'latest')
    expect((db.prepare('SELECT count(*) AS count FROM traffic').get() as {count:number}).count).toBe(10080)
    const before=journal.recent().length
    expect(()=>journal.append({...sample,requests:NaN},'bad')).toThrow(/Invalid metric/)
    expect(journal.recent()).toHaveLength(before)
  }finally{db.close()}
  expect(()=>validateTrafficSummary({...new RequestMetrics().snapshot(),routes:[{route:'rest/tasks?token=secret'}]})).toThrow()
})

it('marks old and implausibly future host samples stale while preserving measured zero and missing values',()=>{
  const now=Date.parse('2026-10-30T12:00:00Z')
  const sample={observed_at:'2026-10-30T12:00:00Z',scrape_ok:true,metrics:{disks:{disk0:{read_iops:0,write_iops:null,secret:'never-export'}},cpu_iowait_percent:0,burst_budget_balance_percent:null},secret:'never-export'}
  expect(sanitizeHostMetrics(sample,now)).toMatchObject({stale:false,cpuIowaitPercent:0,budgetBalancePercent:null,disks:[{readIops:0,writeIops:null}]})
  expect(sanitizeHostMetrics({...sample,observed_at:'2026-10-30T11:00:00Z'},now).stale).toBe(true)
  expect(sanitizeHostMetrics({...sample,observed_at:'2026-10-30T13:00:00Z'},now).stale).toBe(true)
  const failed=sanitizeHostMetrics({...sample,scrape_ok:false},now)
  expect(failed.disks).toEqual([]);expect(failed.cpuIowaitPercent).toBeNull()
  expect(JSON.stringify(sanitizeHostMetrics(sample,now))).not.toContain('never-export')
})
