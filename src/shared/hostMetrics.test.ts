import { expect, it } from 'vitest'
import { sanitizeHostMetrics } from './hostMetrics'

it('keeps missing/failing/stale metrics distinct from measured zero and excludes raw labels/secrets', () => {
  const sample={observed_at:'2026-10-30T12:00:00Z',scrape_ok:true,secret:'do-not-copy',metrics:{disks:{disk0:{read_iops:0,write_iops:2,read_bytes_per_second:null,raw_secret:'hidden'}},burst_budget_balance_percent:null}}
  const safe=sanitizeHostMetrics(sample,Date.parse('2026-10-30T12:05:00Z'))
  expect(safe.stale).toBe(true)
  expect(safe.disks[0].readIops).toBe(0)
  expect(safe.disks[0].readBytesPerSecond).toBeNull()
  expect(safe.budgetBalancePercent).toBeNull()
  expect(JSON.stringify(safe)).not.toContain('do-not-copy')
  expect(JSON.stringify(safe)).not.toContain('hidden')
  expect(sanitizeHostMetrics({...sample,scrape_ok:false}).disks).toEqual([])
})
