import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, GripVertical, Trash2, Check } from 'lucide-react'
import type { Status } from '../../../../shared/types'
import { useStatusStore } from '../../shared/stores'
import { StatusEditRow } from './StatusEditRow'
import { ReassignStatusModal } from './ReassignStatusModal'

interface StatusListProps {
  projectId: string
  statuses: Status[]
  addToast: (toast: { message: string; variant?: 'default' | 'danger' }) => void
}

function SortableStatusRow({
  status,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete
}: {
  status: Status
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (name: string, color: string, isDone: boolean) => void
  onDelete: () => void
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: status.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  }

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style}>
        <StatusEditRow
          initialName={status.name}
          initialColor={status.color}
          initialIsDone={status.is_done === 1}
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/6"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted/40 transition-colors hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
      <div
        className="h-3 w-3 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      <span className="flex-1 text-sm font-light">{status.name}</span>
      {status.is_done === 1 && (
        <Check size={12} className="text-success" />
      )}
      {status.is_default === 1 && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
          Default
        </span>
      )}
      <button
        onClick={onEdit}
        className="rounded p-1 text-[9px] font-bold uppercase tracking-wider text-muted opacity-0 transition-opacity hover:bg-foreground/6 group-hover:opacity-100"
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="rounded p-1 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

export function StatusList({
  projectId,
  statuses,
  addToast
}: StatusListProps): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Status | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const createStatus = useStatusStore((s) => s.createStatus)
  const updateStatus = useStatusStore((s) => s.updateStatus)
  const deleteStatus = useStatusStore((s) => s.deleteStatus)
  const reassignAndDelete = useStatusStore((s) => s.reassignAndDelete)

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 }
  })
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  })
  const sensors = useSensors(pointerSensor, keyboardSensor)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = statuses.findIndex((s) => s.id === active.id)
      const newIndex = statuses.findIndex((s) => s.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      // Build new order and update all affected statuses
      const reordered = [...statuses]
      const [moved] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, moved)

      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].order_index !== i) {
          await updateStatus(reordered[i].id, { order_index: i })
        }
      }
    },
    [statuses, updateStatus]
  )

  const handleAddStatus = async (name: string, color: string, isDone: boolean): Promise<void> => {
    try {
      await createStatus({
        id: crypto.randomUUID(),
        project_id: projectId,
        name: name.trim(),
        color,
        icon: isDone ? 'check-circle' : 'circle',
        order_index: statuses.length,
        is_default: 0,
        is_done: isDone ? 1 : 0
      })
      setAddingNew(false)
      addToast({ message: `Status "${name}" created` })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to create status',
        variant: 'danger'
      })
    }
  }

  const handleUpdateStatus = async (
    id: string,
    name: string,
    color: string,
    isDone: boolean
  ): Promise<void> => {
    try {
      await updateStatus(id, {
        name: name.trim(),
        color,
        icon: isDone ? 'check-circle' : 'circle',
        is_done: isDone ? 1 : 0
      })
      setEditingId(null)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to update status',
        variant: 'danger'
      })
    }
  }

  const handleDeleteClick = (status: Status): void => {
    if (statuses.length <= 1) {
      addToast({ message: 'Cannot delete the last status', variant: 'danger' })
      return
    }
    setDeleteTarget(status)
  }

  const handleReassignAndDelete = async (targetStatusId: string): Promise<void> => {
    if (!deleteTarget) return
    try {
      await reassignAndDelete(deleteTarget.id, targetStatusId)
      addToast({ message: `Deleted "${deleteTarget.name}"`, variant: 'danger' })
      setDeleteTarget(null)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete status',
        variant: 'danger'
      })
    }
  }

  const handleDirectDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      await deleteStatus(deleteTarget.id)
      addToast({ message: `Deleted "${deleteTarget.name}"`, variant: 'danger' })
      setDeleteTarget(null)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete status',
        variant: 'danger'
      })
    }
  }

  const activeStatus = activeId ? statuses.find((s) => s.id === activeId) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Statuses
        </h3>
        <button
          onClick={() => setAddingNew(true)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={statuses.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1">
            {statuses.map((status) => (
              <SortableStatusRow
                key={status.id}
                status={status}
                isEditing={editingId === status.id}
                onEdit={() => setEditingId(status.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(name, color, isDone) =>
                  handleUpdateStatus(status.id, name, color, isDone)
                }
                onDelete={() => handleDeleteClick(status)}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeStatus ? (
            <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-surface px-2 py-2 shadow-lg">
              <GripVertical size={14} className="text-muted/40" />
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: activeStatus.color }}
              />
              <span className="text-sm font-light">{activeStatus.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {addingNew && (
        <StatusEditRow
          initialName=""
          initialColor="#888888"
          initialIsDone={false}
          onSave={handleAddStatus}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {deleteTarget && (
        <ReassignStatusModal
          open={true}
          onClose={() => setDeleteTarget(null)}
          statusToDelete={deleteTarget}
          availableStatuses={statuses.filter((s) => s.id !== deleteTarget.id)}
          onReassignAndDelete={handleReassignAndDelete}
          onDirectDelete={handleDirectDelete}
        />
      )}
    </div>
  )
}
