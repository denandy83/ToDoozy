import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from './authStore'
import { useProjectAreaStore } from './projectAreaStore'
import { useSavedViewStore } from './savedViewStore'
import { useTemplateStore } from './templateStore'
import { useAttachmentStore } from './attachmentStore'
import { useTaskStore } from './taskStore'
import { useTimerStore } from './timerStore'
import { useNotificationStore } from './notificationStore'
import { useSettingsStore } from './settingsStore'
import { captureSyncProducer } from '../../services/syncContext'
import { hydrationContext } from './hydrationContext'
import * as personalSync from '../../services/PersonalSyncService'

vi.mock('../../services/PersonalSyncService',()=>({
  pushSetting:vi.fn(),pushTheme:vi.fn().mockResolvedValue(undefined),deleteThemeFromSupabase:vi.fn().mockResolvedValue(undefined),deleteSettingFromSupabase:vi.fn().mockResolvedValue(undefined),
  pushProjectArea:vi.fn().mockResolvedValue(undefined),
  pushProjectTemplate:vi.fn().mockResolvedValue(undefined),
  pushSavedView:vi.fn().mockResolvedValue(undefined),
  pushProject:vi.fn().mockResolvedValue(undefined),
  deleteProjectAreaFromSupabase:vi.fn().mockResolvedValue(undefined),
  deleteProjectTemplateFromSupabase:vi.fn().mockResolvedValue(undefined),
  deleteSavedViewFromSupabase:vi.fn().mockResolvedValue(undefined)
}))
let generation: number
beforeEach(()=>{
  vi.clearAllMocks()
  generation=1
  vi.stubGlobal('window',{api:{ activityLog:{create:vi.fn().mockResolvedValue({})},timer:{clearTimer:vi.fn(),updateTimer:vi.fn(),minimizeToTray:vi.fn()},sync:{
    captureContext:async()=>({generation,userId:useAuthStore.getState().currentUser?.id}),
    invokeContext:async(origin:{generation:number},channel:string,args:unknown[])=>{
      if(origin.generation!==generation)throw Error('Database changed')
      const [namespace,method]=channel.split(':')
      const api=window.api as unknown as Record<string,Record<string,(...args:unknown[])=>unknown>>
      return api[namespace][method](...args)
    }
  },savedViews:{countMatching:async()=>0}}})
  useAuthStore.setState({currentUser:{id:'a'} as never})
})
afterEach(()=>{useTimerStore.getState().stop();vi.useRealTimers();vi.unstubAllGlobals()})

it.each([
  {namespace:'projectAreas',method:'findByUserId',hydrate:()=>useProjectAreaStore.getState().hydrate('a'),state:()=>useProjectAreaStore.getState().areas},
  {namespace:'projectTemplates',method:'findAll',hydrate:()=>useTemplateStore.getState().hydrateProjectTemplates('a'),state:()=>Object.values(useTemplateStore.getState().projectTemplates)},
  {namespace:'savedViews',method:'findByUserId',hydrate:()=>useSavedViewStore.getState().hydrate('a'),state:()=>useSavedViewStore.getState().views}
])('fences a deferred $namespace hydration after an account and database switch',async({namespace,method,hydrate,state})=>{
  let finish!:(value:unknown)=>void
  let entered!:()=>void
  const started=new Promise<void>(r=>{entered=r})
  Object.assign(window.api,{[namespace]:{[method]:()=>{entered();return new Promise(r=>{finish=r})}}})
  const pending=hydrate()
  await started
  generation++
  useAuthStore.setState({currentUser:{id:'b'} as never})
  finish([{id:'secret-a',user_id:'a',owner_id:'a',name:'Private A',filter_config:'{}'}])
  await pending
  expect(state()).toEqual([])
})

it('keeps task B attachments when A responds later',async()=>{
  let finish!:(value:unknown)=>void
  Object.assign(window.api,{attachments:{findByTaskId:(taskId:string)=>taskId==='a'?new Promise(r=>{finish=r}):Promise.resolve([{id:'b-file',task_id:'b'}])}})
  const old=useAttachmentStore.getState().hydrateAttachments('a')
  await useAttachmentStore.getState().hydrateAttachments('b')
  finish([{id:'a-file',task_id:'a'}]);await old
  expect(Object.keys(useAttachmentStore.getState().attachments)).toEqual(['b-file'])
})

it('clears old account private tasks, timer context and notifications synchronously',()=>{
  useTaskStore.setState({tasks:{private:{id:'private',owner_id:'a',title:'Private title'} as never}})
  useTimerStore.setState({isRunning:true,taskId:'private',taskTitle:'Private title'})
  useNotificationStore.setState({notifications:[{id:'n',message:'Private title'} as never],unreadCount:1,panelOpen:true})
  useAuthStore.setState({currentUser:{id:'b'} as never})
  expect(useTaskStore.getState().tasks).toEqual({})
  expect(useTimerStore.getState().taskTitle).toBeNull()
  expect(useTimerStore.getState().isRunning).toBe(false)
  expect(useNotificationStore.getState().notifications).toEqual([])
})

it('does not republish notifications from a deferred old-account hydration',async()=>{
  let finish!:(value:unknown)=>void
  Object.assign(window.api,{notifications:{findAll:()=>new Promise(r=>{finish=r}),getUnreadCount:async()=>1}})
  const pending=useNotificationStore.getState().hydrate()
  await Promise.resolve();await Promise.resolve()
  generation++;useAuthStore.setState({currentUser:{id:'b'} as never})
  finish([{id:'n',message:'Private A notification'}]);await pending
  expect(useNotificationStore.getState().notifications).toEqual([])
  expect(useNotificationStore.getState().unreadCount).toBe(0)
})

it.each(['area','template'])('does not republish a late old-account %s creation',async(kind)=>{
  let finish!:(value:unknown)=>void
  Object.assign(window.api,{projectAreas:{create:()=>new Promise(r=>{finish=r})},projectTemplates:{create:()=>new Promise(r=>{finish=r})}})
  const pending=kind==='area'?useProjectAreaStore.getState().createArea('a','Private A')
    :useTemplateStore.getState().createProjectTemplate({id:'private',owner_id:'a',name:'Private A',color:'#fff',data:'{}'})
  const cancelled=expect(pending).rejects.toThrow('Sync account or database changed')
  await Promise.resolve();await Promise.resolve()
  generation++;useAuthStore.setState({currentUser:{id:'b'} as never})
  finish({id:'private',user_id:'a',owner_id:'a',name:'Private A'});await cancelled
  expect(useProjectAreaStore.getState().areas).toEqual([])
  expect(useTemplateStore.getState().projectTemplates).toEqual({})
})

it.each(['area','template','saved view'])('preserves normal current-account %s creation',async(kind)=>{
  const create=vi.fn(async(input:Record<string,unknown>)=>({...input,created_at:'2026-10-30T00:00:00Z',updated_at:'2026-10-30T00:00:00Z'}))
  Object.assign(window.api,{projectAreas:{create},projectTemplates:{create},savedViews:{create}})
  const row=kind==='area'?await useProjectAreaStore.getState().createArea('a','Normal')
    :kind==='template'?await useTemplateStore.getState().createProjectTemplate({id:'normal-template',owner_id:'a',name:'Normal',color:'#fff',data:'{}'})
    :await useSavedViewStore.getState().createView('a','Normal','{}')
  expect('user_id' in row ? row.user_id : row.owner_id).toBe('a')
  expect(row.name).toBe('Normal')
  expect(create).toHaveBeenCalledOnce()
  if(kind==='area')expect(useProjectAreaStore.getState().areas.map(area=>area.id)).toEqual([row.id])
  else if(kind==='template')expect(useTemplateStore.getState().projectTemplates[row.id]).toEqual(row)
  else expect(useSavedViewStore.getState().views).toEqual([row])
})

it.each([
  {name:'area update',namespace:'projectAreas',method:'update',run:()=>useProjectAreaStore.getState().updateArea('shared-id',{name:'Old A'})},
  {name:'area delete',namespace:'projectAreas',method:'delete',run:()=>useProjectAreaStore.getState().deleteArea('shared-id')},
  {name:'area reorder',namespace:'projectAreas',method:'reorder',run:()=>useProjectAreaStore.getState().reorderAreas(['shared-id'])},
  {name:'area assignment',namespace:'projectAreas',method:'assignProject',run:()=>useProjectAreaStore.getState().assignProject('shared-id','area-a')},
  {name:'template update',namespace:'projectTemplates',method:'update',run:()=>useTemplateStore.getState().updateProjectTemplate('shared-id',{name:'Old A'})},
  {name:'template delete',namespace:'projectTemplates',method:'delete',run:()=>useTemplateStore.getState().deleteProjectTemplate('shared-id')},
  {name:'saved view create',namespace:'savedViews',method:'create',run:()=>useSavedViewStore.getState().createView('a','Old A','{}')},
  {name:'saved view update',namespace:'savedViews',method:'update',run:()=>useSavedViewStore.getState().updateView('shared-id',{name:'Old A'})},
  {name:'saved view delete',namespace:'savedViews',method:'delete',run:()=>useSavedViewStore.getState().deleteView('shared-id')},
  {name:'saved view reorder',namespace:'savedViews',method:'reorder',run:()=>useSavedViewStore.getState().reorderViews(['shared-id'])}
])('cancels deferred $name before it can mutate the new account or publish sync work',async({namespace,method,run})=>{
  let finish!:(value:unknown)=>void
  let entered!:()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  const findProject=vi.fn().mockResolvedValue({id:'shared-id',owner_id:'b'})
  Object.assign(window.api,{
    [namespace]:{[method]:()=>{entered();return new Promise(resolve=>{finish=resolve})}},
    projects:{findById:findProject}
  })
  const pending=run()
  const cancelled=expect(pending).rejects.toThrow(/(?:Sync account (?:or database changed|changed or signed out)|Database changed)/)
  await started
  generation++
  useAuthStore.setState({currentUser:{id:'b'} as never})
  // Reused IDs make any leaked update/delete/reorder visible, rather than a harmless no-op.
  const currentArea={id:'shared-id',user_id:'b',name:'Private B',sidebar_order:9} as never
  const currentTemplate={id:'shared-id',owner_id:'b',name:'Private B'} as never
  const currentView={id:'shared-id',user_id:'b',name:'Private B',sidebar_order:9,filter_config:'{}'} as never
  useProjectAreaStore.setState({areas:[currentArea]})
  useTemplateStore.setState({projectTemplates:{'shared-id':currentTemplate},error:null})
  useSavedViewStore.setState({views:[currentView],viewCounts:{'shared-id':3}})
  finish(method==='delete'?true:{id:'shared-id',user_id:'a',owner_id:'a',name:'Old A',sidebar_order:0,filter_config:'{}'})
  await cancelled
  await Promise.resolve()
  expect(useProjectAreaStore.getState().areas).toEqual([currentArea])
  expect(useTemplateStore.getState().projectTemplates).toEqual({'shared-id':currentTemplate})
  expect(useTemplateStore.getState().error).toBeNull()
  expect(useSavedViewStore.getState().views).toEqual([currentView])
  expect(useSavedViewStore.getState().viewCounts).toEqual({'shared-id':3})
  expect(findProject).not.toHaveBeenCalled()
  for(const publish of Object.values(personalSync))expect(publish).not.toHaveBeenCalled()
})

it('discards a scheduled account A recount before it can query or overwrite account B views',async()=>{
  vi.useFakeTimers()
  const countMatching=vi.fn().mockResolvedValue(99)
  Object.assign(window.api,{savedViews:{countMatching}})
  useSavedViewStore.setState({views:[{id:'view-a',user_id:'a',filter_config:'{}'} as never],viewCounts:{'view-a':2}})
  useSavedViewStore.getState().scheduleRecount('a')
  generation++;useAuthStore.setState({currentUser:{id:'b'} as never})
  const currentView={id:'view-b',user_id:'b',filter_config:'{}'} as never
  useSavedViewStore.setState({views:[currentView],viewCounts:{'view-b':7}})
  await vi.advanceTimersByTimeAsync(1000)
  expect(countMatching).not.toHaveBeenCalled()
  expect(useSavedViewStore.getState().views).toEqual([currentView])
  expect(useSavedViewStore.getState().viewCounts).toEqual({'view-b':7})
})

it('still executes a scheduled recount when its account and database remain current',async()=>{
  vi.useFakeTimers()
  const countMatching=vi.fn().mockResolvedValue(11)
  Object.assign(window.api,{savedViews:{countMatching}})
  useSavedViewStore.setState({views:[{id:'view-a',user_id:'a',filter_config:'{"priority":[1]}'} as never],viewCounts:{'view-a':2}})
  useSavedViewStore.getState().scheduleRecount('a')
  await vi.advanceTimersByTimeAsync(1000)
  expect(countMatching).toHaveBeenCalledExactlyOnceWith('{"priority":[1]}','a')
  expect(useSavedViewStore.getState().viewCounts).toEqual({'view-a':11})
})

it('counts elapsed time when interval callbacks were suspended, and excludes explicit pause time',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'))
  useTimerStore.getState().startTimer({taskId:'t',taskTitle:'Synthetic',minutes:25,reps:1,isPerpetual:false,breakMinutes:5,soundEnabled:false,notificationEnabled:false,autoBreak:false,userId:'a'})
  vi.setSystemTime(new Date('2026-10-25T12:10:00.000Z'))
  vi.advanceTimersByTime(1000)
  expect(useTimerStore.getState().remainingSeconds).toBe(899)
  useTimerStore.getState().pause()
  vi.advanceTimersByTime(600_000)
  useTimerStore.getState().resume();vi.advanceTimersByTime(1000)
  expect(useTimerStore.getState().remainingSeconds).toBe(898)
})

it('carries a delayed callback across an automatically started break',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'))
  useTimerStore.getState().startTimer({taskId:'t',taskTitle:'Synthetic',minutes:25,reps:1,isPerpetual:false,breakMinutes:5,soundEnabled:false,notificationEnabled:false,autoBreak:true,userId:'a'})
  vi.setSystemTime(new Date('2026-10-25T12:26:00.000Z'))
  vi.advanceTimersByTime(1000)
  expect(useTimerStore.getState().phase).toBe('break')
  expect(useTimerStore.getState().remainingSeconds).toBe(239)
})

it.each(['settings','themes','config'])('discards late %s hydration after account/database replacement',async(kind)=>{
  let finish!:(value:unknown)=>void
  let entered!:()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  const read=()=>{entered();return new Promise(resolve=>{finish=resolve})}
  Object.assign(window.api,{settings:{getAll:read},themes:{list:read,getConfig:read}})
  useSettingsStore.getState().setUserId('a')
  const pending=kind==='settings'?useSettingsStore.getState().hydrateSettings():kind==='themes'?useSettingsStore.getState().hydrateThemes():useSettingsStore.getState().getThemeConfig('shared')
  await started
  generation++;useAuthStore.setState({currentUser:{id:'b'} as never})
  useSettingsStore.setState({userId:'b',settings:{api_key:'B key'},themes:{},error:null})
  finish(kind==='settings'?[{key:'api_key',value:'A key'}]:[{id:'private-a',name:'Private A'}])
  const value=await pending
  if(kind==='config')expect(value).toBeNull()
  expect(useSettingsStore.getState().settings).toEqual({api_key:'B key'})
  expect(useSettingsStore.getState().themes).toEqual({})
  expect(useSettingsStore.getState().error).toBeNull()
})

it.each([
  {namespace:'settings',method:'set',run:()=>useSettingsStore.getState().setSetting('theme_id','a-theme')},
  {namespace:'settings',method:'setMultiple',run:()=>useSettingsStore.getState().setMultipleSettings([{key:'theme_id',value:'a-theme'}])},
  {namespace:'settings',method:'delete',run:()=>useSettingsStore.getState().deleteSetting('theme_id')},
  {namespace:'themes',method:'create',run:()=>useSettingsStore.getState().createTheme({id:'shared',name:'Private A',mode:'dark',config:'{}'})},
  {namespace:'themes',method:'update',run:()=>useSettingsStore.getState().updateTheme('shared',{name:'Private A'})},
  {namespace:'themes',method:'delete',run:()=>useSettingsStore.getState().deleteTheme('shared')}
])('fences late $namespace.$method replies and every sync continuation',async({namespace,method,run})=>{
  let finish!:(value:unknown)=>void
  let entered!:()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  const get=vi.fn().mockResolvedValue(null),list=vi.fn().mockResolvedValue([])
  Object.assign(window.api,{settings:{get},themes:{list},[namespace]:{get,list,[method]:()=>{entered();return new Promise(resolve=>{finish=resolve})}}})
  useSettingsStore.getState().setUserId('a')
  const pending=run()
  const cancelled=expect(pending).rejects.toThrow(/Sync account or database changed/)
  await started
  generation++
  useAuthStore.setState({currentUser:{id:'b'} as never})
  useSettingsStore.setState({userId:'b',settings:{theme_id:'b-theme'},themes:{shared:{id:'shared',name:'Private B'} as never}})
  finish(method==='delete'?true:{id:'shared',name:'Private A',owner_id:'a'})
  await cancelled;await Promise.resolve()
  expect(useSettingsStore.getState().settings).toEqual({theme_id:'b-theme'})
  expect(useSettingsStore.getState().themes.shared.name).toBe('Private B')
  expect(useSettingsStore.getState().error).toBeNull()
  expect(get).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled()
  for(const publish of Object.values(personalSync))expect(publish).not.toHaveBeenCalled()
})

it('preserves current-account settings/theme mutation and refresh behavior',async()=>{
  const settings=new Map<string,string|null>()
  const themes=new Map<string,unknown>()
  Object.assign(window.api,{
    settings:{getAll:async()=>[...settings].map(([key,value])=>({key,value})),get:async(_u:string,key:string)=>settings.get(key)??null,
      set:async(_u:string,key:string,value:string|null)=>{settings.set(key,value)},setMultiple:async(_u:string,values:Array<{key:string;value:string|null}>)=>{for(const row of values)settings.set(row.key,row.value)},delete:async(_u:string,key:string)=>settings.delete(key)},
    themes:{list:async()=>[...themes.values()],create:async(input:Record<string,unknown>)=>{themes.set(String(input.id),input);return input},update:async(id:string,input:Record<string,unknown>)=>{const result={...themes.get(id) as object,...input};themes.set(id,result);return result},delete:async(id:string)=>themes.delete(id),getConfig:async()=>({bg:'#000'})}
  })
  const store=useSettingsStore.getState();store.setUserId('a')
  await store.setSetting('theme_id','custom')
  await store.setMultipleSettings([{key:'ordinary',value:'normal'}])
  await store.createTheme({id:'custom',name:'Custom',mode:'dark',config:'{}'})
  await store.updateTheme('custom',{name:'Updated'})
  await store.hydrateSettings();await store.hydrateThemes()
  expect(useSettingsStore.getState().themes.custom.name).toBe('Updated')
  expect(useSettingsStore.getState().currentThemeId).toBe('custom')
  expect(await store.getThemeConfig('custom')).toEqual({bg:'#000'})
  await store.deleteSetting('ordinary');await store.deleteTheme('custom')
  expect(useSettingsStore.getState().settings.ordinary).toBeUndefined()
  expect(useSettingsStore.getState().themes).toEqual({})
})

it('rejects stale attachment additions on a database-only replacement',async()=>{
  const origin=hydrationContext()
  generation++
  await useAttachmentStore.getState().addAttachment({id:'old-file',task_id:'shared'} as never,origin)
  expect(useAttachmentStore.getState().attachments).toEqual({})
  await useAttachmentStore.getState().addAttachment({id:'current-file',task_id:'shared'} as never,hydrationContext())
  expect(Object.keys(useAttachmentStore.getState().attachments)).toEqual(['current-file'])
})

it('stops database operations at the captured lifecycle boundary and resumes ordinary operations with a fresh context',async()=>{
  let active=true
  const write=vi.fn().mockResolvedValue(undefined)
  Object.assign(window.api,{settings:{set:write}})
  const origin=captureSyncProducer(()=>active)
  active=false
  await expect(origin.api.settings.set('a','ordinary','value')).rejects.toThrow('Sync paused')
  expect(await origin.isCurrent()).toBe(false)
  expect(write).not.toHaveBeenCalled()
  active=true
  const fresh=captureSyncProducer(()=>active)
  await fresh.api.settings.set('a','ordinary','value')
  expect(write).toHaveBeenCalledOnce()
})
