import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import { Copy, Trash2, Pencil, Search, Rocket, ChevronRight } from 'lucide-react'
import { useTaskStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useTemplateStore, selectAllProjectTemplates } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { UseTemplateModal } from '../templates/UseTemplateModal'
import { DeployProjectTemplateWizard } from '../templates/DeployProjectTemplateWizard'
import type { Task, ProjectTemplate } from '../../../../shared/types'

export function TemplatesView(): React.JSX.Element {
  const currentUser = useAuthStore((s) => s.currentUser)
  const allTasks = useTaskStore((s) => s.tasks)
  const { deleteTask, setCurrentTask } = useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const allProjects = useProjectStore(selectAllProjects)
  const projectTemplates = useTemplateStore(selectAllProjectTemplates)
  const { deleteProjectTemplate } = useTemplateStore()
  const { addToast } = useToast()
  const containerRef = useRef<HTMLDivElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [useTemplateTask, setUseTemplateTask] = useState<Task | null>(null)
  const [deployTemplate, setDeployTemplate] = useState<ProjectTemplate | null>(null)
  const [editTemplate, setEditTemplate] = useState<ProjectTemplate | null>(null)

  const taskTemplates = useMemo(
    () =>
      Object.values(allTasks)
        .filter((t) => t.is_template === 1 && t.parent_id === null)
        .sort((a, b) => a.order_index - b.order_index),
    [allTasks]
  )

  const filteredTaskTemplates = useMemo(() => {
    if (!searchQuery) return taskTemplates
    const q = searchQuery.toLowerCase()
    return taskTemplates.filter(
      (t) => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    )
  }, [taskTemplates, searchQuery])

  const filteredProjectTemplates = useMemo(() => {
    if (!searchQuery) return projectTemplates
    const q = searchQuery.toLowerCase()
    return projectTemplates.filter((t) => t.name.toLowerCase().includes(q))
  }, [projectTemplates, searchQuery])

  const handleDeleteTaskTemplate = useCallback(
    async (template: Task) => {
      await deleteTask(template.id)
      addToast({ message: 'Template deleted' })
    },
    [deleteTask, addToast]
  )

  const handleDeleteProjectTemplate = useCallback(
    async (template: ProjectTemplate) => {
      await deleteProjectTemplate(template.id)
      addToast({ message: 'Project template deleted' })
    },
    [deleteProjectTemplate, addToast]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const currentTaskId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentTaskId
        ? filteredTaskTemplates.findIndex((t) => t.id === currentTaskId)
        : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, filteredTaskTemplates.length - 1)
          if (filteredTaskTemplates[nextIndex]) setCurrentTask(filteredTaskTemplates[nextIndex].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
          } else {
            setCurrentTask(filteredTaskTemplates[currentIndex - 1].id)
          }
          break
        }
        case 'Enter': {
          if (currentTaskId) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            if (task) setUseTemplateTask(task)
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskIds, filteredTaskTemplates, setCurrentTask, allTasks])

  const noResults =
    filteredTaskTemplates.length === 0 && filteredProjectTemplates.length === 0

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-2">
        <Search size={14} className="text-muted" />
        <input
          type="text"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Task Templates Section */}
        {filteredTaskTemplates.length > 0 && (
          <div>
            <div className="px-6 pb-1 pt-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                Task Templates
              </span>
            </div>
            {filteredTaskTemplates.map((task) => (
              <TaskTemplateRow
                key={task.id}
                task={task}
                subtasks={Object.values(allTasks).filter((t) => t.parent_id === task.id).sort((a, b) => a.order_index - b.order_index)}
                isSelected={selectedTaskIds.has(task.id)}
                onSelect={() => setCurrentTask(task.id)}
                onSelectSubtask={(id) => setCurrentTask(id)}
                onUse={() => setUseTemplateTask(task)}
                onEdit={() => setCurrentTask(task.id)}
                onDelete={() => handleDeleteTaskTemplate(task)}
              />
            ))}
          </div>
        )}

        {/* Project Templates Section */}
        {filteredProjectTemplates.length > 0 && (
          <div>
            <div className="px-6 pb-1 pt-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                Project Templates
              </span>
            </div>
            {filteredProjectTemplates.map((template) => (
              <ProjectTemplateRow
                key={template.id}
                template={template}
                onDeploy={() => setDeployTemplate(template)}
                onEdit={() => setEditTemplate(template)}
                onDelete={() => handleDeleteProjectTemplate(template)}
              />
            ))}
          </div>
        )}

        {noResults && (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="text-center">
              <p className="text-sm font-light text-muted/60">
                {searchQuery ? 'No templates match your search.' : 'No templates yet.'}
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted/40">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Right-click a task to save as template'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Use Template Modal */}
      {useTemplateTask && currentUser && (
        <UseTemplateModal
          template={useTemplateTask}
          projects={allProjects}
          currentUser={currentUser}
          onClose={() => setUseTemplateTask(null)}
        />
      )}

      {/* Deploy Project Template Wizard */}
      {deployTemplate && currentUser && (
        <DeployProjectTemplateWizard
          template={deployTemplate}
          currentUser={currentUser}
          onClose={() => setDeployTemplate(null)}
        />
      )}

      {/* Edit Project Template Wizard */}
      {editTemplate && currentUser && (
        <DeployProjectTemplateWizard
          template={editTemplate}
          currentUser={currentUser}
          onClose={() => setEditTemplate(null)}
          mode="save"
        />
      )}
    </div>
  )
}

// --- Task Template Row ---

interface TaskTemplateRowProps {
  task: Task
  subtasks: Task[]
  isSelected: boolean
  onSelect: () => void
  onSelectSubtask: (taskId: string) => void
  onUse: () => void
  onEdit: () => void
  onDelete: () => void
}

function TaskTemplateRow({
  task,
  subtasks,
  isSelected,
  onSelect,
  onSelectSubtask,
  onUse,
  onEdit,
  onDelete
}: TaskTemplateRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasChildren = subtasks.length > 0

  return (
    <div>
      <div
        onClick={onSelect}
        className={`group flex items-center gap-3 border-b border-border/50 px-6 py-3 transition-colors ${
          isSelected
            ? 'bg-accent/12 border-l-2 border-l-accent/15'
            : 'hover:bg-foreground/6'
        }`}
        role="row"
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((prev) => !prev)
            }}
            className="flex-shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-foreground/6"
          >
            <ChevronRight
              size={14}
              className={`transition-transform motion-safe:duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <LayoutTemplateIcon />
        )}
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-light tracking-tight text-foreground">
            {task.title}
          </span>
          {task.description && (
            <span className="line-clamp-1 text-[11px] font-light text-muted/60">
              {task.description}
            </span>
          )}
          {hasChildren && !expanded && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted/40">
              {subtasks.length} subtask{subtasks.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onUse()
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent hover:bg-accent/10"
            title="Use Template"
          >
            <Copy size={12} />
            Use
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="rounded p-1.5 text-muted hover:bg-foreground/6 hover:text-foreground"
            title="Edit Template"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
            title="Delete Template"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && subtasks.map((sub) => (
        <div
          key={sub.id}
          onClick={(e) => {
            e.stopPropagation()
            onSelectSubtask(sub.id)
          }}
          className="flex cursor-pointer items-center gap-3 border-b border-border/30 py-2 pl-14 pr-6 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          <span className="text-[13px] font-light tracking-tight">
            {sub.title}
          </span>
        </div>
      ))}
    </div>
  )
}

// --- Project Template Row ---

interface ProjectTemplateRowProps {
  template: ProjectTemplate
  onDeploy: () => void
  onEdit: () => void
  onDelete: () => void
}

function countTemplateTasks(tasks: { subtasks: { subtasks: unknown[] }[] }[]): number {
  let count = tasks.length
  for (const t of tasks) count += countTemplateTasks(t.subtasks as typeof tasks)
  return count
}

function ProjectTemplateRow({
  template,
  onDeploy,
  onEdit,
  onDelete
}: ProjectTemplateRowProps): React.JSX.Element {
  const data = useMemo(() => {
    try { return JSON.parse(template.data) as { statuses: unknown[]; labels: unknown[]; tasks: { subtasks: { subtasks: unknown[] }[] }[] } }
    catch { return { statuses: [], labels: [], tasks: [] } }
  }, [template.data])

  const taskCount = useMemo(() => countTemplateTasks(data.tasks), [data.tasks])
  const createdDate = template.created_at ? new Date(template.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

  return (
    <div
      className="group flex items-center gap-3 border-b border-border/50 px-6 py-3 transition-colors hover:bg-foreground/6"
      role="row"
    >
      <div
        className="h-3 w-3 flex-shrink-0 rounded-full"
        style={{ backgroundColor: template.color }}
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-light tracking-tight text-foreground">
          {template.name}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted/50">
          {data.statuses.length} statuses · {data.labels.length} labels · {taskCount} tasks{createdDate ? ` · ${createdDate}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeploy()
          }}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent hover:bg-accent/10"
          title="Deploy Project"
        >
          <Rocket size={12} />
          Deploy
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="rounded p-1.5 text-muted hover:bg-foreground/6 hover:text-foreground"
          title="Edit Template"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
          title="Delete Template"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

function LayoutTemplateIcon(): React.JSX.Element {
  return (
    <div className="flex h-5 w-5 items-center justify-center rounded bg-muted/12">
      <div className="grid h-3 w-3 grid-cols-2 gap-0.5">
        <div className="rounded-sm bg-muted/40" />
        <div className="rounded-sm bg-muted/40" />
        <div className="col-span-2 rounded-sm bg-muted/40" />
      </div>
    </div>
  )
}
