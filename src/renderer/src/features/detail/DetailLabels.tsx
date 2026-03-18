import { useCallback, useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { LabelChip } from '../../shared/components/LabelChip'
import type { Label } from '../../../../shared/types'

interface DetailLabelsProps {
  assignedLabels: Label[]
  allLabels: Label[]
  onAddLabel: (labelId: string) => void
  onRemoveLabel: (labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
}

export function DetailLabels({
  assignedLabels,
  allLabels,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel
}: DetailLabelsProps): React.JSX.Element {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [newLabelMode, setNewLabelMode] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#6366f1')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const assignedIds = new Set(assignedLabels.map((l) => l.id))
  const unassigned = allLabels.filter((l) => !assignedIds.has(l.id))

  useEffect(() => {
    if (newLabelMode) nameInputRef.current?.focus()
  }, [newLabelMode])

  useEffect(() => {
    if (!dropdownOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setNewLabelMode(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  const handleAddLabel = useCallback(
    (labelId: string) => {
      onAddLabel(labelId)
      setDropdownOpen(false)
    },
    [onAddLabel]
  )

  const handleCreateLabel = useCallback(() => {
    const trimmed = newLabelName.trim()
    if (!trimmed) return
    onCreateLabel(trimmed, newLabelColor)
    setNewLabelName('')
    setNewLabelColor('#6366f1')
    setNewLabelMode(false)
    setDropdownOpen(false)
  }, [newLabelName, newLabelColor, onCreateLabel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (newLabelMode) {
          setNewLabelMode(false)
        } else {
          setDropdownOpen(false)
        }
      }
      if (e.key === 'Enter' && newLabelMode) {
        e.preventDefault()
        handleCreateLabel()
      }
    },
    [newLabelMode, handleCreateLabel]
  )

  return (
    <div className="relative" onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-center gap-1.5">
        {assignedLabels.map((label) => (
          <LabelChip
            key={label.id}
            name={label.name}
            color={label.color}
            onRemove={() => onRemoveLabel(label.id)}
          />
        ))}
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label="Add label"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {dropdownOpen && (
        <div
          ref={dropdownRef}
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-background p-1 shadow-lg"
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
              {unassigned.map((label) => (
                <button
                  key={label.id}
                  onClick={() => handleAddLabel(label.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-light transition-colors hover:bg-foreground/6"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </button>
              ))}
              {unassigned.length === 0 && (
                <p className="px-2 py-1.5 text-[10px] text-muted">No more labels</p>
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
      )}
    </div>
  )
}
