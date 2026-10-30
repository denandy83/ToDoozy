import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

interface TrafficResult {
  initialRequests: number
  timerRequests: number
  activeFallbackIntervals: number
  maxConcurrentProjectPulls: number
  requestsBeforeTimer: number
  requestsByTable: Record<string, number>
}
const require = createRequire(import.meta.url)
const fixture = require('./benchmark-sync.cjs') as {
  trafficScenario(options: { connected: boolean; flaps?: number; archived?: number }): Promise<TrafficResult>
  behaviorScenarios(): Promise<Array<{ name: string; passed: boolean; error?: string }>>
  makeHarness(options: { projectCount: number; archived: number }): {
    sandbox: { fixture: { pullNewTasks(projectId: string): Promise<number> } }
    projects: Array<{ id: string }>
    requests: Array<{ table: string }>
    run(): Promise<() => void>
    untilIdle(): Promise<void>
    stop(): void
  }
}

it('uses one metadata read per project and no fallback tick while already healthy', async () => {
  const result = await fixture.trafficScenario({ connected: true })
  expect(result.initialRequests).toBe(60)
  expect(result.requestsByTable).toEqual({ projects: 20, statuses: 20, tasks: 20 })
  expect(result.timerRequests).toBe(0)
  expect(result.activeFallbackIntervals).toBe(0)
})

it('coalesces a reconnect burst while retaining one pending follow-up', async () => {
  const result = await fixture.trafficScenario({ connected: false, flaps: 3 })
  expect(result.maxConcurrentProjectPulls).toBe(1)
  expect(result.requestsBeforeTimer).toBe(180)
  expect(result.timerRequests).toBe(0)
})

it('keeps archive metadata discovery while omitting archived task/status sweeps', async () => {
  const result = await fixture.trafficScenario({ connected: true, archived: 4 })
  expect(result.initialRequests).toBe(52)
  expect(result.requestsByTable).toEqual({ projects: 20, statuses: 16, tasks: 16 })
})

it('preserves explicit archived pulls while background work requests only archive metadata', async () => {
  const harness = fixture.makeHarness({ projectCount: 1, archived: 1 })
  const cleanup = await harness.run()
  try {
    await harness.untilIdle()
    expect(harness.requests.map(row => row.table)).toEqual(['projects'])
    harness.requests.length = 0
    await harness.sandbox.fixture.pullNewTasks(harness.projects[0].id)
    expect(harness.requests.map(row => row.table)).toEqual(['projects', 'statuses', 'tasks'])
  } finally {
    cleanup()
    harness.stop()
  }
})

it('exercises suspended/offline recovery, remote restore, aggregate health and disposal races', async () => {
  const cases = await fixture.behaviorScenarios()
  expect(cases).toHaveLength(10)
  for (const result of cases) expect(result.passed, `${result.name}: ${result.error ?? ''}`).toBe(true)
})
