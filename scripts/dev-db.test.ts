import { expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

it('copies a per-user WAL database consistently, preserving its bytes and retaining five snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'todoozy-dev-db-test-'))
  const source = join(root, 'todoozy-test-user.db')
  const db = new DatabaseSync(source)
  try {
    writeFileSync(join(root, 'todoozy.db'), '')
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE tasks(id TEXT PRIMARY KEY); INSERT INTO tasks VALUES (\'from-wal\')')
    const before = [source, `${source}-wal`].map((path) => readFileSync(path))
    const run = (...args: string[]): string => execFileSync('python3', ['scripts/dev-db.py', ...args], { env: { ...process.env, TODOOZY_DATA_DIR: root }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const snapshot = run('create', 'bugfix')
    const copy = new DatabaseSync(snapshot, { readOnly: true })
    expect(copy.prepare('SELECT id FROM tasks').get()?.id).toBe('from-wal')
    copy.close()
    expect([source, `${source}-wal`].map((path) => readFileSync(path))).toEqual(before)
    for (let i = 0; i < 6; i++) run('create', 'bugfix')
    expect(readdirSync(join(root, 'dev-dbs')).filter((file) => file.endsWith('.db'))).toHaveLength(5)
    expect(run('path', 'bugfix')).toContain('/bugfix-')
  } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
})
