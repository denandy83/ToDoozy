export interface HostMetricsSample {
  observedAt: string
  scrapeOk: boolean
  stale: boolean
  disks: Array<{ device: string; readIops: number|null; writeIops: number|null; readBytesPerSecond: number|null; writeBytesPerSecond: number|null; busyFraction: number|null }>
  cpuIowaitPercent: number|null
  memoryUsedBytes: number|null
  swapUsedBytes: number|null
  swapInPagesPerSecond: number|null
  swapOutPagesPerSecond: number|null
  budgetBalancePercent: number|null
}

/** Only allowlisted numeric summaries may cross from the private collector. */
export function sanitizeHostMetrics(raw: unknown, now = Date.now()): HostMetricsSample {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid host metrics')
  const value=raw as Record<string,unknown>
  if (typeof value.observed_at !== 'string' || !Number.isFinite(Date.parse(value.observed_at))) throw new Error('Invalid sample time')
  const metrics=(value.metrics && typeof value.metrics==='object' ? value.metrics : {}) as Record<string,unknown>
  const disks=(metrics.disks && typeof metrics.disks==='object' ? metrics.disks : {}) as Record<string,Record<string,unknown>>
  const swap=(metrics.swap_activity && typeof metrics.swap_activity==='object' ? metrics.swap_activity : {}) as Record<string,unknown>
  const numeric=(n:unknown):number|null=>typeof n==='number'&&Number.isFinite(n)&&n>=0 ? n : null
  const scrapeOk=value.scrape_ok===true
  return { observedAt:new Date(value.observed_at).toISOString(),scrapeOk,
    stale: now-Date.parse(value.observed_at)>180_000 || Date.parse(value.observed_at)-now>60_000,
    disks:scrapeOk?Object.entries(disks).filter(([device])=>/^[a-zA-Z0-9_-]{1,40}$/.test(device)).slice(0,10).map(([device,d])=>({
      device,readIops:numeric(d?.read_iops),writeIops:numeric(d?.write_iops),
      readBytesPerSecond:numeric(d?.read_bytes_per_second),writeBytesPerSecond:numeric(d?.write_bytes_per_second),busyFraction:numeric(d?.busy_fraction)
    })):[],
    cpuIowaitPercent:scrapeOk?numeric(metrics.cpu_iowait_percent):null,
    memoryUsedBytes:scrapeOk?numeric(metrics.memory_used_bytes):null,
    swapUsedBytes:scrapeOk?numeric(metrics.swap_used_bytes):null,
    swapInPagesPerSecond:scrapeOk?numeric(swap.in_pages_per_second):null,
    swapOutPagesPerSecond:scrapeOk?numeric(swap.out_pages_per_second):null,
    budgetBalancePercent:scrapeOk?numeric(metrics.burst_budget_balance_percent):null }
}
