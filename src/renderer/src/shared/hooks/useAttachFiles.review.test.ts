// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAttachFiles } from './useAttachFiles'
import { useAuthStore } from '../stores/authStore'
import { useAttachmentStore } from '../stores/attachmentStore'

vi.mock('../components/Toast',()=>({useToast:()=>({addToast:vi.fn()})}))
let root: Root
let attach: () => Promise<void>
let generation: number
let create: ReturnType<typeof vi.fn>
let dialog: ReturnType<typeof vi.fn>
beforeEach(async()=>{
  generation=1
  useAuthStore.setState({currentUser:{id:'a'} as never})
  create=vi.fn(async(task_id:string,path:string)=>({id:path,task_id}))
  dialog=vi.fn().mockResolvedValue({canceled:false,filePaths:['one','two']})
  Object.assign(window,{api:{fs:{showOpenDialog:dialog},attachments:{createFromFile:create},sync:{
    captureContext:async()=>({generation,userId:useAuthStore.getState().currentUser?.id}),
    invokeContext:async(origin:{generation:number},channel:string,args:unknown[])=>{
      if(origin.generation!==generation)throw Error('Database changed')
      if(channel!=='attachments:createFromFile')throw Error('Unexpected operation')
      return create(...args)
    }
  }}})
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  function Harness(): null {attach=useAttachFiles('shared-task');return null}
  root=createRoot(document.createElement('div'))
  await act(async()=>{root.render(createElement(Harness))})
})
afterEach(async()=>{await act(async()=>{root.unmount()});vi.restoreAllMocks()})
it('does not create attachments after an old-account file dialog completes',async()=>{
  let finish!:(value:unknown)=>void
  dialog.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const pending=attach()
  generation++;useAuthStore.setState({currentUser:{id:'b'} as never})
  finish({canceled:false,filePaths:['private-a']})
  await act(async()=>{await pending})
  expect(create).not.toHaveBeenCalled()
  expect(useAttachmentStore.getState().attachments).toEqual({})
})
it('discards an old creation result and stops the rest of its file batch',async()=>{
  let finish!:(value:unknown)=>void
  let entered!:()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  create.mockImplementation(()=>{entered();return new Promise(resolve=>{finish=resolve})})
  const pending=attach();await started
  generation++;useAuthStore.setState({currentUser:{id:'b'} as never})
  finish({id:'private-a',task_id:'shared-task'})
  await act(async()=>{await pending})
  expect(create).toHaveBeenCalledOnce()
  expect(useAttachmentStore.getState().attachments).toEqual({})
})
it('adds every selected file for the current account',async()=>{
  await act(async()=>{await attach()})
  expect(create).toHaveBeenCalledTimes(2)
  expect(Object.keys(useAttachmentStore.getState().attachments)).toEqual(['one','two'])
})
