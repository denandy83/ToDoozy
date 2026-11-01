export interface TrafficRoute {
  route: string; method: string; requests: number; errors: number; headersMs: number
  declaredResponseBytes: number; unknownResponseSizes: number
}
export interface TrafficSummary {
  startedAt: string; endedAt: string; elapsedSeconds: number; requests: number; errors: number
  routes: TrafficRoute[]; appVersion?: string
}
const tables = new Set(['tasks','projects','statuses','project_members','project_invites','activity_log','api_keys',
  'user_settings','user_labels','user_saved_views','user_project_areas','user_themes','project_labels','task_labels','release_notes'])
const methods = new Set(['GET','POST','PATCH','PUT','DELETE','HEAD','OTHER'])

export class RequestMetrics {
  private started = Date.now()
  private routes = new Map<string, TrafficRoute>()
  wrap(implementation: typeof fetch, projectUrl: string): typeof fetch {
    const origin = new URL(projectUrl).origin
    return async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.origin !== origin) return implementation(input, options)
      const segments = url.pathname.split('/').filter(Boolean)
      const route = segments[0] === 'rest' && segments[1] === 'v1' && tables.has(segments[2])
        ? `rest/${segments[2]}` : ['auth','functions','realtime'].includes(segments[0]) ? segments[0] : 'other'
      const supplied = (options?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
      const method = methods.has(supplied) ? supplied : 'OTHER'
      const start = performance.now()
      try {
        const response = await implementation(input, options)
        this.record(route, method, !response.ok, performance.now()-start, response.headers.get('content-length'))
        return response
      } catch (error) { this.record(route, method, true, performance.now()-start, null); throw error }
    }
  }
  private record(route: string, method: string, failed: boolean, duration: number, size: string|null): void {
    const key = `${route}:${method}`
    const item = this.routes.get(key) ?? { route,method,requests:0,errors:0,headersMs:0,declaredResponseBytes:0,unknownResponseSizes:0 }
    item.requests++;item.errors+=Number(failed);item.headersMs+=duration
    const bytes = size !== null && /^\d+$/.test(size) ? Number(size) : NaN
    if (Number.isSafeInteger(bytes)) item.declaredResponseBytes+=bytes
    else item.unknownResponseSizes++
    this.routes.set(key,item)
  }
  snapshot(now = Date.now()): TrafficSummary {
    const routes = [...this.routes.values()]
    const result = { startedAt:new Date(this.started).toISOString(),endedAt:new Date(now).toISOString(),
      elapsedSeconds:Math.max(0,(now-this.started)/1000),requests:routes.reduce((n,r)=>n+r.requests,0),
      errors:routes.reduce((n,r)=>n+r.errors,0),routes }
    this.started=now;this.routes.clear()
    return result
  }
}

/** Reject arbitrary renderer text and credentials before writing a diagnostics file. */
export function validateTrafficSummary(value: unknown): TrafficSummary {
  if (!value || typeof value !== 'object') throw new Error('Invalid traffic summary')
  const input=value as TrafficSummary
  const number=(n:unknown):number=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e12)throw new Error('Invalid metric');return n}
  const date=(s:unknown):string=>{if(typeof s!=='string'||!Number.isFinite(Date.parse(s)))throw new Error('Invalid metric time');return new Date(s).toISOString()}
  if (!Array.isArray(input.routes)||input.routes.length>150) throw new Error('Invalid traffic routes')
  return { startedAt:date(input.startedAt),endedAt:date(input.endedAt),elapsedSeconds:number(input.elapsedSeconds),
    requests:number(input.requests),errors:number(input.errors),routes:input.routes.map(r=>{
      if (!r||!methods.has(r.method)||!['auth','functions','realtime','other',...[...tables].map(t=>`rest/${t}`)].includes(r.route)) throw new Error('Invalid route')
      return {route:r.route,method:r.method,requests:number(r.requests),errors:number(r.errors),headersMs:number(r.headersMs),
        declaredResponseBytes:number(r.declaredResponseBytes),unknownResponseSizes:number(r.unknownResponseSizes)}
    }) }
}

export const supabaseRequestMetrics = new RequestMetrics()
