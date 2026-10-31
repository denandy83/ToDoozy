import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import type { IpcMainInvokeEvent,WebContents } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const harness=vi.hoisted(()=>({open:vi.fn().mockResolvedValue(undefined),expose:vi.fn(),invoke:vi.fn().mockResolvedValue('synthetic-session')}))
vi.mock('electron',()=>({shell:{openExternal:harness.open},contextBridge:{exposeInMainWorld:harness.expose},ipcRenderer:{invoke:harness.invoke,on:vi.fn(),send:vi.fn(),removeListener:vi.fn()}}))
vi.mock('@electron-toolkit/utils',()=>({is:{dev:false}}))
vi.mock('@electron-toolkit/preload',()=>({electronAPI:{}}))
import { assertTrustedSender,guardRendererNavigation,trustedRendererUrl } from './navigation-security'

const originalContext=Object.getOwnPropertyDescriptor(process,'contextIsolated')
const originalMain=Object.getOwnPropertyDescriptor(process,'isMainFrame')
const originalDevUrl=process.env.ELECTRON_RENDERER_URL
beforeEach(()=>{harness.open.mockClear();harness.expose.mockClear();harness.invoke.mockClear();delete process.env.ELECTRON_RENDERER_URL})
afterEach(()=>{
  vi.unstubAllGlobals()
  for(const [key,descriptor] of [['contextIsolated',originalContext],['isMainFrame',originalMain]] as const) {
    if(descriptor)Object.defineProperty(process,key,descriptor)
    else delete (process as unknown as Record<string,unknown>)[key]
  }
  if(originalDevUrl===undefined)delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL=originalDevUrl
})

it('denies external navigation, redirects, unsafe schemes and embedded webviews, with approved links in the external browser',async()=>{
  const listeners=new Map<string,(event:{preventDefault():void},url:string)=>void>()
  let popup!:(details:{url:string})=>unknown
  const contents={on:(event:string,handler:typeof listeners extends Map<string,infer H>?H:never)=>{listeners.set(event,handler);return contents},setWindowOpenHandler:(handler:typeof popup)=>{popup=handler}} as unknown as WebContents
  guardRendererNavigation(contents)
  const event={preventDefault:vi.fn()}
  listeners.get('will-navigate')!(event,'https://example.invalid/landing')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(harness.open).toHaveBeenCalledWith('https://example.invalid/landing')
  event.preventDefault.mockClear()
  listeners.get('will-navigate')!(event,trustedRendererUrl()+'?window=quickadd#task')
  expect(event.preventDefault).not.toHaveBeenCalled()
  listeners.get('will-redirect')!(event,'https://example.invalid/redirect')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(popup({url:'javascript:alert(1)'})).toEqual({action:'deny'})
  expect(popup({url:'file:///private/file'})).toEqual({action:'deny'})
  expect(harness.open).toHaveBeenCalledTimes(1)
  listeners.get('will-attach-webview')!(event,'')
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
})

it('requires the exact application document in a top-level IPC frame',()=>{
  const frame=(url:string,parent:unknown=null)=>({senderFrame:{url,parent}} as IpcMainInvokeEvent)
  expect(()=>assertTrustedSender(frame(trustedRendererUrl()+'#route'))).not.toThrow()
  expect(()=>assertTrustedSender(frame('https://example.invalid'))).toThrow(/Untrusted/)
  expect(()=>assertTrustedSender(frame(trustedRendererUrl(),{}))).toThrow(/Untrusted/)
  expect(()=>assertTrustedSender({senderFrame:null} as IpcMainInvokeEvent)).toThrow(/Untrusted/)
})

it.each([{trusted:true,main:true,exposes:2},{trusted:false,main:true,exposes:0},{trusted:true,main:false,exposes:0}])(
  'actual preload exposure trusted=$trusted main=$main',async({trusted,main,exposes})=>{
    vi.resetModules()
    Object.defineProperty(process,'contextIsolated',{value:true,configurable:true})
    Object.defineProperty(process,'isMainFrame',{value:main,configurable:true})
    const app=pathToFileURL(join(__dirname,'../renderer/index.html')).href
    vi.stubGlobal('location',{href:trusted?app:'https://example.invalid/landing'})
    // Preload is a separate TypeScript build target; execute it dynamically in
    // this runtime fixture without pulling it into the renderer's TS project.
    const preloadModule='../preload/index'
    await import(preloadModule)
    expect(harness.expose).toHaveBeenCalledTimes(exposes)
    expect(harness.invoke).not.toHaveBeenCalled()
  }
)
