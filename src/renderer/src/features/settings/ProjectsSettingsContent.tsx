import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Pencil, Plus, X, Check } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useProjectStore, useStatusStore, useAuthStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { StatusList } from '../projects/StatusList'
import { MemberSettings } from '../collaboration/MemberSettings'
import type { Project, Status } from '../../../../shared/types'

interface ProjectsSettingsContentProps {
  projects: Project[]
  selectedProject: Project | null
  selectedProjectId: string | null
  statuses: Status[]
  onProjectChange: (id: string) => void
  onClose: () => void
}

export function ProjectsSettingsContent({
  projects,
  selectedProject,
  selectedProjectId,
  statuses,
  onProjectChange,
  onClose
}: ProjectsSettingsContentProps): React.JSX.Element {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(selectedProject?.name ?? '')
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#6366f1')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const newProjectInputRef = useRef<HTMLInputElement>(null)
  const updateProject = useProjectStore((s) => s.updateProject)
  const createProject = useProjectStore((s) => s.createProject)
  const createStatus = useStatusStore((s) => s.createStatus)
  const currentUser = useAuthStore((s) => s.currentUser)
  const { addToast } = useToast()

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.sidebar_order - b.sidebar_order),
    [projects]
  )
  const projectIds = useMemo(() => sortedProjects.map((p) => p.id), [sortedProjects])

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  const sensors = useSensors(pointerSensor)

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = sortedProjects.findIndex((p) => p.id === active.id)
      const newIndex = sortedProjects.findIndex((p) => p.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = [...sortedProjects]
      const [moved] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, moved)
      const updates = reordered.map((p, i) => ({ id: p.id, sidebar_order: i }))
      await window.api.projects.updateSidebarOrder(updates)
      for (const u of updates) {
        const proj = useProjectStore.getState().projects[u.id]
        if (proj) {
          useProjectStore.setState((state) => ({
            projects: { ...state.projects, [u.id]: { ...proj, sidebar_order: u.sidebar_order } }
          }))
        }
      }
    },
    [sortedProjects]
  )

  useEffect(() => {
    if (addingProject) newProjectInputRef.current?.focus()
  }, [addingProject])

  const handleAddProject = useCallback(async () => {
    const name = newProjectName.trim()
    if (!name || !currentUser) return
    const id = crypto.randomUUID()
    const maxOrder = sortedProjects.reduce((max, p) => Math.max(max, p.sidebar_order ?? 0, sortedProjects.length - 1), 0)
    const project = await createProject({
      id, name, owner_id: currentUser.id, color: newProjectColor, icon: 'folder', is_default: 0, sidebar_order: maxOrder + 1
    })
    await window.api.projects.addMember(id, currentUser.id, 'owner', currentUser.id)
    for (const s of [
      { name: 'Not Started', color: '#888888', icon: 'circle', order_index: 0, is_default: 1, is_done: 0 },
      { name: 'In Progress', color: '#f59e0b', icon: 'clock', order_index: 1, is_default: 0, is_done: 0 },
      { name: 'Done', color: '#22c55e', icon: 'check-circle', order_index: 2, is_default: 0, is_done: 1 }
    ]) {
      await createStatus({ id: crypto.randomUUID(), project_id: id, ...s })
    }
    onProjectChange(project.id)
    setNewProjectName('')
    setNewProjectColor('#6366f1')
    setAddingProject(false)
  }, [newProjectName, newProjectColor, currentUser, sortedProjects, createProject, createStatus, onProjectChange])

  useEffect(() => {
    setNameValue(selectedProject?.name ?? '')
    setEditingName(false)
  }, [selectedProject?.id, selectedProject?.name])

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  const handleSaveName = useCallback(() => {
    const trimmed = nameValue.trim()
    if (trimmed && selectedProjectId && trimmed !== selectedProject?.name) {
      updateProject(selectedProjectId, { name: trimmed })
    }
    setEditingName(false)
  }, [nameValue, selectedProjectId, selectedProject?.name, updateProject])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Project</p>
        <button
          onClick={() => setAddingProject(true)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {addingProject && (
        <AddProjectForm
          ref={newProjectInputRef}
          name={newProjectName}
          color={newProjectColor}
          onNameChange={setNewProjectName}
          onColorChange={setNewProjectColor}
          onSubmit={handleAddProject}
          onCancel={() => setAddingProject(false)}
        />
      )}

      <div className="flex items-center gap-3">
        {selectedProject && <ProjectColorPicker project={selectedProject} />}
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveName()
              if (e.key === 'Escape') { e.stopPropagation(); setEditingName(false); setNameValue(selectedProject?.name ?? '') }
            }}
            className="flex-1 rounded-lg border border-accent bg-background px-3 py-1.5 text-sm text-foreground outline-none"
          />
        ) : (
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => onProjectChange(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {sortedProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setEditingName(!editingName)}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          title="Rename project"
        >
          <Pencil size={12} />
        </button>
      </div>

      {selectedProject && selectedProjectId && (
        <div className="flex flex-col gap-6">
          <StatusList projectId={selectedProjectId} statuses={statuses} />
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Sidebar Order</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-0.5">
                  {sortedProjects.map((p) => (
                    <SortableProjectRow key={p.id} project={p} isSelected={p.id === selectedProjectId} onClick={() => onProjectChange(p.id)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
          {selectedProject.is_shared === 1 && (
            <MemberSettings project={selectedProject} onToast={(msg) => addToast({ message: msg })} />
          )}
          <ProjectDeleteSection project={selectedProject} isLastProject={sortedProjects.length <= 1} onClose={onClose} addToast={addToast} />
        </div>
      )}
    </div>
  )
}

interface AddProjectFormProps {
  name: string
  color: string
  onNameChange: (name: string) => void
  onColorChange: (color: string) => void
  onSubmit: () => void
  onCancel: () => void
}

const AddProjectForm = ({ name, color, onNameChange, onColorChange, onSubmit, onCancel, ref }: AddProjectFormProps & { ref: React.Ref<HTMLInputElement> }): React.JSX.Element => (
  <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
    <input
      ref={ref}
      type="text"
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit()
        if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
      }}
      placeholder="Project name"
      className="rounded border border-border bg-surface px-3 py-1.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
    />
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted">Color</span>
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColorChange(c)}
            className={`h-5 w-5 rounded-full ${color === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onCancel} className="rounded p-1.5 text-muted transition-colors hover:bg-foreground/6"><X size={14} /></button>
        <button onClick={onSubmit} disabled={!name.trim()} className="rounded p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"><Check size={14} /></button>
      </div>
    </div>
  </div>
)

function SortableProjectRow({ project, isSelected, onClick }: { project: Project; isSelected: boolean; onClick: () => void }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors cursor-pointer ${
        isSelected ? 'bg-accent/12 border border-accent/15' : 'border border-transparent hover:bg-foreground/6'
      }`}
      onClick={onClick}
    >
      <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
      <span className="flex-1 truncate text-sm font-light text-foreground">{project.name}</span>
    </div>
  )
}

const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']

function ProjectColorPicker({ project }: { project: Project }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const updateProject = useProjectStore((s) => s.updateProject)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="h-6 w-6 rounded-full ring-2 ring-transparent transition-all hover:ring-foreground/20"
        style={{ backgroundColor: project.color }}
        title="Change color"
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-lg">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { updateProject(project.id, { color: c }); setOpen(false) }}
              className={`h-5 w-5 rounded-full transition-transform ${
                project.color === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-surface' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ProjectDeleteSectionProps {
  project: Project
  isLastProject: boolean
  onClose: () => void
  addToast: (toast: { message: string; variant?: 'default' | 'danger' }) => void
}

function ProjectDeleteSection({ project, isLastProject, onClose, addToast }: ProjectDeleteSectionProps): React.JSX.Element | null {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteProject = useProjectStore((s) => s.deleteProject)

  const handleDelete = async (): Promise<void> => {
    try {
      await deleteProject(project.id)
      addToast({ message: `Deleted "${project.name}"`, variant: 'danger' })
      onClose()
    } catch (err) {
      addToast({ message: err instanceof Error ? err.message : 'Failed to delete project', variant: 'danger' })
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      {!confirmDelete ? (
        <button
          onClick={(e) => { if (!isLastProject) { e.shiftKey ? handleDelete() : setConfirmDelete(true) } }}
          className={`rounded-lg border border-danger/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors ${isLastProject ? 'opacity-30' : 'hover:bg-danger/10'}`}
          title={isLastProject ? "Can't delete the last project" : 'Delete project (Shift+click to skip confirmation)'}
        >
          Delete Project
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm font-light text-danger">Are you sure?</span>
          <button onClick={handleDelete} className="rounded-lg bg-danger px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg">Confirm Delete</button>
          <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:bg-foreground/6">Cancel</button>
        </div>
      )}
    </div>
  )
}
