import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { migrations } from '../database/migrations'
import { createRepositories } from './index'
import { calendarDateKey, localDateKey } from '../../shared/localDate'
import { getSnoozePresets } from '../../renderer/src/shared/utils/snooze'

let db: DatabaseSync
let repo: ReturnType<typeof createRepositories>
let originalZone: string | undefined
beforeEach(() => {
  originalZone = process.env.TZ
  process.env.TZ = 'Europe/Brussels'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-16T12:00:00+01:00'))
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  repo = createRepositories(db, 'u')
  for (const id of ['u', 'other']) repo.users.create({ id, email: `${id}@example.invalid`, display_name: null, avatar_url: null })
  repo.projects.create({ id: 'personal', owner_id: 'u', name: 'Personal pending upload' })
  repo.projects.create({ id: 'shared', owner_id: 'other', name: 'Shared' })
  repo.projects.addMember('shared', 'other', 'owner')
  repo.projects.addMember('shared', 'u', 'member')
  for (const id of ['personal', 'shared']) repo.statuses.create({ id: `open-${id}`, project_id: id, name: 'Open', is_default: 1 })
})
afterEach(() => {
  db.close()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})
function task(id: string, project = 'personal', due = '2026-01-16T12:10', owner = 'u'): void {
  repo.tasks.create({ id, project_id: project, owner_id: owner, status_id: `open-${project}`, title: id, due_date: due, is_in_my_day: 1 })
}
const ids = (tasks: Array<{ id: string }>): string[] => tasks.map(row => row.id).sort()

it('excludes withdrawn project rows from native reads without changing retained data or clocks', () => {
  task('own')
  task('mine', 'shared')
  task('theirs', 'shared', undefined, 'other')
  const retained = repo.tasks.findAllByProject('shared')
  repo.projects.removeMember('shared', 'u')
  expect(ids(repo.tasks.findMyDay('u'))).toEqual(['own'])
  expect(ids(repo.tasks.findWithUpcomingDueTimes(15))).toEqual(['own'])
  expect(ids(repo.tasks.search({}))).toEqual(['own'])
  expect(repo.savedViews.countMatchingTasks('{}', 'u')).toBe(1)
  expect(repo.tasks.findByProjectId('shared')).toEqual([])
  expect(repo.tasks.findByStatusId('open-shared')).toEqual([])
  repo.tasks.update('mine', { is_in_my_day: 0 })
  const beforeAutoAdd = repo.tasks.findById('mine')!
  expect(repo.tasks.autoAddMyDayTasks('u', 'due_today')).toEqual([])
  expect(repo.tasks.autoAddMyDayTasks('u', 'due_today_or_overdue')).toEqual([])
  expect(repo.tasks.findById('mine')).toEqual(beforeAutoAdd)
  expect(repo.tasks.findAllByProject('shared').map(row => row.deleted_at)).toEqual([null, null])
  expect(repo.tasks.findById('theirs')).toEqual(retained.find(row => row.id === 'theirs'))
  repo.projects.create({ id: 'copy', owner_id: 'u', name: 'Explicit Keep Copy' })
  repo.statuses.create({ id: 'open-copy', project_id: 'copy', name: 'Open' })
  for (const original of repo.tasks.findAllByProject('shared')) repo.tasks.create({ ...original, id: `${original.id}-copy`, project_id: 'copy', owner_id: 'u', status_id: 'open-copy' })
  expect(ids(repo.tasks.search({ project_id: 'copy' }))).toEqual(['mine-copy', 'theirs-copy'])
  repo.projects.addMember('shared', 'u', 'member')
  expect(ids(repo.tasks.findByProjectId('shared'))).toEqual(['mine', 'theirs'])
  expect(ids(repo.tasks.findWithUpcomingDueTimes(15))).toEqual(['mine', 'mine-copy', 'own', 'theirs', 'theirs-copy'])
})

it.each(['2026-01-16T12:00:00+01:00', '2026-03-29T12:00:00+02:00', '2026-10-25T12:00:00+01:00'])(
  'keeps native day queries aligned with renderer civil/local/instant semantics on %s', now => {
    vi.setSystemTime(new Date(now))
    repo.projects.addMember('personal', 'u', 'owner')
    const today = localDateKey()
    const previous = new Date(); previous.setDate(previous.getDate() - 1)
    const before = localDateKey(previous)
    const dueDates = [today, `${today}T23:30`, `${today}T00:30`, `${today}T00:30:00Z`, `${today}T23:30:00Z`, `${today}T00:30:00+05:00`, `${today}T23:30:00-05:00`, `${before}T23:30`, `${before}T23:30:00-05:00`, `${before}T23:30:00Z`]
    dueDates.forEach((due, i) => { task(`date-${i}`, 'personal', due); repo.tasks.update(`date-${i}`, { is_in_my_day: 0 }) })
    const expected = (predicate: (day: string) => boolean): string[] => dueDates.flatMap((due, i) => predicate(calendarDateKey(due)) ? [`date-${i}`] : []).sort()
    expect(repo.savedViews.countMatchingTasks('{"dueDatePreset":"today"}', 'u')).toBe(expected(day => day === today).length)
    expect(repo.savedViews.countMatchingTasks('{"dueDatePreset":"overdue"}', 'u')).toBe(expected(day => day < today).length)
    expect(ids(repo.tasks.getStatsTaskList('u', 'overdue', null))).toEqual(expected(day => day < today))
    expect(repo.tasks.getTaskSummaryStats('u', null).overdue).toBe(expected(day => day < today).length)
    expect(repo.tasks.autoAddMyDayTasks('u', 'due_today').sort()).toEqual(expected(day => day === today))
    for (let i = 0; i < dueDates.length; i++) repo.tasks.update(`date-${i}`, { is_in_my_day: 0 })
    expect(repo.tasks.autoAddMyDayTasks('u', 'due_today_or_overdue').sort()).toEqual(expected(day => day <= today))
  }
)

it.each(['2026-01-16T09:50:00+01:00', '2026-03-29T01:50:00+01:00', '2026-10-25T02:50:00+02:00', '2026-10-25T23:50:00+01:00'])(
  'compares actual reminder instants across local, zoned and DST timestamps at %s', now => {
    vi.setSystemTime(new Date(now))
    const due = new Date(Date.now() + 10 * 60000)
    const day = localDateKey(due)
    const time = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
    const zoned = (offset: number): string => `${new Date(due.getTime() + offset * 60000).toISOString().slice(0, -1)}${offset >= 0 ? '+' : '-'}${String(Math.abs(offset) / 60).padStart(2, '0')}:00`
    const dates = [`${day}T${time}`, due.toISOString(), zoned(180), zoned(-300), day, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 20 * 60000).toISOString()]
    dates.forEach((value, i) => task(`reminder-${i}`, 'personal', value))
    const expected = dates.flatMap((value, i) => value.includes('T') && Date.parse(value) >= Date.now() && Date.parse(value) <= Date.now() + 15 * 60000 ? [`reminder-${i}`] : [])
    expect(ids(repo.tasks.findWithUpcomingDueTimes(15))).toEqual(expected.sort())
  }
)

it.each([1, 2, 3])('finds snoozed 10:00 reminders for helper-backed preset %s', preset => {
  vi.setSystemTime(new Date('2026-01-15T09:50:00+01:00'))
  const due = getSnoozePresets('2026-01-15T10:00')[preset].getDate()
  task('snoozed', 'personal', due)
  vi.setSystemTime(new Date(Date.parse(due) - 10 * 60000))
  expect(ids(repo.tasks.findWithUpcomingDueTimes(15))).toEqual(['snoozed'])
})
