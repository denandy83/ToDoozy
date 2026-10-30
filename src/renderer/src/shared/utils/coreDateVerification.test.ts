import { afterEach, expect, it, vi } from 'vitest'
import { getNextOccurrence } from '../../../../shared/recurrenceUtils'
import { localDateKey } from '../../../../shared/localDate'
import { addDaysPreservingTime } from './snooze'
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
  expect(addDaysPreservingTime('2026-01-16T10:00:00',1)).toBe('2026-01-17T10:00:00')
  expect(resolveDueDateRange({mode:'relative',fromOffset:0,toOffset:0})).toEqual({from:'2026-01-16',to:'2026-01-16'})
  expect(matchesDueDateFilter('2026-01-16','today',null)).toBe(true)
})

it('recognizes a timestamp on local Today even when its UTC calendar day differs',()=>{
  process.env.TZ='Europe/Brussels';vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'))
  expect(matchesDueDateFilter('2026-01-15T23:00:00.000Z','today',null)).toBe(true)
})
