import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Pencil, X, Check, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent, type DragOverEvent } from '@dnd-kit/core'
import { useProjectStore, useStatusStore, useAuthStore } from '../../shared/stores'
import { useProjectAreaStore, selectProjectAreas } from '../../shared/stores/projectAreaStore'
import { useToast } from '../../shared/components/Toast'
import { StatusList } from '../projects/StatusList'
import { MemberSettings } from '../collaboration/MemberSettings'
import { MyDaySection } from './GeneralSettingsContent'
import type { Project, Status } from '../../../../shared/types'
import { shouldForceDelete } from '../../shared/utils/shiftDelete'

interface ProjectsSettingsContentProps {
  projects: Project[]
  selectedProject: Project | null
  selectedProjectId: string | null
  statuses: Status[]
  onProjectChange: (id: string) => void
  onClose: () => void
}

type ProjectsSubtab = 'project' | 'myday' | 'sidebar'

export function ProjectsSettingsContent({
  projects,
  selectedProject,
  selectedProjectId,
  statuses,
  onProjectChange,
  onClose
}: ProjectsSettingsContentProps): React.JSX.Element {
  const [subtab, setSubtab] = useState<ProjectsSubtab>('project')
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(selectedProject?.name ?? '')
  const [editColor, setEditColor] = useState(selectedProject?.color ?? '#6366f1')
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
    setEditColor(selectedProject?.color ?? '#6366f1')
    setEditingName(false)
  }, [selectedProject?.id, selectedProject?.name, selectedProject?.color])

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  const handleSaveEdit = useCallback(() => {
    const trimmed = nameValue.trim()
    if (trimmed && selectedProjectId) {
      const updates: Partial<Project> = {}
      if (trimmed !== selectedProject?.name) updates.name = trimmed
      if (editColor !== selectedProject?.color) updates.color = editColor
      if (Object.keys(updates).length > 0) updateProject(selectedProjectId, updates)
    }
    setEditingName(false)
  }, [nameValue, editColor, selectedProjectId, selectedProject?.name, selectedProject?.color, updateProject])

  const handleCancelEdit = useCallback(() => {
    setNameValue(selectedProject?.name ?? '')
    setEditColor(selectedProject?.color ?? '#6366f1')
    setEditingName(false)
  }, [selectedProject?.name, selectedProject?.color])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4 border-b border-border">
        <button
          onClick={() => setSubtab('project')}
          className={`px-1 pb-2 text-[11px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
            subtab === 'project' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground/80'
          }`}
        >
          Project Settings
        </button>
        <button
          onClick={() => setSubtab('myday')}
          className={`px-1 pb-2 text-[11px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
            subtab === 'myday' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground/80'
          }`}
        >
          My Day
        </button>
        <button
          onClick={() => setSubtab('sidebar')}
          className={`px-1 pb-2 text-[11px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
            subtab === 'sidebar' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground/80'
          }`}
        >
          Sidebar & Folders
        </button>
      </div>

      {subtab === 'project' && (
        <>
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

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Project</span>
            <div className="relative">
              {selectedProject && (
                <div
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: selectedProject.color }}
                />
              )}
              <select
                value={selectedProjectId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') { setAddingProject(true); return }
                  onProjectChange(e.target.value)
                }}
                className="min-w-[8rem] max-w-xs truncate rounded-lg border border-border bg-background pl-7 pr-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
              >
                {sortedProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="__new__">+ New Project...</option>
              </select>
            </div>
            <button
              onClick={() => { setEditingName(!editingName); setNameValue(selectedProject?.name ?? ''); setEditColor(selectedProject?.color ?? '#6366f1') }}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
              title="Edit project name & color"
            >
              <Pencil size={12} />
            </button>
          </div>

          {editingName && selectedProject && (
            <form
              onSubmit={(e) => { e.preventDefault(); handleSaveEdit() }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); handleCancelEdit() } }}
              className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3"
            >
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder="Project name"
                autoFocus
                className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted">Color</span>
                  {PROJECT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditColor(c)}
                      className={`h-5 w-5 rounded-full ${
                        editColor === c ? 'ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={handleCancelEdit} className="rounded p-1.5 text-muted transition-colors hover:bg-foreground/6"><X size={14} /></button>
                  <button type="submit" disabled={!nameValue.trim()} className="rounded p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"><Check size={14} /></button>
                </div>
              </div>
            </form>
          )}

          {selectedProject && selectedProjectId && (
            <div className="flex flex-col gap-6">
              <StatusList projectId={selectedProjectId} statuses={statuses} />

              {/* Auto-Archive Settings */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">Auto-Archive</h4>
                {selectedProject.is_shared === 1 ? (
                  <p className="text-xs font-light text-muted">
                    Auto-archive is not available for shared projects. Tasks must be archived manually.
                  </p>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-light text-foreground">Archive after done</p>
                      <p className="text-[10px] text-muted">Automatically archive completed tasks</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedProject.auto_archive_enabled === 1 && (
                        <>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={selectedProject.auto_archive_value ?? 3}
                            onChange={(e) => updateProject(selectedProjectId, { auto_archive_value: parseInt(e.target.value, 10) || 3 })}
                            className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <select
                            value={selectedProject.auto_archive_unit ?? 'days'}
                            onChange={(e) => updateProject(selectedProjectId, { auto_archive_unit: e.target.value })}
                            className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
                          >
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                          </select>
                        </>
                      )}
                      <div className="flex rounded-lg border border-border overflow-hidden">
                        <button
                          onClick={() => updateProject(selectedProjectId, { auto_archive_enabled: 1 })}
                          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                            selectedProject.auto_archive_enabled === 1 ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
                          }`}
                        >
                          On
                        </button>
                        <button
                          onClick={() => updateProject(selectedProjectId, { auto_archive_enabled: 0 })}
                          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                            selectedProject.auto_archive_enabled !== 1 ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
                          }`}
                        >
                          Off
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {selectedProject.is_shared === 1 && (
                <MemberSettings project={selectedProject} onToast={(msg) => addToast({ message: msg })} />
              )}
              <ProjectDeleteSection project={selectedProject} isLastProject={sortedProjects.length <= 1} onClose={onClose} addToast={addToast} />
            </div>
          )}
        </>
      )}

      {subtab === 'myday' && <MyDaySection />}

      {subtab === 'sidebar' && (
        <SidebarOrderSection
          projects={sortedProjects}
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
          sensors={sensors}
          handleDragEnd={handleDragEnd}
        />
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

type DropIntent = 'above' | 'below' | 'inside'
interface SidebarDropIndicator { targetId: string; intent: DropIntent }

function SidebarOrderSection({ projects, selectedProjectId, onProjectChange, sensors, handleDragEnd: handleProjectDragEnd }: {
  projects: Project[]
  selectedProjectId: string | null
  onProjectChange: (id: string) => void
  sensors: ReturnType<typeof useSensors>
  handleDragEnd: (event: DragEndEvent) => void
}): React.JSX.Element {
  const areas = useProjectAreaStore(selectProjectAreas)
  const { assignProject, createArea, deleteArea, updateArea } = useProjectAreaStore()
  const currentUser = useAuthStore((s) => s.currentUser)
  const sortedAreas = useMemo(() => [...areas].sort((a, b) => a.sidebar_order - b.sidebar_order), [areas])
  const ungrouped = useMemo(() => projects.filter((p) => !p.area_id), [projects])
  const updateProject = useProjectStore((s) => s.updateProject)

  // Folder management state
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const newFolderRef = useRef<HTMLInputElement>(null)

  const handleRenameArea = useCallback(async (areaId: string) => {
    const name = editValue.trim()
    if (name) await updateArea(areaId, { name })
    setEditingAreaId(null)
  }, [editValue, updateArea])

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name || !currentUser) return
    // Bump all existing top-level items down by 1 to make room at position 0
    for (const p of projects.filter((p) => !p.area_id)) {
      await updateProject(p.id, { sidebar_order: p.sidebar_order + 1 })
    }
    for (const a of sortedAreas) {
      await window.api.projectAreas.update(a.id, { sidebar_order: a.sidebar_order + 1 })
    }
    const area = await createArea(currentUser.id, name)
    await window.api.projectAreas.update(area.id, { sidebar_order: 0 })
    // Re-hydrate to pick up the updated order
    await useProjectAreaStore.getState().hydrate(currentUser.id)
    setNewFolderName('')
    setShowNewFolder(false)
  }, [newFolderName, currentUser, createArea, projects, sortedAreas, updateProject])

  useEffect(() => {
    if (editingAreaId) requestAnimationFrame(() => editInputRef.current?.focus())
  }, [editingAreaId])

  useEffect(() => {
    if (showNewFolder) requestAnimationFrame(() => newFolderRef.current?.focus())
  }, [showNewFolder])

  // Build interleaved flat list
  type SidebarOrderItem = { id: string; type: 'project' | 'area'; data: Project | typeof sortedAreas[0] }
  const items = useMemo((): SidebarOrderItem[] => {
    const topLevel: Array<SidebarOrderItem & { order: number }> = []
    for (const p of ungrouped) topLevel.push({ id: p.id, type: 'project', order: p.sidebar_order, data: p })
    for (const a of sortedAreas) topLevel.push({ id: `area:${a.id}`, type: 'area', order: a.sidebar_order, data: a })
    topLevel.sort((a, b) => a.order - b.order)
    const list: SidebarOrderItem[] = []
    for (const item of topLevel) {
      list.push({ id: item.id, type: item.type, data: item.data })
      if (item.type === 'area') {
        const areaId = (item.data as typeof sortedAreas[0]).id
        for (const p of projects.filter((p) => p.area_id === areaId).sort((a, b) => a.sidebar_order - b.sidebar_order)) {
          list.push({ id: p.id, type: 'project', data: p })
        }
      }
    }
    return list
  }, [ungrouped, sortedAreas, projects])

  // Drag state — items DON'T move, ghost + accent line only
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<SidebarDropIndicator | null>(null)
  const dropIndicatorRef = useRef<SidebarDropIndicator | null>(null)
  const pointerXRef = useRef(0)
  const pointerYRef = useRef(0)
  const lastOverIdRef = useRef<string | null>(null)
  const pointerMoveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Horizontal threshold (px from container left) — matches pl-8 indent of grouped projects
  const INDENT_THRESHOLD = 32

  const cleanupPointer = useCallback(() => { if (pointerMoveRef.current) { window.removeEventListener('pointermove', pointerMoveRef.current); pointerMoveRef.current = null } }, [])

  const isPointerIndented = useCallback((): boolean => {
    if (!containerRef.current) return false
    const containerLeft = containerRef.current.getBoundingClientRect().left
    return (pointerXRef.current - containerLeft) > INDENT_THRESHOLD
  }, [])

  // Determine if the target is folder-related (area header or grouped project)
  const getTargetAreaId = useCallback((overId: string): string | null => {
    if (overId.startsWith('area:')) return overId.slice(5)
    const target = projects.find((p) => p.id === overId)
    return target?.area_id ?? null
  }, [projects])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveItemId(String(event.active.id))
    cleanupPointer()
    const handler = (e: PointerEvent): void => { pointerXRef.current = e.clientX; pointerYRef.current = e.clientY }
    pointerMoveRef.current = handler
    window.addEventListener('pointermove', handler)
  }, [cleanupPointer])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!event.over) { setDropIndicator(null); dropIndicatorRef.current = null; return }
    const overId = String(event.over.id)
    if (overId === activeItemId) { setDropIndicator(null); dropIndicatorRef.current = null; return }

    const overRect = event.over.rect
    const midY = overRect.top + overRect.height / 2
    const yIntent: 'above' | 'below' = pointerYRef.current < midY ? 'above' : 'below'

    // Horizontal detection: if target is folder-related and cursor is indented → 'inside'
    const targetAreaId = getTargetAreaId(overId)
    const indented = isPointerIndented()
    const intent: DropIntent = (targetAreaId && indented) ? 'inside' : yIntent

    const ind: SidebarDropIndicator = { targetId: overId, intent }
    dropIndicatorRef.current = ind
    setDropIndicator(ind)
    lastOverIdRef.current = overId
  }, [activeItemId, getTargetAreaId, isPointerIndented])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    const saved = dropIndicatorRef.current
    cleanupPointer()
    setActiveItemId(null); setDropIndicator(null); dropIndicatorRef.current = null; lastOverIdRef.current = null

    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const intent = saved?.targetId === overId ? saved.intent : 'above'

    // 'inside' intent → assign project to the target's folder
    if (!activeId.startsWith('area:') && intent === 'inside') {
      const targetAreaId = getTargetAreaId(overId)
      if (targetAreaId) {
        await assignProject(activeId, targetAreaId)
        return
      }
    }

    // Build current top-level order
    const topLevel: Array<{ id: string; isArea: boolean }> = []
    for (const p of projects.filter((p) => !p.area_id).sort((a, b) => a.sidebar_order - b.sidebar_order)) topLevel.push({ id: p.id, isArea: false })
    for (const a of sortedAreas) topLevel.push({ id: `area:${a.id}`, isArea: true })
    topLevel.sort((a, b) => {
      const oA = a.isArea ? (sortedAreas.find((ar) => `area:${ar.id}` === a.id)?.sidebar_order ?? 0) : (projects.find((p) => p.id === a.id)?.sidebar_order ?? 0)
      const oB = b.isArea ? (sortedAreas.find((ar) => `area:${ar.id}` === b.id)?.sidebar_order ?? 0) : (projects.find((p) => p.id === b.id)?.sidebar_order ?? 0)
      return oA - oB
    })

    // Grouped project dragged with non-inside intent → unassign (pull out of folder)
    const draggedProject = projects.find((p) => p.id === activeId)
    if (draggedProject?.area_id && intent !== 'inside') {
      await assignProject(activeId, null)
      if (!topLevel.find((t) => t.id === activeId)) topLevel.push({ id: activeId, isArea: false })
    }

    // Reorder top-level (find positions using overId — for grouped targets, use the area header)
    let reorderOverId = overId
    if (!overId.startsWith('area:')) {
      const target = projects.find((p) => p.id === overId)
      if (target?.area_id) reorderOverId = `area:${target.area_id}`
    }

    const oldIdx = topLevel.findIndex((t) => t.id === (activeId.startsWith('area:') ? activeId : activeId))
    const overIdx = topLevel.findIndex((t) => t.id === reorderOverId)
    if (oldIdx === -1 || overIdx === -1) return
    const reordered = topLevel.filter((t) => t.id !== topLevel[oldIdx].id)
    const insertAt = intent === 'below' ? Math.min(overIdx, reordered.length) : Math.max(0, overIdx > oldIdx ? overIdx - 1 : overIdx)
    reordered.splice(insertAt, 0, topLevel[oldIdx])

    for (let i = 0; i < reordered.length; i++) {
      const item = reordered[i]
      if (item.isArea) await window.api.projectAreas.update(item.id.slice(5), { sidebar_order: i })
      else await updateProject(item.id, { sidebar_order: i })
    }
  }, [sortedAreas, assignProject, projects, cleanupPointer, handleProjectDragEnd, updateProject, getTargetAreaId])

  const handleDragCancel = useCallback(() => {
    cleanupPointer(); setActiveItemId(null); setDropIndicator(null); dropIndicatorRef.current = null
  }, [cleanupPointer])

  // Find the active item for the drag overlay ghost
  const activeItem = activeItemId ? items.find((i) => i.id === activeItemId) : null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div ref={containerRef} className="flex flex-col gap-0.5">
        {/* New folder input */}
        {showNewFolder ? (
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1">
            <FolderOpen size={14} className="flex-shrink-0 text-muted" />
            <input
              ref={newFolderRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) handleCreateFolder()
                if (e.key === 'Escape') { e.stopPropagation(); setShowNewFolder(false); setNewFolderName('') }
              }}
              onBlur={() => { if (!newFolderName.trim()) { setShowNewFolder(false); setNewFolderName('') } }}
              placeholder="Folder name..."
              className="flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted/50 focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          >
            <Plus size={14} />
            <span className="text-[11px] font-bold uppercase tracking-widest">New Folder</span>
          </button>
        )}
        {items.map((item) => {
          if (item.type === 'area') {
            const area = item.data as typeof sortedAreas[0]
            return (
              <DraggableAreaRow
                key={item.id}
                id={item.id}
                area={area}
                dropIndicator={dropIndicator}
                isDragging={activeItemId === item.id}
                editing={editingAreaId === area.id}
                editValue={editValue}
                inputRef={editingAreaId === area.id ? editInputRef : undefined}
                onStartEdit={() => { setEditingAreaId(area.id); setEditValue(area.name) }}
                onEditChange={setEditValue}
                onSubmitEdit={() => handleRenameArea(area.id)}
                onCancelEdit={() => setEditingAreaId(null)}
                onDelete={() => deleteArea(area.id)}
              />
            )
          }
          const project = item.data as Project
          return (
            <DraggableProjectRow
              key={item.id}
              project={project}
              isSelected={project.id === selectedProjectId}
              onClick={() => onProjectChange(project.id)}
              indented={!!project.area_id}
              dropIndicator={dropIndicator}
              isDragging={activeItemId === project.id}
            />
          )
        })}
      </div>

      {/* Ghost overlay — follows cursor, items stay in place */}
      <DragOverlay dropAnimation={null}>
        {activeItem && (
          <div className="rounded-lg border border-accent/30 bg-surface px-2 py-1.5 shadow-lg opacity-90">
            {activeItem.type === 'area' ? (
              <div className="flex items-center gap-2">
                <FolderOpen size={14} style={{ color: (activeItem.data as typeof sortedAreas[0]).color }} />
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted">{(activeItem.data as typeof sortedAreas[0]).name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: (activeItem.data as Project).color }} />
                <span className="text-sm font-light text-foreground">{(activeItem.data as Project).name}</span>
              </div>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/* ── Draggable rows (items don't move, only ghost + indicator) ── */

function DraggableAreaRow({ id, area, dropIndicator, isDragging, editing, editValue, inputRef, onStartEdit, onEditChange, onSubmitEdit, onCancelEdit, onDelete }: {
  id: string; area: { name: string; color: string }; dropIndicator: SidebarDropIndicator | null; isDragging: boolean
  editing: boolean; editValue: string; inputRef?: React.RefObject<HTMLInputElement | null>
  onStartEdit: () => void; onEditChange: (v: string) => void; onSubmitEdit: () => void; onCancelEdit: () => void; onDelete: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id })
  const { setNodeRef: setDropRef } = useDroppable({ id })
  const ref = useCallback((el: HTMLElement | null) => { setDragRef(el); setDropRef(el) }, [setDragRef, setDropRef])
  const { addToast } = useToast()
  const isDropAbove = dropIndicator?.targetId === id && dropIndicator.intent === 'above'
  const isDropBelow = dropIndicator?.targetId === id && dropIndicator.intent === 'below'
  const isDropInside = dropIndicator?.targetId === id && dropIndicator.intent === 'inside'

  return (
    <div
      ref={ref}
      {...attributes}
      {...(editing ? {} : listeners)}
      className={`group/area relative flex items-center gap-2 rounded-lg px-2 py-1.5 mt-2 mb-0.5 border transition-all ${
        editing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'
      } ${
        isDragging ? 'opacity-30' :
        isDropInside ? 'bg-accent/15 border-accent/30 scale-[1.01]' : 'border-transparent hover:border-border/50 hover:bg-foreground/4'
      }`}
    >
      {isDropAbove && <div className="absolute left-0 right-0 top-0 z-10 h-0.5 bg-accent" />}
      {isDropBelow && <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-accent" />}
      <FolderOpen size={14} className="flex-shrink-0" style={{ color: area.color }} />
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onSubmitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitEdit()
            if (e.key === 'Escape') onCancelEdit()
          }}
          className="flex-1 bg-transparent text-[11px] font-bold uppercase tracking-widest text-muted focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-muted" onDoubleClick={onStartEdit}>{area.name}</span>
      )}
      {!editing && !isDragging && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/area:opacity-100">
          <button onClick={onStartEdit} className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground">
            <Pencil size={10} />
          </button>
          <button
            onClick={(e) => {
              if (shouldForceDelete(e)) {
                onDelete()
              } else {
                addToast({
                  message: `Delete folder "${area.name}"?`,
                  persistent: true,
                  actions: [
                    { label: 'Delete', variant: 'danger', onClick: () => onDelete() },
                    { label: 'Cancel', variant: 'muted', onClick: () => {} }
                  ]
                })
              }
            }}
            className="rounded p-0.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  )
}

function DraggableProjectRow({ project, isSelected, onClick, indented, dropIndicator, isDragging }: {
  project: Project; isSelected: boolean; onClick: () => void; indented?: boolean
  dropIndicator: SidebarDropIndicator | null; isDragging: boolean
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: project.id })
  const { setNodeRef: setDropRef } = useDroppable({ id: project.id })
  const ref = useCallback((el: HTMLElement | null) => { setDragRef(el); setDropRef(el) }, [setDragRef, setDropRef])
  const isDropAbove = dropIndicator?.targetId === project.id && dropIndicator.intent === 'above'
  const isDropBelow = dropIndicator?.targetId === project.id && dropIndicator.intent === 'below'
  const isDropInside = dropIndicator?.targetId === project.id && dropIndicator.intent === 'inside'

  return (
    <div
      ref={ref}
      {...attributes}
      {...listeners}
      className={`group relative flex items-center gap-2 rounded-lg py-1.5 transition-colors cursor-grab active:cursor-grabbing ${
        indented ? 'pl-8 pr-2' : 'px-2'
      } ${
        isDragging ? 'opacity-30' :
        isDropInside ? 'bg-accent/15 border border-accent/30' :
        isSelected ? 'bg-accent/12 border border-accent/15' : 'border border-transparent hover:bg-foreground/6'
      }`}
      onClick={isDragging ? undefined : onClick}
    >
      {isDropAbove && <div className="absolute left-0 right-0 top-0 z-10 h-0.5 bg-accent" />}
      {isDropBelow && <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-accent" />}
      <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
      <span className="flex-1 truncate text-sm font-light text-foreground">{project.name}</span>
    </div>
  )
}

const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']

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
