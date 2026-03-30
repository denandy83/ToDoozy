import { useCallback, useRef, useEffect, useState } from 'react'
import { X, PanelBottom, PanelRight, AlertTriangle } from 'lucide-react'
import { useTaskStore, selectCurrentTask, useTaskLabelsHook } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useLabelsByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useProjectStore } from '../../shared/stores'
import { useViewStore } from '../../shared/stores/viewStore'
import { useCreateOrMatchLabel } from '../../shared/hooks/useCreateOrMatchLabel'
import { DetailTitle } from './DetailTitle'
import { DetailReferenceUrl } from './DetailReferenceUrl'
import { DetailStatusRow } from './DetailStatusRow'
import { DetailLabels } from './DetailLabels'
import { DetailRecurrence } from './DetailRecurrence'
import { DetailSnooze } from './DetailSnooze'
import { DetailDescription } from './DetailDescription'
import { DetailActivityLog } from './DetailActivityLog'
import { DetailAttachments } from './DetailAttachments'
import { DetailSubtasks } from './DetailSubtasks'
import { PriorityIndicator } from '../../shared/components/PriorityIndicator'
import { DatePicker } from '../../shared/components/DatePicker'
import type { DetailPanelPosition } from '../../shared/stores/viewStore'
import { formatDate } from '../../shared/utils/dateFormat'

export function DetailPanel(): React.JSX.Element | null {
  const task = useTaskStore(selectCurrentTask)
  const { updateTask, setCurrentTask, addLabel, removeLabel, hydrateTaskLabels } = useTaskStore()
  const currentUser = useAuthStore((s) => s.currentUser)
  const position = useViewStore((s) => s.detailPanelPosition)
  const panelSize = useViewStore((s) => s.detailPanelSize)
  const setPanelSize = useViewStore((s) => s.setDetailPanelSize)
  const togglePosition = useViewStore((s) => s.toggleDetailPanelPosition)
  const panelRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startPos: number; startSize: number } | null>(null)

  const projectId = task?.project_id ?? ''
  const statuses = useStatusesByProject(projectId)
  const allLabels = useLabelsByProject(projectId)
  const taskLabels = useTaskLabelsHook(task?.id ?? '')

  // Hydrate labels when task changes
  useEffect(() => {
    if (task) {
      hydrateTaskLabels(task.id)
    }
  }, [task?.id, hydrateTaskLabels]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes panel and restores focus; Tab cycles through detail fields
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !task) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // If a date/time picker dropdown is open (or was just closed), don't close the panel
        if (document.querySelector('.react-datepicker-popper')) return
        if ((e as KeyboardEvent & { _popupHandled?: boolean })._popupHandled) return
        // Close detail panel but keep task selected, then focus the task row
        const selectedId = useTaskStore.getState().lastSelectedTaskId
        useTaskStore.setState({ showDetailPanel: false })
        if (selectedId) {
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>(`[data-task-id="${selectedId}"]`)
            el?.focus()
          })
        }
        return
      }

      // Tab cycling through detail fields (with subfield support for complex fields like DatePicker)
      if (e.key === 'Tab' && panel.contains(document.activeElement)) {
        const fieldElements = Array.from(
          panel.querySelectorAll<HTMLElement>('[data-detail-field]')
        ).sort((a, b) => {
          const ai = parseInt(a.dataset.detailField ?? '0', 10)
          const bi = parseInt(b.dataset.detailField ?? '0', 10)
          return ai - bi
        })

        if (fieldElements.length === 0) return

        const activeEl = document.activeElement as HTMLElement
        let currentFieldIdx = -1
        for (let i = 0; i < fieldElements.length; i++) {
          if (fieldElements[i] === activeEl || fieldElements[i].contains(activeEl)) {
            currentFieldIdx = i
            break
          }
        }

        // Helper: focus into a subfield (the element itself if focusable, else first focusable inside)
        const focusSub = (sf: HTMLElement): void => {
          if (sf.matches('input, textarea, button, [tabindex]:not([tabindex="-1"])')) {
            sf.focus()
          } else {
            sf.querySelector<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])')?.focus()
          }
        }

        // Helper: focus first element in a field (used when entering forward)
        const focusFieldEntry = (field: HTMLElement): void => {
          const active = field.querySelector<HTMLElement>(
            '[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]'
          )
          if (active) { active.focus(); return }
          const contenteditable = field.querySelector<HTMLElement>('[contenteditable="true"]')
          if (contenteditable) {
            contenteditable.focus()
            requestAnimationFrame(() => contenteditable.dispatchEvent(new Event('tiptap:focus-end')))
            return
          }
          const focusable = field.querySelector<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])')
          if (focusable) { focusable.focus(); return }
          if (field.matches('input, textarea')) field.focus()
        }

        // Subfield navigation within the current field
        if (currentFieldIdx !== -1) {
          const currentField = fieldElements[currentFieldIdx]
          const subfields = Array.from(
            currentField.querySelectorAll<HTMLElement>('[data-detail-subfield]')
          ).sort((a, b) => parseInt(a.dataset.detailSubfield ?? '0', 10) - parseInt(b.dataset.detailSubfield ?? '0', 10))

          if (subfields.length > 0) {
            const subfieldIdx = subfields.findIndex((sf) => sf === activeEl || sf.contains(activeEl))

            if (!e.shiftKey) {
              if (subfieldIdx === -1) {
                // On main field entry → jump to first subfield
                e.preventDefault(); e.stopPropagation()
                focusSub(subfields[0]); return
              }
              if (subfieldIdx < subfields.length - 1) {
                // Jump to next subfield
                e.preventDefault(); e.stopPropagation()
                focusSub(subfields[subfieldIdx + 1]); return
              }
              // On last subfield: fall through to next main field
            } else {
              if (subfieldIdx > 0) {
                // Shift-Tab: jump to previous subfield
                e.preventDefault(); e.stopPropagation()
                focusSub(subfields[subfieldIdx - 1]); return
              }
              if (subfieldIdx === 0) {
                // Shift-Tab on first subfield → back to main entry (first focusable not in a subfield)
                e.preventDefault(); e.stopPropagation()
                const mainEntry = Array.from(
                  currentField.querySelectorAll<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])')
                ).find((el) => !el.closest('[data-detail-subfield]'))
                mainEntry?.focus(); return
              }
              // subfieldIdx === -1: on main entry, Shift-Tab falls through to prev main field
            }
          }
        }

        // Navigate between main fields
        const nextIdx = e.shiftKey
          ? (currentFieldIdx <= 0 ? fieldElements.length - 1 : currentFieldIdx - 1)
          : (currentFieldIdx >= fieldElements.length - 1 ? 0 : currentFieldIdx + 1)

        const nextField = fieldElements[nextIdx]
        if (nextField) {
          e.preventDefault()
          e.stopPropagation()

          // When entering a field via Shift-Tab, land on the last subfield (if any)
          if (e.shiftKey) {
            const nextSubfields = Array.from(
              nextField.querySelectorAll<HTMLElement>('[data-detail-subfield]')
            ).sort((a, b) => parseInt(a.dataset.detailSubfield ?? '0', 10) - parseInt(b.dataset.detailSubfield ?? '0', 10))
            if (nextSubfields.length > 0) {
              focusSub(nextSubfields[nextSubfields.length - 1]); return
            }
          }

          focusFieldEntry(nextField)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [task, setCurrentTask])

  // Resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startPos = position === 'bottom' ? e.clientY : e.clientX
      resizeRef.current = { startPos, startSize: panelSize }

      const handleMove = (ev: MouseEvent): void => {
        if (!resizeRef.current) return
        const currentPos = position === 'bottom' ? ev.clientY : ev.clientX
        const diff = resizeRef.current.startPos - currentPos
        setPanelSize(resizeRef.current.startSize + diff)
      }

      const handleUp = (): void => {
        resizeRef.current = null
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [position, panelSize, setPanelSize]
  )

  if (!task) return null

  const handleTitleChange = (title: string): void => {
    updateTask(task.id, { title })
    logActivity('title_changed', task.title, title)
  }

  const handleStatusChange = (statusId: string): void => {
    const newStatus = statuses.find((s) => s.id === statusId)
    const update: { status_id: string; completed_date?: string | null } = { status_id: statusId }
    if (newStatus?.is_done === 1) {
      update.completed_date = new Date().toISOString()
    } else {
      update.completed_date = null
    }
    updateTask(task.id, update)
    const oldStatus = statuses.find((s) => s.id === task.status_id)
    logActivity('status_changed', oldStatus?.name ?? '', newStatus?.name ?? '')
  }

  const handleToggleArchive = (): void => {
    const newVal = task.is_archived === 1 ? 0 : 1
    updateTask(task.id, { is_archived: newVal })
    logActivity('archive_toggled', String(task.is_archived), String(newVal))
  }

  const handlePriorityChange = (priority: number): void => {
    updateTask(task.id, { priority })
    logActivity('priority_changed', String(task.priority), String(priority))
  }

  const handleDueDateChange = (dueDate: string | null): void => {
    updateTask(task.id, { due_date: dueDate })
    logActivity('due_date_changed', task.due_date ?? '', dueDate ?? '')
  }

  const handleRecurrenceChange = (rule: string | null): void => {
    updateTask(task.id, { recurrence_rule: rule })
  }

  const handleSnooze = (date: string): void => {
    updateTask(task.id, { due_date: date })
    logActivity('snoozed', task.due_date ?? '', date)
  }

  const handleReferenceUrlChange = (referenceUrl: string | null): void => {
    updateTask(task.id, { reference_url: referenceUrl })
  }

  const handleDescriptionChange = (description: string | null): void => {
    updateTask(task.id, { description })
  }

  const handleAddLabel = async (labelId: string): Promise<void> => {
    await addLabel(task.id, labelId)
  }

  const handleRemoveLabel = async (labelId: string): Promise<void> => {
    await removeLabel(task.id, labelId)
  }

  const createOrMatchLabel = useCreateOrMatchLabel(task.project_id)
  const handleCreateLabel = async (name: string, color: string): Promise<void> => {
    const label = await createOrMatchLabel(name, color)
    await addLabel(task.id, label.id)
  }

  const logActivity = (action: string, oldValue: string, newValue: string): void => {
    if (!currentUser) return
    window.api.activityLog
      .create({
        id: crypto.randomUUID(),
        task_id: task.id,
        user_id: currentUser.id,
        action,
        old_value: oldValue || null,
        new_value: newValue || null
      })
      .catch((err: unknown) => console.error('Failed to log activity:', err))
  }

  const isSide = position === 'side'

  const panelStyle = isSide
    ? { width: `${panelSize}px`, minWidth: '200px', maxWidth: '800px' }
    : { height: `${panelSize}px`, minHeight: '200px', maxHeight: '800px' }

  const resizeHandleClass = isSide
    ? 'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors'
    : 'absolute left-0 right-0 top-0 h-1 cursor-row-resize hover:bg-accent/30 transition-colors'

  return (
    <div
      ref={panelRef}
      data-detail-panel
      className={`relative flex-shrink-0 border-border bg-background overflow-hidden ${
        isSide ? 'border-l' : 'border-t'
      }`}
      style={panelStyle}
    >
      {/* Resize handle */}
      <div className={resizeHandleClass} onMouseDown={handleResizeStart} />

      <DetailPanelContent
        task={task}
        statuses={statuses}
        taskLabels={taskLabels}
        allLabels={allLabels}
        position={position}
        onClose={() => setCurrentTask(null)}
        onTogglePosition={togglePosition}
        onTitleChange={handleTitleChange}
        onReferenceUrlChange={handleReferenceUrlChange}
        onStatusChange={handleStatusChange}
        onToggleArchive={handleToggleArchive}
        onPriorityChange={handlePriorityChange}
        onDueDateChange={handleDueDateChange}
        onRecurrenceChange={handleRecurrenceChange}
        onSnooze={handleSnooze}
        onDescriptionChange={handleDescriptionChange}
        onAddLabel={handleAddLabel}
        onRemoveLabel={handleRemoveLabel}
        onCreateLabel={handleCreateLabel}
      />
    </div>
  )
}

import type { Task, Status, Label } from '../../../../shared/types'

interface DetailPanelContentProps {
  task: Task
  statuses: Status[]
  taskLabels: Label[]
  allLabels: Label[]
  position: DetailPanelPosition
  onClose: () => void
  onTogglePosition: () => void
  onTitleChange: (title: string) => void
  onReferenceUrlChange: (url: string | null) => void
  onStatusChange: (statusId: string) => void
  onToggleArchive: () => void
  onPriorityChange: (priority: number) => void
  onDueDateChange: (date: string | null) => void
  onRecurrenceChange: (rule: string | null) => void
  onSnooze: (date: string) => void
  onDescriptionChange: (desc: string | null) => void
  onAddLabel: (labelId: string) => void
  onRemoveLabel: (labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
}

function DetailPanelContent({
  task,
  statuses,
  taskLabels,
  allLabels,
  position,
  onClose,
  onTogglePosition,
  onTitleChange,
  onReferenceUrlChange,
  onStatusChange,
  onToggleArchive,
  onPriorityChange,
  onDueDateChange,
  onRecurrenceChange,
  onSnooze,
  onDescriptionChange,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel
}: DetailPanelContentProps): React.JSX.Element {
  const project = useProjectStore((s) => task.project_id ? s.projects[task.project_id] : undefined)
  const isTemplate = task.is_template === 1
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-[36px] items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          {isTemplate ? 'Template' : 'Task Details'}
          <button
            onClick={() => navigator.clipboard.writeText(task.id)}
            className="font-mono text-[8px] tracking-normal text-muted/30 transition-colors hover:text-muted/60"
            title={`Copy ID: ${task.id}`}
          >
            #{task.id.slice(0, 6)}
          </button>
        </span>
        <div className="flex items-center gap-3">
          {project && !isTemplate && (
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                {project.name}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1">
          <button
            onClick={onTogglePosition}
            className="rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title={position === 'side' ? 'Move to bottom' : 'Move to side'}
            aria-label={position === 'side' ? 'Move to bottom' : 'Move to side'}
          >
            {position === 'side' ? <PanelBottom size={14} /> : <PanelRight size={14} />}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title="Close (Esc)"
            aria-label="Close panel"
          >
            <X size={14} />
          </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <DetailPanelBody
        position={position}
        task={task}
        statuses={statuses}
        taskLabels={taskLabels}
        allLabels={allLabels}
        onTitleChange={onTitleChange}
        onReferenceUrlChange={onReferenceUrlChange}
        onStatusChange={onStatusChange}
        onToggleArchive={onToggleArchive}
        onPriorityChange={onPriorityChange}
        onDueDateChange={onDueDateChange}
        onRecurrenceChange={onRecurrenceChange}
        onSnooze={onSnooze}
        onDescriptionChange={onDescriptionChange}
        onAddLabel={onAddLabel}
        onRemoveLabel={onRemoveLabel}
        onCreateLabel={onCreateLabel}
      />
    </div>
  )
}

const MIN_COL_WIDTH = 280
const COL_GAP = 24

function DetailPanelBody(props: Omit<DetailPanelContentProps, 'onClose' | 'onTogglePosition'>): React.JSX.Element {
  const { position, task, statuses, taskLabels, allLabels } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [colCount, setColCount] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el || position !== 'bottom') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      const cols = Math.max(1, Math.floor((width + COL_GAP) / (MIN_COL_WIDTH + COL_GAP)))
      setColCount(cols)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [position])

  const isTemplate = task.is_template === 1

  const sections: React.ReactNode[] = [
    <DetailTitle key="title" title={task.title} onTitleChange={props.onTitleChange} />,
    <Section key="reference" label="Reference" fieldIndex={1}>
      <DetailReferenceUrl referenceUrl={task.reference_url} onReferenceUrlChange={props.onReferenceUrlChange} />
    </Section>,
    !isTemplate ? (
      <Section key="status" label="Status" fieldIndex={2}>
        <DetailStatusRow currentStatusId={task.status_id} statuses={statuses} isArchived={task.is_archived === 1} onStatusChange={props.onStatusChange} onToggleArchive={props.onToggleArchive} />
      </Section>
    ) : null,
    <Section key="priority" label="Priority" fieldIndex={3}>
      <PriorityIndicator currentPriority={task.priority} onPriorityChange={props.onPriorityChange} />
    </Section>,
    <Section key="labels" label="Labels" fieldIndex={4}>
      <DetailLabels assignedLabels={taskLabels} allLabels={allLabels} onAddLabel={props.onAddLabel} onRemoveLabel={props.onRemoveLabel} onCreateLabel={props.onCreateLabel} projectId={task.project_id} />
    </Section>,
    !isTemplate ? (
      <Section key="due" label="Due Date" fieldIndex={5}
        labelIcon={task.due_date && !task.completed_date && task.due_date.split('T')[0] < new Date().toISOString().split('T')[0]
          ? <AlertTriangle size={10} className="text-danger" />
          : undefined
        }
      >
        <DatePicker value={task.due_date} onChange={props.onDueDateChange} />
      </Section>
    ) : null,
    !isTemplate && task.completed_date ? (
      <Section key="completed" label="Completed">
        <span className="text-sm font-light text-success">
          {formatDate(task.completed_date, undefined, { omitCurrentYear: true })}
          {task.completed_date.includes('T') ? ` ${task.completed_date.split('T')[1].slice(0, 5)}` : ''}
        </span>
      </Section>
    ) : null,
    <Section key="recurrence" label="Recurrence" fieldIndex={6}>
      <DetailRecurrence recurrenceRule={task.recurrence_rule} onRecurrenceChange={props.onRecurrenceChange} />
    </Section>,
    !isTemplate ? (
      <Section key="snooze" label="Snooze" fieldIndex={7}>
        <DetailSnooze currentDueDate={task.due_date} onSnooze={props.onSnooze} />
      </Section>
    ) : null,
    <div key="subtasks" data-detail-field="8"><DetailSubtasks taskId={task.id} projectId={task.project_id} /></div>,
    <div key="desc" data-detail-field="9"><DetailDescription description={task.description} taskId={task.id} updatedAt={task.updated_at} onDescriptionChange={props.onDescriptionChange} /></div>,
    !isTemplate ? <div key="attachments" data-detail-field="10"><DetailAttachments taskId={task.id} /></div> : null,
    !isTemplate ? <DetailActivityLog key="activity" taskId={task.id} /> : null
  ]

  if (position !== 'bottom' || colCount <= 1) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          {sections}
        </div>
      </div>
    )
  }

  // Distribute items evenly across columns, top-to-bottom then left-to-right
  const columns: React.ReactNode[][] = Array.from({ length: colCount }, () => [])
  const perCol = Math.ceil(sections.length / colCount)
  for (let i = 0; i < sections.length; i++) {
    const col = Math.floor(i / perCol)
    columns[Math.min(col, colCount - 1)].push(sections[i])
  }

  return (
    <div ref={containerRef} className="flex flex-1 gap-6 overflow-hidden p-4">
      {columns.map((colItems, i) => (
        <div key={i} className="flex flex-1 flex-col gap-5 overflow-y-auto">
          {colItems}
        </div>
      ))}
    </div>
  )
}

interface SectionProps {
  label: string
  children: React.ReactNode
  fieldIndex?: number
  labelIcon?: React.ReactNode
}

function Section({ label, children, fieldIndex, labelIcon }: SectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5" data-detail-field={fieldIndex}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        {label}
        {labelIcon}
      </span>
      {children}
    </div>
  )
}
