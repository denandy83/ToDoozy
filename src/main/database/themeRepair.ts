import type { DatabaseSync } from 'node:sqlite'
import type { Theme } from '../../shared/types'
import { BUILTIN_THEMES, builtinTheme, builtinThemeId } from '../../shared/themeCatalog'

export function retirementStamp(...timestamps: Array<string | null | undefined>): string {
  return new Date(Math.max(Date.now(), ...timestamps.map((stamp) => (Date.parse(stamp ?? '') || 0) + 1))).toISOString()
}

export function archiveTheme(db: DatabaseSync, theme: Theme): void {
  const selections = db.prepare("SELECT * FROM settings WHERE key='theme_id' AND value=?").all(theme.id)
  db.prepare('INSERT OR IGNORE INTO theme_duplicate_archive (id,snapshot,archived_at) VALUES (?,?,?)')
    .run(theme.id, JSON.stringify({ theme, selections }), new Date().toISOString())
}

export function canonicalThemeReference(db: DatabaseSync, id: string | null, userId: string): string | null {
  if (!id) return id
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='theme_duplicate_archive'").get()) return id
  let alias = db.prepare('SELECT * FROM themes WHERE id=?').get(id) as unknown as Theme | undefined
  if (!alias && db.prepare("SELECT 1 FROM sqlite_master WHERE name='theme_duplicate_archive'").get()) {
    const saved = db.prepare('SELECT snapshot FROM theme_duplicate_archive WHERE id=?').get(id) as { snapshot: string } | undefined
    if (saved) { try { alias = JSON.parse(saved.snapshot).theme as Theme } catch { /* Retain unknown references. */ } }
  }
  if (!alias || (!alias.is_builtin && alias.owner_id !== userId) || !builtinTheme(alias.name, alias.mode)) return id
  const canonical = builtinThemeId(alias.name)
  return db.prepare('SELECT 1 FROM themes WHERE id=? AND is_builtin=1 AND deleted_at IS NULL').get(canonical) ? canonical : id
}

export function remapThemeReferences(db: DatabaseSync, alias: Theme, canonical: string): void {
  const settings = db.prepare("SELECT user_id,value,updated_at FROM settings WHERE key='theme_id' AND value=? AND deleted_at IS NULL")
    .all(alias.id) as Array<{ user_id: string; value: string; updated_at: string }>
  for (const setting of settings) {
    if (!alias.is_builtin && alias.owner_id !== setting.user_id) continue
    db.prepare("UPDATE settings SET value=?,updated_at=? WHERE user_id=? AND key='theme_id'")
      .run(canonical, retirementStamp(setting.updated_at), setting.user_id)
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
    for (const row of rows) {
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
