import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function ColorDot({ color, onChange }: { color: string; onChange: (c: string) => void }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <button
      className="relative h-3.5 w-3.5 flex-shrink-0 rounded-full cursor-pointer ring-1 ring-foreground/10 hover:ring-foreground/30 transition-all"
      style={{ backgroundColor: color }}
      onClick={() => inputRef.current?.click()}
      title="Change color"
    >
      <input
        ref={inputRef}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </button>
  )
}
import { useLabelStore, useLabelsByProject } from '../../shared/stores/labelStore'
import { useProjectStore, selectCurrentProject } from '../../shared/stores/projectStore'
import { useTaskStore } from '../../shared/stores/taskStore'
import { useToast } from '../../shared/components/Toast'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import type { Label } from '../../../../shared/types'

export function LabelSettingsContent(): React.JSX.Element {
  const currentProject = useProjectStore(selectCurrentProject)
  const projectId = currentProject?.id ?? ''
  const labels = useLabelsByProject(projectId)
  const { createLabel, updateLabel, deleteLabel, reorderLabels, filterMode, setFilterMode } = useLabelStore()
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const { addToast } = useToast()
  const setSetting = useSettingsStore((s) => s.setSetting)
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8

  const [showAddInput, setShowAddInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const addRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  useEffect(() => {
    if (showAddInput) {
      requestAnimationFrame(() => {
        addRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        addInputRef.current?.focus()
      })
    }
  }, [showAddInput])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name || !projectId) return
    await createLabel({ id: crypto.randomUUID(), project_id: projectId, name, color: newColor })
    setNewName('')
    requestAnimationFrame(() => {
      addRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      addInputRef.current?.focus()
    })
  }, [newName, newColor, projectId, createLabel])

  const sortedLabels = useMemo(
    () => [...labels].sort((a, b) => a.order_index - b.order_index),
    [labels]
  )
  const labelIds = useMemo(() => sortedLabels.map((l) => l.id), [sortedLabels])

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }))

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = sortedLabels.findIndex((l) => l.id === active.id)
      const newIndex = sortedLabels.findIndex((l) => l.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const newOrder = [...sortedLabels]
      const [moved] = newOrder.splice(oldIndex, 1)
      newOrder.splice(newIndex, 0, moved)
      reorderLabels(newOrder.map((l) => l.id))
    },
    [sortedLabels, reorderLabels]
  )

  const handleStartEdit = useCallback((label: Label) => {
    setEditingId(label.id)
    setEditName(label.name)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return
    const name = editName.trim()
    if (name) {
      await updateLabel(editingId, { name })
    }
    setEditingId(null)
  }, [editingId, editName, updateLabel])

  const handleDelete = useCallback((id: string) => {
    // Count tasks that have this label assigned
    const assignedCount = Object.values(taskLabels).filter(
      (labels) => labels.some((l) => l.id === id)
    ).length

    if (assignedCount > 0) {
      addToast({
        message: `This label is assigned to ${assignedCount} task${assignedCount === 1 ? '' : 's'}. Remove it?`,
        persistent: true,
        actions: [
          { label: 'Remove', variant: 'danger', onClick: () => deleteLabel(id) },
          { label: 'Cancel', variant: 'muted', onClick: () => {} }
        ]
      })
    } else {
      deleteLabel(id)
    }
  }, [deleteLabel, taskLabels, addToast])

  return (
    <div className="flex flex-col gap-6">
      {/* Filter mode toggle */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Filter Mode
        </p>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['hide', 'blur'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setFilterMode(m)}
              className={`flex-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                filterMode === m
                  ? 'bg-accent/12 text-accent'
                  : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {filterMode === 'hide' ? (
          <p className="mt-1 text-[10px] text-muted">Non-matching tasks are removed from view</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{blurOpacity}%</span>
              <input
                type="range"
                min={2}
                max={40}
                value={blurOpacity}
                onChange={(e) => setSetting('label_blur_opacity', e.target.value)}
                className="flex-1 accent-accent"
              />
              <span className="text-[10px] text-muted">opacity</span>
            </div>
            <div className="flex items-center justify-center gap-6 rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-light text-foreground">Matching task</span>
              <span className="text-sm font-light text-foreground" style={{ opacity: blurOpacity / 100 }}>Non-matching task</span>
            </div>
          </div>
        )}
      </div>

      {/* Label list */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Labels
        </p>

        {/* Add label — on top */}
        {showAddInput ? (
          <div
            ref={addRowRef}
            className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-accent/30 bg-accent/6 px-2 py-1.5"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (!newName.trim()) { setShowAddInput(false); setNewName('') }
              }
            }}
          >
            <ColorDot color={newColor} onChange={setNewColor} />
            <input
              ref={addInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { e.stopPropagation(); setShowAddInput(false); setNewName('') }
              }}
              placeholder="Label name..."
              className="flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setShowAddInput(true)}
            className="mb-2 flex items-center gap-1.5 py-1 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground"
          >
            <Plus size={12} />
            Add Label
          </button>
        )}

        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={labelIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1">
              {sortedLabels.map((label) => (
                <SortableLabelRow
                  key={label.id}
                  label={label}
                  disabled={showAddInput}
                  isEditing={editingId === label.id}
                  editName={editName}
                  editInputRef={editingId === label.id ? editInputRef : undefined}
                  onEditNameChange={setEditName}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={() => setEditingId(null)}
                  onStartEdit={() => handleStartEdit(label)}
                  onDelete={() => handleDelete(label.id)}
                  onColorChange={(c) => updateLabel(label.id, { color: c })}
                />
              ))}

              {sortedLabels.length === 0 && !showAddInput && (
                <p className="py-2 text-sm font-light text-muted/40">No labels yet</p>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

interface SortableLabelRowProps {
  label: Label
  disabled: boolean
  isEditing: boolean
  editName: string
  editInputRef?: React.RefObject<HTMLInputElement | null>
  onEditNameChange: (name: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  onDelete: () => void
  onColorChange: (color: string) => void
}

function SortableLabelRow({
  label,
  disabled,
  isEditing,
  editName,
  editInputRef,
  onEditNameChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDelete,
  onColorChange
}: SortableLabelRowProps): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: label.id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.3 : undefined
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
        disabled ? 'pointer-events-none opacity-50' : 'hover:bg-foreground/6'
      }`}
      {...attributes}
      {...listeners}
    >
      <ColorDot color={label.color} onChange={onColorChange} />
      {isEditing ? (
        <input
          ref={editInputRef}
          type="text"
          value={editName}
          onChange={(e) => onEditNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveEdit()
            if (e.key === 'Escape') { e.stopPropagation(); onCancelEdit() }
          }}
          onBlur={onSaveEdit}
          className="flex-1 bg-transparent text-sm font-light text-foreground focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-sm font-light text-foreground">{label.name}</span>
      )}
      <button
        onClick={onStartEdit}
        className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        title="Rename"
      >
        <Pencil size={12} />
      </button>
      <button
        onClick={onDelete}
        className="rounded p-0.5 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
        title="Delete"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
