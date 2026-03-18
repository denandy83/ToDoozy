import { useCallback, useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { Label } from '../../../../shared/types'

interface LabelPickerProps {
  allLabels: Label[]
  assignedLabelIds: Set<string>
  onToggleLabel: (labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
  onClose: () => void
}

export function LabelPicker({
  allLabels,
  assignedLabelIds,
  onToggleLabel,
  onCreateLabel,
  onClose
}: LabelPickerProps): React.JSX.Element {
  const [newLabelMode, setNewLabelMode] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#6366f1')
  const ref = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (newLabelMode) nameInputRef.current?.focus()
  }, [newLabelMode])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleCreateLabel = useCallback(() => {
    const trimmed = newLabelName.trim()
    if (!trimmed) return
    onCreateLabel(trimmed, newLabelColor)
    setNewLabelName('')
    setNewLabelColor('#6366f1')
    setNewLabelMode(false)
  }, [newLabelName, newLabelColor, onCreateLabel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (newLabelMode) {
          setNewLabelMode(false)
        } else {
          onClose()
        }
      }
      if (e.key === 'Enter' && newLabelMode) {
        e.preventDefault()
        handleCreateLabel()
      }
    },
    [newLabelMode, handleCreateLabel, onClose]
  )

  return (
    <div
      ref={ref}
      onKeyDown={handleKeyDown}
      className="w-56 rounded-lg border border-border bg-background p-1 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100"
    >
      {newLabelMode ? (
        <div className="flex flex-col gap-2 p-2">
          <input
            ref={nameInputRef}
            type="text"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="Label name"
            className="rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newLabelColor}
              onChange={(e) => setNewLabelColor(e.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <button
              onClick={handleCreateLabel}
              className="flex-1 rounded bg-accent px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent/80"
            >
              Create
            </button>
          </div>
        </div>
      ) : (
        <>
          {allLabels.map((label) => {
            const isAssigned = assignedLabelIds.has(label.id)
            return (
              <button
                key={label.id}
                onClick={() => onToggleLabel(label.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-light transition-colors hover:bg-foreground/6"
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 truncate">{label.name}</span>
                {isAssigned && (
                  <span className="text-accent text-xs">&#10003;</span>
                )}
              </button>
            )
          })}
          {allLabels.length === 0 && (
            <p className="px-2 py-1.5 text-[10px] text-muted">No labels</p>
          )}
          <div className="mt-1 border-t border-border pt-1">
            <button
              onClick={() => setNewLabelMode(true)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-light text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            >
              <Plus size={14} />
              New label...
            </button>
          </div>
        </>
      )}
    </div>
  )
}
