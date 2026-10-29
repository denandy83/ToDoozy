import type { Theme } from '../../../../shared/types'
import { groupThemeChoices } from '../../shared/utils/themeChoices'

export function ThemeOptions({ themes }: { themes: readonly Theme[] }): React.JSX.Element {
  return <>{groupThemeChoices(themes).map((group) => (
    <optgroup key={group.label} label={group.label}>
      {group.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </optgroup>
  ))}</>
}
