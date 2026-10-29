import { Check } from 'lucide-react'
import { PASTEL_SWATCHES, VIVID_SWATCHES } from '../utils/colorPalette'
import { readableColor } from '../../../../shared/colorContrast'

export function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }): React.JSX.Element {
  return <div className="ui-color-swatches" aria-label="Color choices">
    {([['Vivid', VIVID_SWATCHES], ['Pastel', PASTEL_SWATCHES]] as const).map(([group, colors]) => <div key={group}>
      <p className="ui-section-label mb-2">{group}</p>
      <div className="grid grid-cols-8 gap-1.5" role="group" aria-label={`${group} colors`}>
        {colors.map(([name, color]) => <button key={color} type="button" title={name} aria-label={name} aria-pressed={value.toLowerCase() === color}
          className="ui-color-swatch" style={{ backgroundColor: color, color: readableColor('#ffffff', [color]) }}
          onClick={() => onChange(color)}>{value.toLowerCase() === color && <Check size={12} strokeWidth={3} />}</button>)}
      </div>
    </div>)}
    <label className="flex items-center gap-2 text-xs text-fg-secondary">Custom color
      <input type="color" aria-label="Custom hex color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-8 cursor-pointer border-0 bg-transparent" />
      <span className="font-mono text-[11px]">{value}</span>
    </label>
  </div>
}
