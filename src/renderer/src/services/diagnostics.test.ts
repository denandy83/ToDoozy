import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const log=vi.hoisted(()=>vi.fn())
vi.mock('../shared/stores/logStore',()=>({logEvent:log}))
import { startDiagnostics } from './diagnostics'
import { supabaseRequestMetrics } from '../../../shared/supabaseTelemetry'

beforeEach(()=>{vi.useFakeTimers();log.mockReset();supabaseRequestMetrics.snapshot()})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();supabaseRequestMetrics.snapshot()})
const settle=async():Promise<void>=>{for(let n=0;n<5;n++)await Promise.resolve()}

it('stops its minute timer, flushes final counters once, and ignores history replies after disposal',async()=>{
  let resolveHistory:(value:unknown[])=>void=()=>{}
  const append=vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window',{api:{diagnostics:{append,hostRecent:vi.fn().mockResolvedValue([]),recent:()=>new Promise<unknown[]>(resolve=>{resolveHistory=resolve})}}})
  const stop=startDiagnostics()
  const fetch=supabaseRequestMetrics.wrap(async()=>new Response('[]'),'https://synthetic.invalid')
  await fetch('https://synthetic.invalid/rest/v1/tasks?private=hidden')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(append).toHaveBeenCalledTimes(1)
  expect(append.mock.calls[0][0].requests).toBe(1)
  stop()
  expect(append).toHaveBeenCalledTimes(2)
  resolveHistory([{endedAt:'stale-history',routes:[]}])
  await settle()
  await vi.advanceTimersByTimeAsync(180_000)
  expect(append).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(log.mock.calls)).not.toContain('stale-history')
  expect(JSON.stringify(log.mock.calls)).not.toContain('hidden')
})

it('deduplicates unchanged host samples and exposes unavailable/stale status without making it measured zero',async()=>{
  const sample={observedAt:new Date().toISOString(),scrapeOk:false,stale:false,disks:[],cpuIowaitPercent:null,swapUsedBytes:null,budgetBalancePercent:null}
  vi.stubGlobal('window',{api:{diagnostics:{append:vi.fn().mockResolvedValue(undefined),recent:vi.fn().mockResolvedValue([]),hostRecent:vi.fn().mockResolvedValue([sample])}}})
  const stop=startDiagnostics()
  await settle()
  await vi.advanceTimersByTimeAsync(120_000)
  const hostLogs=log.mock.calls.filter(call=>String(call[2]).startsWith('Supabase host'))
  expect(hostLogs).toHaveLength(1)
  expect(hostLogs[0][0]).toBe('warn')
  expect(JSON.parse(hostLogs[0][3])).toMatchObject({scrapeOk:false,cpuIowaitPercent:null,disks:[]})
  stop()
})
