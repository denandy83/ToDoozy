import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import type { TimerTrayState } from '../src/preload/index.d'
const require=createRequire(import.meta.url)
const {nativeUiFixture}=require('./native-ui-scope-fixture.cjs')
const dom=new JSDOM('<html><body></body></html>',{url:'http://127.0.0.1'})
vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document)
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const opened:Array<{h:Awaited<ReturnType<typeof nativeUiFixture>>;root?:Root;host?:HTMLDivElement}>=[]
afterEach(async()=>{for(const f of opened.splice(0)){if(f.root)await act(async()=>f.root!.unmount());f.host?.remove();f.h.stop()}})
afterAll(()=>{dom.window.close();vi.unstubAllGlobals()})
async function fixture():Promise<Awaited<ReturnType<typeof nativeUiFixture>>>{const h=await nativeUiFixture();opened.push({h});return h}
const timer:TimerTrayState={remainingSeconds:600,elapsedSeconds:0,phase:'work',isPaused:false,currentRep:1,totalReps:1,isPerpetual:false,taskTitle:'PRIVATE TIMER a',isFlowtime:false,isLongBreak:false,sessionsCompleted:0,totalFocusSecondsToday:0,isCookieBreakPhase:false,cookiePoolSeconds:0}
const settle=async():Promise<void>=>{for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,0))}
async function mount(h:Awaited<ReturnType<typeof nativeUiFixture>>):Promise<HTMLDivElement>{
  const win=h.services.quick.getQuickAddWindow(),api=h.apiFor(win)
  h.sandbox.window=Object.assign(dom.window,{api});h.sandbox.document=dom.window.document
  const host=document.createElement('div');document.body.append(host)
  const {createRoot}=await import('react-dom/client')
  const root=createRoot(host),f=opened.find(f=>f.h===h)!;Object.assign(f,{root,host})
  await act(async()=>{root.render(createElement(h.services.QuickAddApp));await settle()})
  return host
}
async function submit(host:HTMLDivElement):Promise<void>{
  const input=host.querySelector('input')!
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,'CURRENT TASK');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await settle()})
  await act(async()=>{input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await settle()})
}
it.each(['logout','b','a'])('clears actual tray titles, tooltips and timer synchronously on %s',async change=>{
  const h=await fixture();h.switchTo('a');h.invoke('tray:setUserId','a')
  const before=await h.menu();expect(JSON.stringify(before)).toContain('PRIVATE TASK a');expect(before.some((row:{toolTip?:string})=>row.toolTip?.includes('PRIVATE TASK a'))).toBe(true)
  const origin=h.runtime.scope
  h.invoke('timer:updateTimer',timer,origin);expect(h.runtime.title).toContain('10:00')
  if(change==='logout')h.clear();else h.switchTo(change)
  expect(h.runtime.menu).toEqual([]);expect(h.runtime.title).not.toContain('10:00')
  expect(()=>h.invoke('timer:updateTimer',timer,origin)).toThrow()
  expect(()=>h.invoke('timer:clearTimer',origin)).toThrow()
  const menu=await h.menu();expect(JSON.stringify(menu)).not.toContain('PRIVATE TIMER a')
  expect(JSON.stringify(menu)).not.toContain(change==='a'?'PRIVATE TASK b':'PRIVATE TASK a')
  expect(h.services.repositories.get('a').tasks.findById('t-a')?.title).toContain('PRIVATE TASK a')
  if(change==='logout'){
    expect(JSON.stringify(menu)).not.toContain('PRIVATE TASK')
    expect(()=>h.invoke('tray:setUserId','a')).toThrow()
    h.services.quick.showQuickAddWindow();expect(h.services.quick.getQuickAddWindow()).toBeNull()
  }else{
    h.invoke('timer:updateTimer',{...timer,taskTitle:'CURRENT TIMER'},h.runtime.scope)
    expect(h.runtime.title).toContain('10:00')
  }
})
it.each(['logout','b','relogin'])('binds pending ready, close, blur and hide callbacks to their original window after %s',async change=>{
  const h=await fixture();h.switchTo('a');h.services.quick.showQuickAddWindow();const old=h.services.quick.getQuickAddWindow()
  if(change==='logout')h.clear();else{h.switchTo('b');if(change==='relogin')h.switchTo('a')}
  expect(old.isDestroyed()).toBe(true)
  h.services.quick.showQuickAddWindow();const current=h.services.quick.getQuickAddWindow()
  h.runtime.electron.ipcMain.emit('quickadd:ready',h.event(old.webContents))
  if(current){
    expect(current.shown).toBe(0)
    old.emit('closed');old.emit('blur')
    h.runtime.handlers.get('quickadd:hide')(h.event(old.webContents))
    expect(current.isDestroyed()).toBe(false)
    h.runtime.electron.ipcMain.emit('quickadd:ready',h.event(current.webContents));expect(current.shown).toBe(1)
  }else expect(h.services.quick.getQuickAddWindow()).toBeNull()
})
it.each(['external','nested','missing'])('rejects %s frames for ready, timer and scoped Quick Add IPC',async kind=>{
  const h=await fixture();h.switchTo('a');h.services.quick.showQuickAddWindow();const win=h.services.quick.getQuickAddWindow()
  const frame=kind==='missing'?null:{parent:kind==='nested'?{}:null,url:kind==='external'?'https://untrusted.invalid':h.services.trustedRendererUrl()}
  const event=h.event(win.webContents,frame)
  h.runtime.electron.ipcMain.emit('quickadd:ready',event);expect(win.shown).toBe(0)
  expect(()=>h.runtime.handlers.get('timer:updateTimer')(event,timer,h.runtime.scope)).toThrow(/Untrusted/)
  const context=h.invoke('sync:captureContext')
  expect(()=>h.runtime.handlers.get('sync:invokeContext')(event,context,'projects:getProjectsForUser',['a'])).toThrow(/Untrusted/)
  h.runtime.electron.ipcMain.emit('quickadd:ready',h.event(win.webContents));expect(win.shown).toBe(1)
})
it.each(['auth:getSession','projects:getProjectsForUser','settings:getAll','labels:findAll','themes:getConfig'])('suppresses actual Quick Add %s replies after account or database invalidation',async channel=>{
  for(const change of ['logout','b','a']){
    const h=await fixture();h.switchTo('a')
    const repo=h.services.repositories.get('a');repo.settings.set('a','theme_id','synthetic-theme')
    h.services.quick.showQuickAddWindow();const old=h.services.quick.getQuickAddWindow(),hold=h.hold(channel)
    const host=await mount(h);await hold.entered
    await act(async()=>{if(change==='logout')h.clear();else h.switchTo(change);hold.release();await settle()})
    expect(old.isDestroyed()).toBe(true);expect(old.shown).toBe(0);expect(host.textContent).not.toContain('PRIVATE PROJECT a');expect(host.querySelector('input')).toBeNull()
    expect(h.runtime.ready).toBe(0);expect(repo.tasks.findByProjectId('p-a')).toHaveLength(1)
  }
})
it.each(['logout','b','a'])('cancels held Quick Add submit before native creation on %s',async change=>{
  const h=await fixture();h.switchTo('a');h.services.quick.showQuickAddWindow();const host=await mount(h)
  expect(host.textContent).toContain('PRIVATE PROJECT a')
  const hold=h.hold('statuses:findDefault')
  await submit(host);await hold.entered
  await act(async()=>{if(change==='logout')h.clear();else h.switchTo(change);hold.release();await settle()})
  expect(h.services.repositories.get('a').tasks.findByProjectId('p-a')).toHaveLength(1)
  expect(h.services.repositories.get('b').tasks.findByProjectId('p-b')).toHaveLength(1)
  expect(host.querySelector('input')).toBeNull()
})
it.each(['a','b','relogin'])('preserves authenticated offline/current Quick Add and durable task creation for %s',async account=>{
  const h=await fixture();h.switchTo('a');if(account!=='a'){h.clear();h.switchTo('b');if(account==='relogin')h.switchTo('a')}
  h.services.quick.showQuickAddWindow();const win=h.services.quick.getQuickAddWindow(),host=await mount(h)
  const user=account==='b'?'b':'a'
  expect(host.textContent).toContain('PRIVATE PROJECT '+user);expect(win.shown).toBe(1)
  await submit(host)
  expect(h.services.repositories.get(user).tasks.findByProjectId('p-'+user).map((task:{title:string})=>task.title)).toContain('CURRENT TASK')
  expect(win.isDestroyed()).toBe(true)
})
it('allows Quick Add when the optional labels read fails',async()=>{
  const h=await fixture();h.switchTo('a');h.runtime.failChannel='labels:findAll'
  h.services.quick.showQuickAddWindow();const host=await mount(h)
  expect(host.textContent).toContain('PRIVATE PROJECT a')
  await submit(host)
  expect(h.services.repositories.get('a').tasks.findByProjectId('p-a').map((task:{title:string})=>task.title)).toContain('CURRENT TASK')
})
it('keeps signed-out cold startup empty without native row or queue changes',async()=>{
  const h=await fixture(),repo=h.services.repositories.get('a'),queue=repo.syncQueue.findAll()
  h.services.quick.showQuickAddWindow();expect(h.services.quick.getQuickAddWindow()).toBeNull()
  expect(await h.menu()).not.toEqual(expect.arrayContaining([expect.objectContaining({label:expect.stringContaining('PRIVATE')})]))
  expect(repo.tasks.findByProjectId('p-a')).toHaveLength(1);expect(repo.syncQueue.findAll()).toEqual(queue)
})

it('keeps an actual renderer timer bound to its original native generation across A to B to A',async()=>{
  const h=await fixture();h.switchTo('a');h.sandbox.window={api:h.apiFor(h.runtime.mainWindow)}
  const timerStore=h.services.useTimerStore
  timerStore.getState().startTimer({taskId:'t-a',taskTitle:'PRIVATE TIMER a',minutes:10,breakMinutes:1,reps:1,isPerpetual:false,autoBreak:false,soundEnabled:false,notificationEnabled:false,userId:'a'})
  await settle();expect(h.runtime.title).toContain('10:00')
  h.clear();h.switchTo('b');h.switchTo('a')
  timerStore.getState().pause();await settle()
  expect(h.runtime.title).not.toContain('10:00');expect(JSON.stringify(await h.menu())).not.toContain('PRIVATE TIMER a')
})
