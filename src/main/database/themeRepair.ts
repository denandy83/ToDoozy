import type { DatabaseSync } from 'node:sqlite'
import type { Theme, Setting } from '../../shared/types'
import { BUILTIN_THEMES, builtinThemeId, presetForTheme } from '../../shared/themeCatalog'

export function retirementStamp(...timestamps: Array<string | null | undefined>): string {
  return new Date(Math.max(Date.now(), ...timestamps.map((stamp) => (Date.parse(stamp ?? '') || 0) + 1))).toISOString()
}

export function archiveTheme(db: DatabaseSync, theme: Theme): void {
  const selections = db.prepare("SELECT * FROM settings WHERE key='theme_id' AND value=?").all(theme.id)
  db.prepare('INSERT OR IGNORE INTO theme_duplicate_archive (id,snapshot,archived_at) VALUES (?,?,?)')
    .run(theme.id, JSON.stringify({ theme, selections }), new Date().toISOString())
}

function archivedRecord(db: DatabaseSync, id: string): { theme: Theme; selections: Setting[] } | undefined {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='theme_duplicate_archive'").get()) return undefined
  const saved = db.prepare('SELECT snapshot FROM theme_duplicate_archive WHERE id=?').get(id) as { snapshot: string } | undefined
  if (saved) { try { return JSON.parse(saved.snapshot) } catch { return undefined } }
  return undefined
}

export function archivedTheme(db: DatabaseSync, id: string): Theme | undefined {
  return archivedRecord(db, id)?.theme
}

export function presetForStoredTheme(db: DatabaseSync, theme: Theme): ReturnType<typeof presetForTheme> {
  const archived = archivedTheme(db, theme.id)
  return presetForTheme(theme) ?? (archived && theme.name === archived.name && theme.mode === archived.mode ? presetForTheme(archived) : undefined)
}

export function restoreThemeReferences(db: DatabaseSync, theme: Theme): void {
  const record = archivedRecord(db, theme.id)
  if (!record) return
  const preset = presetForTheme(record.theme)
  if (!preset) return
  for (const original of record.selections) {
    if (original.deleted_at || theme.owner_id !== original.user_id || (!record.theme.is_builtin && record.theme.owner_id !== original.user_id)) continue
    const current = db.prepare("SELECT * FROM settings WHERE user_id=? AND key='theme_id'").get(original.user_id) as unknown as Setting | undefined
    if (!current || current.deleted_at || current.value !== builtinThemeId(preset.name) || Date.parse(current.updated_at) !== Date.parse(original.updated_at)) continue
    db.prepare("UPDATE settings SET value=? WHERE user_id=? AND key='theme_id'").run(theme.id, original.user_id)
  }
}

export function canRewriteThemeReference(db: DatabaseSync, userId: string, from: string | null, to: string | null, updatedAt: string): boolean {
  if (from === to) return false
  if (canonicalThemeReference(db, from, userId) === to) return true
  if (!to) return false
  const record = archivedRecord(db, to)
  const current = db.prepare('SELECT * FROM themes WHERE id=? AND deleted_at IS NULL').get(to) as unknown as Theme | undefined
  const preset = record && presetForTheme(record.theme)
  if (!record || !preset || !current || current.owner_id !== userId || presetForStoredTheme(db, current)) return false
  return from === builtinThemeId(preset.name) && record.selections.some((setting) => setting.user_id === userId && !setting.deleted_at && Date.parse(setting.updated_at) === Date.parse(updatedAt))
}

export function canonicalThemeReference(db: DatabaseSync, id: string | null, userId: string): string | null {
  if (!id) return id
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='theme_duplicate_archive'").get()) return id
  const alias = (db.prepare('SELECT * FROM themes WHERE id=?').get(id) as unknown as Theme | undefined) ?? archivedTheme(db, id)
  if (!alias || (!alias.is_builtin && alias.owner_id !== userId)) return id
  const preset = presetForStoredTheme(db, alias)
  if (!preset) return id
  const canonical = builtinThemeId(preset.name)
  return db.prepare('SELECT 1 FROM themes WHERE id=? AND is_builtin=1 AND deleted_at IS NULL').get(canonical) ? canonical : id
}

export function normalizeThemeSelection(db: DatabaseSync, setting: Setting): string | null {
  const value = canonicalThemeReference(db, setting.value, setting.user_id)
  if (value === setting.value || !setting.value || setting.deleted_at) return value
  const record = archivedRecord(db, setting.value)
  if (record && !record.selections.some((row) => row.user_id === setting.user_id && Date.parse(row.updated_at) === Date.parse(setting.updated_at) && row.value === setting.value && !row.deleted_at)) {
    record.selections.push(setting)
    db.prepare('UPDATE theme_duplicate_archive SET snapshot=? WHERE id=?').run(JSON.stringify(record), setting.value)
  }
  return value
}

export function themeReferenceSource(db: DatabaseSync, userId: string, value: string | null, updatedAt: string): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='theme_duplicate_archive'").get()) return value
  const sources = new Set<string>()
  const rows = db.prepare('SELECT id FROM theme_duplicate_archive').all() as Array<{ id: string }>
  for (const row of rows) {
    const record = archivedRecord(db, row.id)
    const preset = record && presetForTheme(record.theme)
    if (!record || !preset || builtinThemeId(preset.name) !== value) continue
    if (record.selections.some((setting) => setting.user_id === userId && !setting.deleted_at && Date.parse(setting.updated_at) === Date.parse(updatedAt))) sources.add(row.id)
  }
  return sources.size === 1 ? [...sources][0] : value
}

export function remapThemeReferences(db: DatabaseSync, alias: Theme, canonical: string): void {
  if (!presetForStoredTheme(db, alias)) return
  const settings = db.prepare("SELECT * FROM settings WHERE key='theme_id' AND value=? AND deleted_at IS NULL")
    .all(alias.id) as unknown as Setting[]
  for (const setting of settings) {
    if (!alias.is_builtin && alias.owner_id !== setting.user_id) continue
    normalizeThemeSelection(db, setting)
    db.prepare("UPDATE settings SET value=? WHERE user_id=? AND key='theme_id'")
      .run(canonical, setting.user_id)
  }
}

/** Caller owns the migration transaction. Originals remain recoverable after the normal tombstone purge. */
export function repairBuiltinThemes(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS theme_duplicate_archive (id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,archived_at TEXT NOT NULL)')
  for (const preset of BUILTIN_THEMES) {
    const canonical = builtinThemeId(preset.name)
    const rows = db.prepare('SELECT * FROM themes WHERE name=? AND mode=? ORDER BY created_at,id')
      .all(preset.name, preset.mode) as unknown as Theme[]
    const stable = rows.find((row) => row.id === canonical)
    if (stable && !stable.is_builtin) throw new Error('A custom theme occupies a reserved preset identity')
    const aliases = rows.filter((row) => presetForStoredTheme(db, row))
    // Preserve existing builtin edits, never promote a user's bug-copy colors into a shared preset.
    const selections = db.prepare("SELECT value FROM settings WHERE key='theme_id' AND deleted_at IS NULL ORDER BY CASE WHEN user_id='' THEN 1 ELSE 0 END,updated_at DESC")
      .all() as Array<{ value: string }>
    const selected = selections.map(({ value }) => rows.find((row) => row.id === value && row.is_builtin && !row.deleted_at)).find(Boolean)
    const source = selected ?? rows.find((row) => row.id === canonical && row.is_builtin && !row.deleted_at)
      ?? rows.find((row) => row.is_builtin && !row.deleted_at)
    if (!stable || stable.deleted_at) {
      db.prepare(`INSERT INTO themes (id,name,mode,config,is_builtin,owner_id,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,1,NULL,?,?,NULL) ON CONFLICT(id) DO UPDATE SET deleted_at=NULL`)
        .run(canonical, preset.name, preset.mode, source?.config ?? JSON.stringify(preset.config), source?.created_at ?? new Date().toISOString(), source?.updated_at ?? new Date().toISOString())
    }
    if (source && source.id !== canonical && stable && !stable.deleted_at) {
      archiveTheme(db, stable)
      db.prepare('UPDATE themes SET config=?,updated_at=? WHERE id=?').run(source.config, source.updated_at, canonical)
    }
    for (const row of aliases) {
      if (row.id === canonical) continue
      archiveTheme(db, row)
      if (!row.deleted_at) {
        const stamp = retirementStamp(row.updated_at)
        db.prepare('UPDATE themes SET deleted_at=?,updated_at=? WHERE id=?').run(stamp, stamp, row.id)
      }
      remapThemeReferences(db, row, canonical)
    }
  }
}
