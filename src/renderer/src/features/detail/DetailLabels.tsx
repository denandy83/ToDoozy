import { useCallback, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { LabelChip } from '../../shared/components/LabelChip'
import { LabelPicker } from '../../shared/components/LabelPicker'
import type { Label } from '../../../../shared/types'

interface DetailLabelsProps {
  assignedLabels: Label[]
  allLabels: Label[]
  onAddLabel: (labelId: string) => void
  onRemoveLabel: (labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
  projectId?: string
}

export function DetailLabels({
  assignedLabels,
  allLabels,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel,
  projectId
}: DetailLabelsProps): React.JSX.Element {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  const assignedIds = new Set(assignedLabels.map((l) => l.id))

  // Remove a label and restore focus to the previous chip (or +Add if none remain)
  const handleRemoveLabel = useCallback(
    (labelId: string) => {
      const idx = assignedLabels.findIndex((l) => l.id === labelId)
      onRemoveLabel(labelId)
      requestAnimationFrame(() => {
        const focusables = Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[tabindex="0"]') ?? [])
        if (focusables.length > 0) {
          focusables[Math.min(Math.max(0, idx - 1), focusables.length - 1)].focus()
        }
      })
    },
    [assignedLabels, onRemoveLabel]
  )

  const handleToggleLabel = useCallback(
    (labelId: string) => {
      if (assignedIds.has(labelId)) {
        handleRemoveLabel(labelId)
      } else {
        onAddLabel(labelId)
      }
    },
    [assignedIds, onAddLabel, handleRemoveLabel]
  )

  // Arrow key navigation between chips and the +Add button
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const row = rowRef.current
    if (!row) return
    const focusable = Array.from(row.querySelectorAll<HTMLElement>('[tabindex="0"]'))
    if (focusable.length === 0) return
    const current = document.activeElement as HTMLElement
    const idx = focusable.indexOf(current)
    if (idx === -1) return
    e.preventDefault()
    if (e.key === 'ArrowRight') {
      focusable[(idx + 1) % focusable.length].focus()
    } else {
      focusable[(idx - 1 + focusable.length) % focusable.length].focus()
    }
  }, [])

  return (
    <div className="relative">
      <div ref={rowRef} className="flex flex-wrap items-center gap-1.5" onKeyDown={handleKeyDown}>
        {assignedLabels.map((label) => (
          <LabelChip
            key={label.id}
            name={label.name}
            color={label.color}
            onRemove={() => handleRemoveLabel(label.id)}
            onClick={() => handleRemoveLabel(label.id)}
          />
        ))}
        <button
          ref={addButtonRef}
          tabIndex={0}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label="Add label"
          aria-expanded={dropdownOpen}
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {dropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1">
          <LabelPicker
            allLabels={allLabels}
            assignedLabelIds={assignedIds}
            onToggleLabel={handleToggleLabel}
            onCreateLabel={onCreateLabel}
            onClose={() => {
              setDropdownOpen(false)
              addButtonRef.current?.focus()
            }}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  )
}
