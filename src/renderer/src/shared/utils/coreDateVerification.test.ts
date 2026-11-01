import { afterEach, expect, it, vi } from 'vitest'
import { getNextOccurrence } from '../../../../shared/recurrenceUtils'
import { calendarDateKey, localDateKey } from '../../../../shared/localDate'
import { addDaysPreservingTime, getSnoozePresets } from './snooze'
import { resolveDueDateRange,matchesDueDateFilter } from './dueDateFilter'

const originalZone=process.env.TZ
afterEach(()=>{vi.useRealTimers();if(originalZone===undefined)delete process.env.TZ;else process.env.TZ=originalZone})
it('preserves the implicit monthly day and clamps the end of February',()=>{
  expect(localDateKey(getNextOccurrence('every:1:months',new Date(2026,0,15))!)).toBe('2026-02-15')
  expect(localDateKey(getNextOccurrence('every:1:months',new Date(2026,0,31))!)).toBe('2026-02-28')
})
it('does not skip February when finding its last Monday from January 31',()=>{
  expect(localDateKey(getNextOccurrence('every!:1:months:last:mon',new Date(2026,0,31))!)).toBe('2026-02-23')
})
it('uses the local day around midnight for Today/Tomorrow and relative ranges',()=>{
  process.env.TZ='Europe/Brussels';vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'))
  expect(addDaysPreservingTime('2026-01-16T10:00:00',1)).toBe('2026-01-17T09:00:00.000Z')
  expect(resolveDueDateRange({mode:'relative',fromOffset:0,toOffset:0})).toEqual({from:'2026-01-16',to:'2026-01-16'})
  expect(matchesDueDateFilter('2026-01-16','today',null)).toBe(true)
})

it('recognizes a timestamp on local Today even when its UTC calendar day differs',()=>{
  process.env.TZ='Europe/Brussels';vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'))
  expect(matchesDueDateFilter('2026-01-15T23:00:00.000Z','today',null)).toBe(true)
})

it.each([
  ['Europe/Brussels','2026-01-15T23:30:00Z','2026-01-15T23:00:00Z','2026-01-17',0],
  ['America/Los_Angeles','2026-01-16T07:30:00Z','2026-01-16T07:00:00Z','2026-01-16',23],
  ['Europe/Brussels','2026-03-28T23:30:00Z','2026-03-28T08:15:00Z','2026-03-30',9]
])('preserves parsed local clock time for every snooze preset in %s',(zone,now,due,tomorrow,hour)=>{
  process.env.TZ=zone;vi.useFakeTimers();vi.setSystemTime(new Date(now))
  const expectedStart=new Date(tomorrow+'T12:00:00')
  for(const [index,days] of [1,3,7].entries()) {
    const result=getSnoozePresets(due)[index+1].getDate()
    const expected=new Date(expectedStart);expected.setDate(expected.getDate()+days-1)
    expect(calendarDateKey(result)).toBe(localDateKey(expected))
    expect(new Date(result).getHours()).toBe(hour)
    expect(new Date(result).getMinutes()).toBe(new Date(due).getMinutes())
  }
  expect(addDaysPreservingTime('2026-01-01',1)).toBe(tomorrow)
})
