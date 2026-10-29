import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'
import { repairBuiltinThemes } from './themeRepair'
import { withTransaction } from './transaction'
import { ThemeRepository } from '../repositories/ThemeRepository'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { BUILTIN_THEMES, builtinThemeId, canSyncTheme } from '../../shared/themeCatalog'
import type { Theme } from '../../shared/types'

const databases: DatabaseSync[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  for (const migration of migrations.slice(0, 30)) migration(db)
  return db
}
function row(id: string, overrides: Partial<Theme> = {}): Theme {
  return { id, name: 'Standard Dark', mode: 'dark', is_builtin: 0, owner_id: 'user-1',
    config: JSON.stringify({ ...BUILTIN_THEMES[0].config, bg: '#e7b7c8' }),
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', deleted_at: null, ...overrides }
}
function insert(db: DatabaseSync, theme: Theme): void {
  db.prepare('INSERT INTO themes (id,name,mode,config,is_builtin,owner_id,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(theme.id, theme.name, theme.mode, theme.config, theme.is_builtin, theme.owner_id, theme.created_at, theme.updated_at, theme.deleted_at)
}

describe('preset duplicate repair', () => {
  it.each(BUILTIN_THEMES)('classifies $name by legacy or builtin provenance across migration and replay', (preset) => {
    const db = database()
    const repo = new ThemeRepository(db)
    const settings = new SettingsRepository(db)
    const legacy = !preset.name.startsWith('Soft ')
    const candidate = row('candidate', { name: preset.name, mode: preset.mode, config: ' {"bg":"#aBcDEF","custom":true} ' })
    insert(db, candidate)
    settings.set('user-1', 'theme_id', candidate.id)
    const selection = settings.findRaw('user-1', 'theme_id')
    repairBuiltinThemes(db)
    if (legacy) {
      expect(repo.findById(candidate.id)?.deleted_at).not.toBeNull()
      expect(settings.get('user-1', 'theme_id')).toBe(builtinThemeId(preset.name))
    } else {
      expect(repo.findById(candidate.id)).toEqual(candidate)
      expect(settings.findRaw('user-1', 'theme_id')).toEqual(selection)
    }
    const replay = { ...candidate, updated_at: '2090-01-01T00:00:00.000Z' }
    const result = repo.applyRemote(replay)
    expect(canSyncTheme(candidate)).toBe(!legacy)
    expect(canSyncTheme(result)).toBe(true)
    if (legacy) expect(Date.parse(result.deleted_at!)).toBeGreaterThan(Date.parse(replay.updated_at))
    else {
      expect(result).toEqual(replay)
      settings.applyRemote({ user_id: 'user-1', key: 'theme_id', value: candidate.id, updated_at: replay.updated_at, deleted_at: null })
      expect(settings.get('user-1', 'theme_id')).toBe(candidate.id)
    }
    const tombstone = { ...replay, deleted_at: '2090-01-02T00:00:00.000Z', updated_at: '2090-01-02T00:00:00.000Z' }
    expect(repo.applyRemote(tombstone)).toEqual(tombstone)
  })

  it('keeps archived builtin provenance for Soft aliases through replay and purge', () => {
    const db = database()
    const repo = new ThemeRepository(db)
    const settings = new SettingsRepository(db)
    const alias = row('soft-builtin-copy', { name: 'Soft Sage Dark', is_builtin: 1, owner_id: null })
    insert(db, alias)
    settings.set('user-1', 'theme_id', alias.id)
    repairBuiltinThemes(db)
    const remote = { ...alias, is_builtin: 0, owner_id: 'user-1', updated_at: '2090-01-01T00:00:00.000Z' }
    for (const stamp of ['2090-01-01T00:00:00.000Z', '2091-01-01T00:00:00.000Z']) {
      const retired = repo.applyRemote({ ...remote, updated_at: stamp })
      expect(Date.parse(retired.deleted_at!)).toBeGreaterThan(Date.parse(stamp))
      expect(canSyncTheme(retired)).toBe(true)
      repo.hardDelete(alias.id)
      settings.applyRemote({ user_id: 'user-1', key: 'theme_id', value: alias.id, updated_at: stamp, deleted_at: null })
      expect(settings.get('user-1', 'theme_id')).toBe(builtinThemeId(alias.name))
    }
  })

  it('leaves one preset per name/mode, preserves selected builtin colors and genuine custom rows, and archives copies', () => {
    const db = database()
    const repo = new ThemeRepository(db)
    const settings = new SettingsRepository(db)
    const selected = row('old-install', { is_builtin: 1, owner_id: null, config: JSON.stringify({ ...BUILTIN_THEMES[0].config, accent: '#b6d9c7' }) })
    insert(db, selected)
    const a = row('copy-a')
    const b = row('copy-b', { owner_id: 'user-2', config: '{"bg":"#ff0000"}' })
    const custom = row('aviobook', { name: 'Aviobook Dark' })
    for (const theme of [a, b, custom]) insert(db, theme)
    settings.set('user-1', 'theme_id', selected.id)
    settings.set('user-2', 'theme_id', b.id)
    const beforeCustom = repo.findById(custom.id)
    withTransaction(db, () => repairBuiltinThemes(db))
    const presets = repo.list().filter((theme) => theme.is_builtin)
    expect(presets).toHaveLength(18)
    expect(new Set(presets.map((theme) => theme.name + theme.mode)).size).toBe(18)
    expect(repo.findById(builtinThemeId('Standard Dark'))!.config).toBe(selected.config)
    expect(repo.findById(custom.id)).toEqual(beforeCustom)
    expect(settings.get('user-1', 'theme_id')).toBe(builtinThemeId('Standard Dark'))
    expect(settings.get('user-2', 'theme_id')).toBe(builtinThemeId('Standard Dark'))
    for (const alias of [selected, a, b]) {
      expect(repo.findById(alias.id)!.deleted_at).not.toBeNull()
      const archive = db.prepare('SELECT snapshot FROM theme_duplicate_archive WHERE id=?').get(alias.id) as { snapshot: string }
      expect(JSON.parse(archive.snapshot).theme).toEqual(alias)
    }
    const first = db.prepare('SELECT * FROM themes ORDER BY id').all()
    repairBuiltinThemes(db)
    expect(db.prepare('SELECT * FROM themes ORDER BY id').all()).toEqual(first)
  })

  it('preserves an active named custom theme and produces the same preset IDs in separate installs', () => {
    const db = database()
    const custom = row('custom', { name: 'Aviobook Dark' })
    insert(db, custom)
    new SettingsRepository(db).set('user-1', 'theme_id', custom.id)
    repairBuiltinThemes(db)
    expect(new SettingsRepository(db).get('user-1', 'theme_id')).toBe(custom.id)
    const second = database()
    repairBuiltinThemes(second)
    expect(new ThemeRepository(db).list().filter((theme) => theme.is_builtin).map((theme) => theme.id).sort())
      .toEqual(new ThemeRepository(second).list().filter((theme) => theme.is_builtin).map((theme) => theme.id).sort())
  })

  it('retirements outrank future-clock old-client replays without moving the clock on every pull', () => {
    const db = database()
    repairBuiltinThemes(db)
    const repo = new ThemeRepository(db)
    const remote = row('remote-copy', { updated_at: '2090-01-01T00:00:00.000Z' })
    const first = repo.applyRemote(remote)
    expect(first.deleted_at).not.toBeNull()
    expect(Date.parse(first.updated_at)).toBeGreaterThan(Date.parse(remote.updated_at))
    expect(repo.applyRemote(remote)).toEqual(first)
    const revived = { ...remote, updated_at: '2090-01-02T00:00:00.000Z' }
    const second = repo.applyRemote(revived)
    expect(second.deleted_at).not.toBeNull()
    expect(Date.parse(second.updated_at)).toBeGreaterThan(Date.parse(revived.updated_at))
    expect(repo.list('user-1').filter((theme) => theme.name === 'Standard Dark')).toHaveLength(1)
    expect(canSyncTheme(second)).toBe(true)
  })

  it('turns a replayed original builtin install ID into an owner-scoped cleanup tombstone', () => {
    const db = database()
    const old = row('old-builtin', { is_builtin: 1, owner_id: null })
    insert(db, old)
    repairBuiltinThemes(db)
    const repo = new ThemeRepository(db)
    const retired = repo.applyRemote({ ...old, is_builtin: 0, owner_id: 'user-1' })
    expect(retired.is_builtin).toBe(0)
    expect(repo.findAllByOwner('user-1', { includeTombstones: true })).toContainEqual(retired)
    expect(retired.deleted_at).not.toBeNull()
  })

  it('normalizes a selection arriving before its unknown alias, and resolves it again after alias purge', () => {
    const db = database()
    repairBuiltinThemes(db)
    const settings = new SettingsRepository(db)
    const repo = new ThemeRepository(db)
    const alias = row('late-copy')
    settings.applyRemote({ user_id: 'user-1', key: 'theme_id', value: alias.id, updated_at: '2026-10-01T00:00:00Z', deleted_at: null })
    expect(settings.get('user-1', 'theme_id')).toBe(alias.id)
    repo.applyRemote(alias)
    expect(settings.get('user-1', 'theme_id')).toBe(builtinThemeId(alias.name))
    repo.hardDelete(alias.id)
    settings.applyRemote({ user_id: 'user-1', key: 'theme_id', value: alias.id, updated_at: '2091-01-01T00:00:00Z', deleted_at: null })
    expect(settings.get('user-1', 'theme_id')).toBe(builtinThemeId(alias.name))
  })

  it('preserves custom remote values and tombstones rather than deriving sidebar or recreating clocks', () => {
    const db = database()
    repairBuiltinThemes(db)
    const repo = new ThemeRepository(db)
    const remote = row('custom-remote', { name: 'Aviobook Dark', deleted_at: '2026-01-02T00:00:00.000Z' })
    expect(repo.applyRemote(remote)).toEqual(remote)
    expect(repo.list('user-1').some((theme) => theme.id === remote.id)).toBe(false)
  })

  it('rolls the repair back if archiving fails', () => {
    const db = database()
    insert(db, row('copy'))
    db.exec("CREATE TABLE theme_duplicate_archive (id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,archived_at TEXT NOT NULL); CREATE TRIGGER reject_archive BEFORE INSERT ON theme_duplicate_archive BEGIN SELECT RAISE(ABORT,'archive unavailable'); END")
    const before = db.prepare('SELECT * FROM themes ORDER BY id').all()
    expect(() => withTransaction(db, () => repairBuiltinThemes(db))).toThrow('archive unavailable')
    expect(db.prepare('SELECT * FROM themes ORDER BY id').all()).toEqual(before)
  })
})
