import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Plus, Trash2, Pencil, Check, X, FolderMinus } from 'lucide-react'
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
import { useLabelStore } from '../../shared/stores/labelStore'
import { useProjectStore, selectCurrentProject } from '../../shared/stores/projectStore'
import { useToast } from '../../shared/components/Toast'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import type { Label, LabelUsageInfo } from '../../../../shared/types'

export function LabelSettingsContent(): React.JSX.Element {
  const currentProject = useProjectStore(selectCurrentProject)
  const projectId = currentProject?.id ?? ''
  const { createLabel, updateLabel, deleteLabel, removeFromProject, addToProject, reorderLabels, filterMode, setFilterMode } = useLabelStore()
  const { addToast } = useToast()
  const setSetting = useSettingsStore((s) => s.setSetting)
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8

  // Fetch all labels with usage info
  const [labelsWithUsage, setLabelsWithUsage] = useState<LabelUsageInfo[]>([])
  const [projectLabelIds, setProjectLabelIds] = useState<Set<string>>(new Set())

  const refreshLabels = useCallback(async () => {
    const [all, projectLabels] = await Promise.all([
      window.api.labels.findAllWithUsage(),
      window.api.labels.findByProjectId(projectId)
    ])
    setLabelsWithUsage(all)
    setProjectLabelIds(new Set(projectLabels.map((l) => l.id)))
  }, [projectId])

  useEffect(() => {
    refreshLabels()
  }, [refreshLabels])

  const [showAddInput, setShowAddInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
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
    // Check for existing global label
    const existing = await window.api.labels.findByName(name)
    if (existing) {
      await addToProject(projectId, existing.id)
      addToast({ message: `Existing label added: ${existing.name}` })
    } else {
      await createLabel({ id: crypto.randomUUID(), project_id: projectId, name, color: newColor })
    }
    setNewName('')
    await refreshLabels()
    requestAnimationFrame(() => {
      addRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      addInputRef.current?.focus()
    })
  }, [newName, newColor, projectId, createLabel, addToProject, addToast, refreshLabels])

  const sortedLabels = useMemo(
    () => [...labelsWithUsage].sort((a, b) => a.order_index - b.order_index),
    [labelsWithUsage]
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
    setEditColor(label.color)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return
    const name = editName.trim()
    if (name) {
      await updateLabel(editingId, { name, color: editColor })
      await refreshLabels()
    }
    setEditingId(null)
  }, [editingId, editName, editColor, updateLabel, refreshLabels])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleDeleteGlobally = useCallback(async (id: string) => {
    const label = sortedLabels.find((l) => l.id === id)
    if (!label) return

    const projects = await window.api.labels.findProjectsUsingLabel(id)
    const totalTasks = projects.reduce((sum, p) => sum + p.task_count, 0)

    const projectList = projects.map((p) => `${p.project_name} (${p.task_count} task${p.task_count === 1 ? '' : 's'})`).join(', ')
    const message = totalTasks > 0
      ? `Delete "${label.name}" everywhere? Used in: ${projectList}.`
      : `Delete "${label.name}" everywhere?`

    addToast({
      message,
      persistent: true,
      actions: [
        { label: 'Delete everywhere', variant: 'danger', onClick: async () => {
          await deleteLabel(id)
          await refreshLabels()
        }},
        { label: 'Cancel', variant: 'muted', onClick: () => {} }
      ]
    })
  }, [deleteLabel, addToast, sortedLabels, refreshLabels])

  const handleRemoveFromProject = useCallback(async (id: string) => {
    const label = sortedLabels.find((l) => l.id === id)
    if (!label || !currentProject) return

    addToast({
      message: `Remove "${label.name}" from ${currentProject.name}? Tasks in this project will lose the label.`,
      persistent: true,
      actions: [
        { label: 'Remove', variant: 'danger', onClick: async () => {
          await removeFromProject(projectId, id)
          await refreshLabels()
        }},
        { label: 'Cancel', variant: 'muted', onClick: () => {} }
      ]
    })
  }, [removeFromProject, projectId, currentProject, addToast, sortedLabels, refreshLabels])

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
          All Labels
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
                  isInProject={projectLabelIds.has(label.id)}
                  editName={editName}
                  editColor={editColor}
                  editInputRef={editingId === label.id ? editInputRef : undefined}
                  onEditNameChange={setEditName}
                  onEditColorChange={setEditColor}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onStartEdit={() => handleStartEdit(label)}
                  onDeleteGlobally={() => handleDeleteGlobally(label.id)}
                  onRemoveFromProject={() => handleRemoveFromProject(label.id)}
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

const LABEL_COLORS = [
  '#888888', '#ef4444', '#f59e0b', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'
]

interface SortableLabelRowProps {
  label: LabelUsageInfo
  disabled: boolean
  isEditing: boolean
  isInProject: boolean
  editName: string
  editColor: string
  editInputRef?: React.RefObject<HTMLInputElement | null>
  onEditNameChange: (name: string) => void
  onEditColorChange: (color: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  onDeleteGlobally: () => void
  onRemoveFromProject: () => void
}

function SortableLabelRow({
  label,
  disabled,
  isEditing,
  isInProject,
  editName,
  editColor,
  editInputRef,
  onEditNameChange,
  onEditColorChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDeleteGlobally,
  onRemoveFromProject
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

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style}>
        <form
          onSubmit={(e) => { e.preventDefault(); onSaveEdit() }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancelEdit() } }}
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3"
        >
          <div className="flex items-center gap-2">
            <input
              ref={editInputRef}
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              placeholder="Label name"
              autoFocus
              className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted">Color</span>
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onEditColorChange(c)}
                  className={`h-5 w-5 rounded-full ${
                    editColor === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded p-1.5 text-muted transition-colors hover:bg-foreground/6"
              >
                <X size={14} />
              </button>
              <button
                type="submit"
                disabled={!editName.trim()}
                className="rounded p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
              >
                <Check size={14} />
              </button>
            </div>
          </div>
        </form>
      </div>
    )
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
      <div
        className="h-3 w-3 flex-shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="flex-1 text-sm font-light text-foreground">{label.name}</span>
      {/* Usage counts */}
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
        {label.project_count}p / {label.task_count}t
      </span>
      {/* In-project indicator */}
      {isInProject && (
        <span className="text-[9px] text-accent" title="In this project">&#10003;</span>
      )}
      <button
        onClick={onStartEdit}
        className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        title="Edit"
      >
        <Pencil size={12} />
      </button>
      {isInProject && (
        <button
          onClick={onRemoveFromProject}
          className="rounded p-0.5 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
          title="Remove from this project"
        >
          <FolderMinus size={12} />
        </button>
      )}
      <button
        onClick={onDeleteGlobally}
        className="rounded p-0.5 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
        title="Delete everywhere"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
