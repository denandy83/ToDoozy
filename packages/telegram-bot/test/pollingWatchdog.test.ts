import { createRequire } from 'node:module'
import TelegramBot from 'node-telegram-bot-api'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { startPollingWatchdog, logBotFailure } from '../src/pollingWatchdog'

const require = createRequire(import.meta.url)
const Bluebird = require('bluebird') as PromiseConstructor & { setScheduler: (schedule: (fn: () => void) => void) => void; config: (options: { cancellation: boolean }) => void }
Bluebird.setScheduler((fn) => queueMicrotask(fn))
Bluebird.config({ cancellation: true })
const token = '123456:SYNTHETIC_TOKEN_NEVER_REAL'
let bot: TelegramBot
let active: number
let maxActive: number
let polls: number
let backlog: number
let mode: 'healthy' | 'hung' | 'failure'
let shutdown: (() => Promise<void>) | undefined
const exit = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2030-01-01T00:00:00Z')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  active = 0; maxActive = 0; polls = 0; backlog = 0; mode = 'healthy'; exit.mockReset(); shutdown = undefined
  bot = new TelegramBot(token, { polling: false })
  vi.spyOn(bot, 'getUpdates').mockImplementation(() => {
    polls++; active++; maxActive = Math.max(maxActive,active)
    return new Bluebird<TelegramBot.Update[]>((resolve,reject) => {
      if (mode === 'hung') return
      setTimeout(() => {
        active--
        if (mode === 'failure') reject(Object.assign(new Error(`https://api.telegram.org/bot${token}/getUpdates service-secret`), {code:'EFATAL'}))
        else resolve([])
      },10_000)
    })
  })
  vi.spyOn(bot,'getWebHookInfo').mockImplementation(() => Promise.resolve({url:'',has_custom_certificate:false,pending_update_count:backlog}))
  vi.spyOn(bot,'stopPolling')
  vi.spyOn(bot,'startPolling')
})
afterEach(async () => {
  if (shutdown) { const done = shutdown(); await vi.advanceTimersByTimeAsync(50_000); await done }
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks()
})
function start(): void { shutdown = startPollingWatchdog(bot,exit).shutdown }
function error(code = 'EFATAL',statusCode?: number): void {
  Reflect.apply(bot.emit,bot,['polling_error',Object.assign(new Error(`bot${token} service-secret`),{code,response:{statusCode}})])
}

it('keeps healthy quiet polling running and handles a single transient error',async()=>{
  start(); error('ETELEGRAM',500)
  await vi.advanceTimersByTimeAsync(30*60_000)
  expect(polls).toBeGreaterThan(100);expect(maxActive).toBe(1)
  expect(bot.stopPolling).not.toHaveBeenCalled();expect(exit).not.toHaveBeenCalled()
})
it.each(['fatal','repeated'])('recovers %s errors without overlapping actual library consumers',async(kind)=>{
  start()
  if(kind==='fatal') error()
  else for(let n=0;n<12;n++) {error('ETELEGRAM',502);await vi.advanceTimersByTimeAsync(1000)}
  await vi.advanceTimersByTimeAsync(120_000)
  expect(bot.stopPolling).toHaveBeenCalledWith({cancel:false})
  expect(vi.mocked(bot.stopPolling).mock.calls.length).toBeLessThanOrEqual(2)
  expect(vi.mocked(bot.startPolling).mock.calls.length).toBeGreaterThan(1)
  expect(maxActive).toBe(1);expect(exit).not.toHaveBeenCalled()
})
it('fails safely when a graceful stop is hung, without starting another poller',async()=>{
  mode='hung';start();error()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  expect(bot.startPolling).toHaveBeenCalledTimes(1);expect(maxActive).toBe(1)
  shutdown=undefined
})
it('detects stalled active polling even with no backlog',async()=>{
  mode='hung';start()
  await vi.advanceTimersByTimeAsync(5*60_000)
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);expect(maxActive).toBe(1)
  shutdown=undefined
})
it('exits on an inactive consumer',async()=>{
  start();const stopped=bot.stopPolling({cancel:false})
  await vi.advanceTimersByTimeAsync(11_000);await stopped
  await vi.advanceTimersByTimeAsync(60_000)
  expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  shutdown=undefined
})
it('detects growing or undrained backlog but permits normal drainage',async()=>{
  start()
  backlog=5;await vi.advanceTimersByTimeAsync(60_000)
  backlog=10;await vi.advanceTimersByTimeAsync(60_000)
  backlog=0;await vi.advanceTimersByTimeAsync(60_000)
  expect(bot.stopPolling).not.toHaveBeenCalled()
  for(let n=1;n<=3;n++) {backlog=n*5;await vi.advanceTimersByTimeAsync(60_000)}
  await vi.advanceTimersByTimeAsync(30_000)
  expect(bot.stopPolling).toHaveBeenCalledTimes(1);expect(maxActive).toBe(1)
  expect(exit).not.toHaveBeenCalled()
})
it('bounds persistent failures and recovery cadence',async()=>{
  mode='failure';start()
  await vi.advanceTimersByTimeAsync(20*60_000)
  expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  expect(vi.mocked(bot.stopPolling).mock.calls.length).toBeLessThanOrEqual(3)
  expect(maxActive).toBe(1)
  shutdown=undefined
})
it('keeps healthy polling alive through failed or hung watchdog requests',async()=>{
  vi.mocked(bot.getWebHookInfo).mockRejectedValueOnce(new Error(token)).mockImplementationOnce(()=>new Promise(()=>{}))
  start();await vi.advanceTimersByTimeAsync(20*60_000)
  expect(bot.getWebHookInfo).toHaveBeenCalled();expect(exit).not.toHaveBeenCalled();expect(maxActive).toBe(1)
})
it('cancels retries on shutdown and awaits the old consumer',async()=>{
  start();error();const done=shutdown!()
  await vi.advanceTimersByTimeAsync(120_000);await done
  expect(exit).toHaveBeenCalledExactlyOnceWith(0)
  expect(bot.startPolling).toHaveBeenCalledTimes(1);expect(active).toBe(0)
  expect(vi.getTimerCount()).toBe(0);shutdown=undefined
})
it('stops for rate limiting before backing off and never logs raw secrets',async()=>{
  start()
  Reflect.apply(bot.emit,bot,['polling_error',{code:'ETELEGRAM',response:{statusCode:429,body:{parameters:{retry_after:90}}},message:token}])
  await vi.advanceTimersByTimeAsync(89_000)
  expect(bot.startPolling).toHaveBeenCalledTimes(1);expect(active).toBe(0)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(bot.startPolling).toHaveBeenCalledTimes(2)
  logBotFailure('Synthetic transport failure',new Error(token+' service-secret'))
  const output=vi.mocked(console.error).mock.calls.flat().join(' ')
  expect(output).not.toContain(token);expect(output).not.toContain('service-secret');expect(output).toContain('Polling error')
})
it.each([401,403,409])('exits on unrecoverable HTTP %s without retrying',async(status)=>{
  start();error('ETELEGRAM',status)
  await vi.advanceTimersByTimeAsync(100_000)
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);expect(bot.startPolling).toHaveBeenCalledTimes(1)
  shutdown=undefined
})
it('demonstrates the pinned library cancel trap with an isolated negative control',async()=>{
  mode='hung';void bot.startPolling({restart:false})
  await bot.stopPolling({cancel:true})
  void bot.startPolling({restart:false})
  await vi.advanceTimersByTimeAsync(1000)
  expect(maxActive).toBeGreaterThan(1)
})

it('exhausts the recovery budget when active polling never drains backlog',async()=>{
  start();backlog=10
  await vi.advanceTimersByTimeAsync(25*60_000)
  expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  expect(bot.stopPolling).toHaveBeenCalledTimes(3);expect(maxActive).toBe(1)
  shutdown=undefined
})
it('cancels a scheduled backoff without rearming polling',async()=>{
  start();error();await vi.advanceTimersByTimeAsync(11_000)
  const done=shutdown!();await vi.advanceTimersByTimeAsync(120_000);await done
  expect(bot.startPolling).toHaveBeenCalledTimes(1)
  expect(exit).toHaveBeenCalledExactlyOnceWith(0);expect(vi.getTimerCount()).toBe(0)
  shutdown=undefined
})
