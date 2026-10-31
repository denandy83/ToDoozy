import { expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { RequestMetrics } from './supabaseTelemetry'
import { DiagnosticsJournal } from '../main/services/DiagnosticsJournal'

it('counts real fetch outcomes without retaining query values, credentials or bodies', async () => {
  const metrics=new RequestMetrics()
  const transport: typeof fetch=async(input)=>{
    if(String(input).includes('/fail'))throw new Error('network unavailable')
    return new Response('[]',{status:200,headers:{'content-length':'2'}})
  }
  const wrapped=metrics.wrap(transport,'https://synthetic.invalid')
  await wrapped('https://synthetic.invalid/rest/v1/tasks?title=secret-title&token=secret-key')
  await wrapped('https://synthetic.invalid/rest/v1/tasks',{method:'PATCH',body:'private text'})
  await expect(wrapped('https://synthetic.invalid/fail')).rejects.toThrow('network unavailable')
  const sample=metrics.snapshot()
  expect(sample.requests).toBe(3);expect(sample.errors).toBe(1)
  expect(sample.routes.find(r=>r.method==='PATCH')?.declaredResponseBytes).toBe(2)
  expect(JSON.stringify(sample)).not.toContain('secret-title')
  expect(JSON.stringify(sample)).not.toContain('secret-key')
  expect(JSON.stringify(sample)).not.toContain('private text')
  expect(metrics.snapshot().requests).toBe(0)
})

it('retains bounded aggregate history independently of renderer lifetime and rejects arbitrary route text', () => {
  const db=new DatabaseSync(':memory:')
  try {
    const journal=new DiagnosticsJournal(db), metrics=new RequestMetrics()
    journal.append(metrics.snapshot(),'synthetic-version')
    expect(new DiagnosticsJournal(db).recent()[0].appVersion).toBe('synthetic-version')
    expect(()=>journal.append({ ...metrics.snapshot(),routes:[{route:'secret-api-key'}] },'v')).toThrow()
    expect(journal.recent()).toHaveLength(1)
  } finally { db.close() }
})
