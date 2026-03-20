import { useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Plus, Calendar, X } from 'lucide-react'
import type { Label, Project } from '../../../../shared/types'
import { useSmartInput } from '../../shared/hooks/useSmartInput'
import { InputSuggestionPopup, type SuggestionData, type InputSuggestionPopupProps } from '../../shared/components/InputSuggestionPopup'
import { LabelChip } from '../../shared/components/LabelChip'
import { PriorityBadge } from '../../shared/components/PriorityBadge'
import {
  filterLabels,
  filterPriorities,
  filterDates,
  filterProjects,
  getNextAutoColor
} from '../../shared/hooks/smartInputParser'
import { useLabelStore } from '../../shared/stores'
import { formatDate, useDateFormat } from '../../shared/utils/dateFormat'

export interface SmartTaskData {
  title: string
  labels: Label[]
  priority: number
  dueDate: string | null
}

interface AddTaskInputProps {
  viewName: string
  onSubmit: (data: SmartTaskData) => void
  disabled?: boolean
  labels?: Label[]
  projectId?: string
  projects?: Project[]
  onProjectChange?: (projectId: string) => void
  projectSelector?: React.ReactNode
}

export interface AddTaskInputHandle {
  focus: () => void
}

export const AddTaskInput = forwardRef<AddTaskInputHandle, AddTaskInputProps>(
  function AddTaskInput({ viewName, onSubmit, disabled, labels = [], projectId, projects = [], onProjectChange, projectSelector }, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    const smart = useSmartInput(inputRef)
    const dateFormat = useDateFormat()

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus()
    }))

    const hasChips = smart.attachedLabels.length > 0 || smart.selectedPriority !== null || smart.selectedDate !== null

    const handleSubmit = useCallback(() => {
      if (smart.popupState) return // Let popup handle Enter
      const title = smart.getSubmitTitle()
      if (!title) return
      onSubmit({
        title,
        labels: smart.attachedLabels,
        priority: smart.selectedPriority ?? 0,
        dueDate: smart.selectedDate
      })
      smart.reset()
    }, [smart, onSubmit])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (smart.popupState) return // Popup handles its own keys

        if (e.key === 'Enter') {
          e.preventDefault()
          handleSubmit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          smart.reset()
          inputRef.current?.blur()
        }
        if (e.key === 'Backspace' && smart.inputValue === '') {
          smart.removeLastChip()
        }
      },
      [handleSubmit, smart]
    )

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        smart.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
      },
      [smart]
    )

    const handleSelect = useCallback(
      (e: React.SyntheticEvent<HTMLInputElement>) => {
        const target = e.target as HTMLInputElement
        smart.handleCursorMove(target.selectionStart ?? target.value.length)
      },
      [smart]
    )

    const handlePopupSelect = useCallback(
      (data: SuggestionData) => {
        if (data.type === 'label') {
          smart.selectLabel(data.label)
        } else if (data.type === 'label-create') {
          if (projectId) {
            window.api.labels
              .create({ id: crypto.randomUUID(), project_id: projectId, name: data.name, color: data.color })
              .then((created) => {
                smart.selectLabel(created)
                // Refresh label store so the new label appears in future @ queries
                useLabelStore.getState().hydrateLabels(projectId)
              })
              .catch((err: unknown) => console.error('Failed to create label:', err))
          }
          if (smart.popupState?.operator) {
            const newValue =
              smart.inputValue.slice(0, smart.popupState.operator.startIndex) +
              smart.inputValue.slice(smart.popupState.operator.endIndex)
            smart.setInputValue(newValue.replace(/  +/g, ' ').trim())
          }
          smart.dismissPopup()
        } else if (data.type === 'priority') {
          smart.selectPriority(data.option.value)
        } else if (data.type === 'date') {
          smart.selectDate(data.option.date)
        } else if (data.type === 'project') {
          onProjectChange?.(data.project.id)
          smart.selectProject(data.project)
        }
      },
      [smart, projectId, onProjectChange]
    )

    const popupItems = useMemo(() => {
      if (!smart.popupState) return []

      if (smart.popupState.type === '@') {
        const filtered = filterLabels(labels, smart.popupState.query)
        const items: InputSuggestionPopupProps['items'] = filtered.map((l) => ({
          id: l.id,
          label: l.name,
          color: l.color,
          data: { type: 'label' as const, label: l }
        }))

        // Add "Create" option if query is non-empty
        if (smart.popupState.query.trim()) {
          const autoColor = getNextAutoColor(labels)
          items.push({
            id: '__create__',
            label: `+ Create "${smart.popupState.query.trim()}"`,
            color: autoColor,
            data: {
              type: 'label-create' as const,
              name: smart.popupState.query.trim(),
              color: autoColor
            }
          })
        }
        return items
      }

      if (smart.popupState.type === 'p:') {
        return filterPriorities(smart.popupState.query).map((p) => ({
          id: `priority-${p.value}`,
          label: p.label,
          color: p.color,
          data: { type: 'priority' as const, option: p }
        }))
      }

      if (smart.popupState.type === 'd:') {
        return filterDates(smart.popupState.query, dateFormat).map((d) => ({
          id: `date-${d.date}`,
          label: d.label,
          icon: 'calendar' as const,
          secondaryText: d.formatted,
          data: { type: 'date' as const, option: d }
        }))
      }

      if (smart.popupState.type === '/' && projects.length > 0) {
        return filterProjects(projects, smart.popupState.query).map((p) => ({
          id: `project-${p.id}`,
          label: p.name,
          color: p.color,
          data: { type: 'project' as const, project: p }
        }))
      }

      return []
    }, [smart.popupState, labels, projects])

    return (
      <div>
        <div className="flex h-[36px] items-center gap-2 border-b border-border px-4">
          {projectSelector}
          <Plus size={14} className="flex-shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={smart.inputValue}
            onChange={handleChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            placeholder={`Add to ${viewName}...`}
            disabled={disabled}
            className="flex-1 bg-transparent text-[15px] font-light tracking-tight text-foreground placeholder:text-muted/40 disabled:opacity-50 focus:outline-none"
          />
        </div>

        {hasChips && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-6">
            {smart.attachedLabels.map((l) => (
              <LabelChip
                key={l.id}
                name={l.name}
                color={l.color}
                onRemove={() => smart.removeLabel(l.id)}
              />
            ))}
            {smart.selectedPriority !== null && smart.selectedPriority > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <PriorityBadge priority={smart.selectedPriority} />
                <button
                  onClick={smart.removePriority}
                  className="rounded-full p-0.5 text-muted hover:bg-foreground/6 hover:text-foreground"
                  aria-label="Remove priority"
                >
                  <X size={10} />
                </button>
              </span>
            )}
            {smart.selectedDate && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted"
              >
                <Calendar size={10} />
                {formatDate(smart.selectedDate)}
                <button
                  onClick={smart.removeDate}
                  className="ml-0.5 rounded-full p-0 hover:text-foreground"
                  aria-label="Remove date"
                >
                  <X size={10} />
                </button>
              </span>
            )}
          </div>
        )}

        {smart.popupState && popupItems.length > 0 && (
          <InputSuggestionPopup
            items={popupItems}
            position={smart.popupState.position}
            onSelect={handlePopupSelect}
            onDismiss={smart.dismissPopup}
          />
        )}
      </div>
    )
  }
)
