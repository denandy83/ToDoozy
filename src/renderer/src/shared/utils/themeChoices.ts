import type { Theme } from '../../../../shared/types'
import { stripModeSuffix } from './themeIO'
import { BUILTIN_THEMES } from '../../../../shared/themeCatalog'

const nameKey = (name: string): string => name.trim().toLowerCase()
const familyKey = (theme: Theme): string => nameKey(stripModeSuffix(theme.name))

export function groupThemeChoices(themes: readonly Theme[]): Array<{
  label: string
  options: Array<{ id: string; label: string }>
}> {
  const sorted = themes.filter((theme) => !theme.deleted_at).sort((a, b) =>
    a.name.localeCompare(b.name) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  )
  return [true, false].map((builtin) => {
    const members = sorted.filter((theme) => Boolean(theme.is_builtin) === builtin)
    if (builtin) return { label: 'Built-in themes', options: members.map((theme) => ({ id: theme.id, label: theme.name })) }
    const counts = new Map<string, number>()
    const positions = new Map<string, number>()
    for (const theme of members) counts.set(nameKey(theme.name), (counts.get(nameKey(theme.name)) ?? 0) + 1)
    return {
      label: 'My themes',
      options: members.map((theme) => {
        const key = nameKey(theme.name)
        const position = (positions.get(key) ?? 0) + 1
        positions.set(key, position)
        const count = counts.get(key)!
        return {
          id: theme.id,
          label: `${theme.name} (Custom${count > 1 ? ` ${position}` : ''})`
        }
      })
    }
  }).filter((group) => group.options.length > 0)
}

// Legacy synced themes can share a family name. Never guess which other row
// should be edited, exported, renamed or deleted alongside the selected row.
export function findThemeCounterpart(theme: Theme | null | undefined, themes: readonly Theme[]): Theme | undefined {
  if (!theme) return undefined
  const family = themes.filter((other) => !other.deleted_at &&
    Boolean(other.is_builtin) === Boolean(theme.is_builtin) && other.owner_id === theme.owner_id &&
    familyKey(other) === familyKey(theme))
  if (family.some((other) => other.id !== theme.id && other.mode === theme.mode)) return undefined
  const candidates = family.filter((other) => other.mode === (theme.mode === 'dark' ? 'light' : 'dark'))
  return candidates.length === 1 ? candidates[0] : undefined
}

export function findThemeForMode(theme: Theme | null | undefined, themes: readonly Theme[], mode: string): Theme | undefined {
  const current = themes.find((other) => other.id === theme?.id && !other.deleted_at && other.mode === mode)
  if (current) return current
  const counterpart = findThemeCounterpart(theme, themes)
  if (counterpart?.mode === mode) return counterpart
  const presets = themes.filter((other) => !other.deleted_at && other.is_builtin === 1 && other.mode === mode)
  return presets.find((other) => theme && familyKey(other) === familyKey(theme))
    ?? presets.find((other) => familyKey(other) === 'standard') ?? presets[0]
}

export function isReservedThemeFamily(name: string): boolean {
  return BUILTIN_THEMES.some((theme) => nameKey(stripModeSuffix(theme.name)) === nameKey(stripModeSuffix(name)))
}
