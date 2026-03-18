import { useCallback, useRef, useEffect } from 'react'
import { X, PanelBottom, PanelRight } from 'lucide-react'
import { useTaskStore, selectCurrentTask, selectTaskLabels } from '../../shared/stores'
import { useStatusStore, selectStatusesByProject } from '../../shared/stores'
import { useLabelStore, selectLabelsByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useViewStore } from '../../shared/stores/viewStore'
import { DetailTitle } from './DetailTitle'
import { DetailStatusRow } from './DetailStatusRow'
import { DetailLabels } from './DetailLabels'
import { DetailRecurrence } from './DetailRecurrence'
import { DetailSnooze } from './DetailSnooze'
import { DetailDescription } from './DetailDescription'
import { DetailActivityLog } from './DetailActivityLog'
import { DetailSubtasks } from './DetailSubtasks'
import { PriorityIndicator } from '../../shared/components/PriorityIndicator'
import { DatePicker } from '../../shared/components/DatePicker'
import type { DetailPanelPosition } from '../../shared/stores/viewStore'

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
  const statuses = useStatusStore(selectStatusesByProject(projectId))
  const allLabels = useLabelStore(selectLabelsByProject(projectId))
  const taskLabels = useTaskStore(selectTaskLabels(task?.id ?? ''))

  // Hydrate labels when task changes
  useEffect(() => {
    if (task) {
      hydrateTaskLabels(task.id)
    }
  }, [task?.id, hydrateTaskLabels]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && task) {
        // Only close if no inner element has stopped propagation
        setCurrentTask(null)
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

  const handleDescriptionChange = (description: string | null): void => {
    updateTask(task.id, { description })
  }

  const handleAddLabel = async (labelId: string): Promise<void> => {
    await addLabel(task.id, labelId)
  }

  const handleRemoveLabel = async (labelId: string): Promise<void> => {
    await removeLabel(task.id, labelId)
  }

  const handleCreateLabel = async (name: string, color: string): Promise<void> => {
    const label = await useLabelStore.getState().createLabel({
      id: crypto.randomUUID(),
      project_id: task.project_id,
      name,
      color
    })
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
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Task Details
        </span>
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

      {/* Body */}
      <div className="flex flex-col gap-5 p-4">
        {/* Title */}
        <DetailTitle title={task.title} onTitleChange={onTitleChange} />

        {/* Status */}
        <Section label="Status">
          <DetailStatusRow
            currentStatusId={task.status_id}
            statuses={statuses}
            isArchived={task.is_archived === 1}
            onStatusChange={onStatusChange}
            onToggleArchive={onToggleArchive}
          />
        </Section>

        {/* Priority */}
        <Section label="Priority">
          <PriorityIndicator
            currentPriority={task.priority}
            onPriorityChange={onPriorityChange}
          />
        </Section>

        {/* Labels */}
        <Section label="Labels">
          <DetailLabels
            assignedLabels={taskLabels}
            allLabels={allLabels}
            onAddLabel={onAddLabel}
            onRemoveLabel={onRemoveLabel}
            onCreateLabel={onCreateLabel}
          />
        </Section>

        {/* Due Date */}
        <Section label="Due Date">
          <DatePicker value={task.due_date} onChange={onDueDateChange} />
        </Section>

        {/* Recurrence */}
        <Section label="Recurrence">
          <DetailRecurrence
            recurrenceRule={task.recurrence_rule}
            onRecurrenceChange={onRecurrenceChange}
          />
        </Section>

        {/* Snooze */}
        <Section label="Snooze">
          <DetailSnooze onSnooze={onSnooze} />
        </Section>

        {/* Subtasks */}
        <DetailSubtasks taskId={task.id} projectId={task.project_id} />

        {/* Description */}
        <DetailDescription
          description={task.description}
          onDescriptionChange={onDescriptionChange}
        />

        {/* Activity Log */}
        <DetailActivityLog taskId={task.id} />
      </div>
    </div>
  )
}

interface SectionProps {
  label: string
  children: React.ReactNode
}

function Section({ label, children }: SectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{label}</span>
      {children}
    </div>
  )
}
