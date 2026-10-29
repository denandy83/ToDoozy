import { ColorSwatches } from '../../shared/components/ColorSwatches'
import { useState } from 'react'
import { Check, X } from 'lucide-react'


interface StatusEditRowProps {
  initialName: string
  initialColor: string
  initialIsDone: boolean
  onSave: (name: string, color: string, isDone: boolean) => void
  onCancel: () => void
}

export function StatusEditRow({
  initialName,
  initialColor,
  initialIsDone,
  onSave,
  onCancel
}: StatusEditRowProps): React.JSX.Element {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name, color, initialIsDone)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Status name"
          autoFocus
          className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted">Color</span>
          <ColorSwatches value={color} onChange={setColor} />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1.5 text-muted transition-colors hover:bg-foreground/6"
          >
            <X size={14} />
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
          >
            <Check size={14} />
          </button>
        </div>
      </div>
    </form>
  )
}
