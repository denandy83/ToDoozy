import { useCallback, useState } from 'react'
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

  const assignedIds = new Set(assignedLabels.map((l) => l.id))

  const handleToggleLabel = useCallback(
    (labelId: string) => {
      if (assignedIds.has(labelId)) {
        onRemoveLabel(labelId)
      } else {
        onAddLabel(labelId)
      }
    },
    [assignedIds, onAddLabel, onRemoveLabel]
  )

  return (
    <div className="relative">
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
        <div className="absolute left-0 top-full z-50 mt-1">
          <LabelPicker
            allLabels={allLabels}
            assignedLabelIds={assignedIds}
            onToggleLabel={handleToggleLabel}
            onCreateLabel={onCreateLabel}
            onClose={() => setDropdownOpen(false)}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  )
}
