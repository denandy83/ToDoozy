import { supabaseRequestMetrics } from '../../../shared/supabaseTelemetry'
import { logEvent } from '../shared/stores/logStore'

export function startDiagnostics(): () => void {
  let active = true
  let latestHost = ''
  const host = (): void => {
    void window.api.diagnostics.hostRecent().then(history => {
      if (!active) return
      const sample=history.at(-1)
      if (!sample) return
      const key=`${sample.observedAt}:${sample.stale}:${sample.scrapeOk}`
      if (key===latestHost) return
      latestHost=key
      logEvent(sample.stale||!sample.scrapeOk?'warn':'info','sync',
        sample.stale||!sample.scrapeOk?'Supabase host metrics unavailable/stale':'Supabase host I/O summary',JSON.stringify(sample))
    }).catch(()=>{})
  }
  host()
  void window.api.diagnostics.recent().then(history => {
    if (active) for (const sample of history) logEvent('info','sync',`Prior Supabase traffic · ${sample.endedAt}`,JSON.stringify(sample))
  }).catch(()=>{})
  const flush = (): void => {
    const sample = supabaseRequestMetrics.snapshot()
    logEvent('info','sync','Supabase traffic summary',JSON.stringify(sample))
    void window.api.diagnostics.append(sample).catch(()=>{})
    host()
  }
  const timer=setInterval(flush,60_000)
  return () => { active=false;clearInterval(timer);flush() }
}
