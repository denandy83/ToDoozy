// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { CalendarView } from './CalendarView'
import { useTaskStore, useProjectStore, useStatusStore } from '../../shared/stores'

vi.mock('../../shared/stores',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../../shared/stores')>()
  const task=(selector?: (state:ReturnType<typeof original.useTaskStore.getState>)=>unknown)=>selector?selector(original.useTaskStore.getState()):original.useTaskStore.getState()
  const project=(selector?: (state:ReturnType<typeof original.useProjectStore.getState>)=>unknown)=>selector?selector(original.useProjectStore.getState()):original.useProjectStore.getState()
  return {...original,useTaskStore:Object.assign(task,original.useTaskStore),useProjectStore:Object.assign(project,original.useProjectStore)}
})
vi.mock('./useCalendar',async(importOriginal)=>{
  const original=await importOriginal<typeof import('./useCalendar')>()
  return {...original,useCalendar:()=>({days:Array.from({length:35},(_,i)=>{
    const date=new Date(2026,0,15+i)
    return {date:original.toYMD(date),dayOfMonth:date.getDate(),isToday:i===1,isCurrentMonth:date.getMonth()===0}
  }),title:'Synthetic calendar',goNext:()=>{},goPrev:()=>{},goToday:()=>{}})}
})
const zone=process.env.TZ
afterEach(()=>{vi.useRealTimers();if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone})
it('groups timestamp tasks, deduplicates My Day, and seeds recurrence on the local date',()=>{
  process.env.TZ='Europe/Brussels';vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-15T23:30:00Z'))
  useProjectStore.setState({projects:{p:{id:'p',name:'Synthetic',is_archived:0} as never}})
  useStatusStore.setState({statuses:{s:{id:'s',name:'Open'} as never}})
  useTaskStore.setState({tasks:{t:{id:'t',project_id:'p',status_id:'s',title:'Local midnight task',due_date:'2026-01-15T23:00:00Z',parent_id:null,is_archived:0,is_template:0,is_in_my_day:1,recurrence_rule:'every:1:months',order_index:0} as never}})
  const container=document.createElement('div')
  container.innerHTML=renderToStaticMarkup(createElement(CalendarView))
  const cells=Array.from(container.querySelectorAll('span')).filter(span=>['15','16'].includes(span.textContent??'')).map(span=>span.parentElement!.parentElement!)
  const originalDay=cells.find(cell=>cell.querySelector('span')?.textContent==='16')!
  expect(originalDay.textContent).toContain('Local midnight task')
  expect(originalDay.textContent?.split('Local midnight task')).toHaveLength(2)
  expect(cells.find(cell=>cell.querySelector('span')?.textContent==='15')?.textContent).not.toContain('Local midnight task')
  const occurrences=cells.filter(cell=>cell.textContent?.includes('Local midnight task'))
  expect(occurrences).toHaveLength(2)
  expect(occurrences.every(cell=>cell.querySelector('span')?.textContent==='16')).toBe(true)
})
