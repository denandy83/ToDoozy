import type { PGlite } from '@electric-sql/pglite'
import { makeLabelAuthorizationDatabase } from '../../../scripts/label-authorization-fixture'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const migration = readFileSync(new URL('../../migrations/20261031102321_label_junction_authorization.sql', import.meta.url), 'utf8')
let db: PGlite
beforeEach(async () => {
  db = await makeLabelAuthorizationDatabase()
})
afterEach(async () => { await db.close() })
async function as<T>(user: number | null, action: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [user ? id(user) : '', role])
  await db.exec(`SET ROLE ${role}`)
  try { return await action() } finally { await db.exec('RESET ROLE') }
}
const visible = (label: number) => as(1, () => db.query('SELECT id,name,color FROM user_labels WHERE id=$1', [id(label)]))
it('reproduces both known-ID disclosures then denies their creation without granting label visibility', async () => {
  for (const [table, target, label] of [['project_labels',10,80],['task_labels',20,81]] as const) {
    expect((await visible(label)).rows).toEqual([])
    const key = table === 'project_labels' ? 'project_id' : 'task_id'
    await as(1, () => db.query(`INSERT INTO ${table}(${key},label_id) VALUES($1,$2)`, [id(target),id(label)]))
    expect((await visible(label)).rows).toHaveLength(1)
    await db.query(`DELETE FROM ${table} WHERE ${key}=$1 AND label_id=$2`, [id(target),id(label)])
  }
  await db.exec(migration); await db.exec(migration)
  expect((await as(1, () => db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'))).rows).toEqual([{rolsuper:false,rolbypassrls:false}])
  await expect(as(1, () => db.query('SELECT private.authorize_label_junction()'))).rejects.toThrow(/permission denied/)
  for (const [table, target, label] of [['project_labels',10,80],['task_labels',20,81]] as const) {
    const key = table === 'project_labels' ? 'project_id' : 'task_id'
    await expect(as(1, () => db.query(`INSERT INTO ${table}(${key},label_id) VALUES($1,$2)`, [id(target),id(label)]))).rejects.toThrow(/not authorized/)
    expect((await visible(label)).rows).toEqual([])
  }
},15000)
it('preserves owned and same-project foreign label upserts, soft remove/re-add and member assignments', async () => {
  await db.exec(migration)
  for (const user of [1,3]) {
    await as(user, () => db.query('INSERT INTO project_labels(project_id,label_id) VALUES($1,$2) ON CONFLICT(project_id,label_id) DO UPDATE SET deleted_at=null RETURNING label_id', [id(10),id(91)]))
    expect((await as(user, () => db.query('INSERT INTO task_labels(task_id,label_id) VALUES($1,$2) ON CONFLICT(task_id,label_id) DO UPDATE SET label_id=excluded.label_id RETURNING label_id', [id(20),id(91)]))).rows).toEqual([{label_id:id(91)}])
    await as(user, () => db.query('UPDATE project_labels SET deleted_at=now() WHERE project_id=$1 AND label_id=$2', [id(10),id(91)]))
    await as(user, () => db.query('INSERT INTO project_labels(project_id,label_id) VALUES($1,$2) ON CONFLICT(project_id,label_id) DO UPDATE SET deleted_at=null', [id(10),id(91)]))
  }
  await as(1, () => db.query('INSERT INTO project_labels(project_id,label_id) VALUES($1,$2)', [id(12),id(90)]))
  await as(1, () => db.query('INSERT INTO task_labels(task_id,label_id) VALUES($1,$2)', [id(22),id(90)]))
  await as(1, () => db.query('UPDATE user_labels SET deleted_at=now() WHERE id=$1', [id(90)]))
  await as(1, () => db.query('INSERT INTO project_labels(project_id,label_id,deleted_at) VALUES($1,$2,now()) ON CONFLICT(project_id,label_id) DO UPDATE SET deleted_at=excluded.deleted_at RETURNING label_id', [id(12),id(90)]))
  expect((await visible(80)).rows).toEqual([])
},15000)
it('denies foreign label and target primary-key retargeting, outsiders and anonymous writes', async () => {
  await db.exec(migration)
  await as(1, () => db.query('INSERT INTO task_labels(task_id,label_id) VALUES($1,$2)', [id(20),id(91)]))
  for (const sql of [
    `UPDATE project_labels SET label_id='${id(80)}' WHERE project_id='${id(10)}' AND label_id='${id(91)}'`,
    `UPDATE project_labels SET project_id='${id(12)}' WHERE project_id='${id(10)}' AND label_id='${id(91)}'`,
    `UPDATE task_labels SET label_id='${id(81)}' WHERE task_id='${id(20)}' AND label_id='${id(91)}'`,
    `UPDATE task_labels SET task_id='${id(22)}' WHERE task_id='${id(20)}' AND label_id='${id(91)}'`
  ]) await expect(as(1, () => db.exec(sql))).rejects.toThrow(/not authorized/)
  await expect(as(3, () => db.query('INSERT INTO project_labels(project_id,label_id) VALUES($1,$2)', [id(12),id(91)]))).rejects.toThrow()
  await expect(as(null, () => db.query('INSERT INTO task_labels(task_id,label_id) VALUES($1,$2)', [id(20),id(90)]), 'anon')).rejects.toThrow()
  expect((await visible(80)).rows).toEqual([]); expect((await visible(81)).rows).toEqual([])
  expect((await db.query('SELECT name,color,user_id FROM user_labels WHERE id=$1', [id(80)])).rows).toEqual([{name:'PRIVATE A',color:'#123456',user_id:id(2)}])
},15000)
