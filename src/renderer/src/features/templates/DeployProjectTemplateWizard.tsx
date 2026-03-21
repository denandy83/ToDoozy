import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, ChevronRight, ChevronLeft } from 'lucide-react'
import { useProjectStore } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import { useTaskStore } from '../../shared/stores'
import { useTemplateStore } from '../../shared/stores'
import { useViewStore } from '../../shared/stores/viewStore'
import { useToast } from '../../shared/components/Toast'
import type {
  ProjectTemplate,
  ProjectTemplateData,
  ProjectTemplateTask,
  User
} from '../../../../shared/types'

interface DeployWizardProps {
  template: ProjectTemplate
  currentUser: User
  onClose: () => void
  mode?: 'deploy' | 'save'
}

type WizardStep = 'name' | 'statuses' | 'labels' | 'tasks' | 'review'
const STEPS: WizardStep[] = ['name', 'statuses', 'labels', 'tasks', 'review']
const STEP_LABELS: Record<WizardStep, string> = {
  name: 'Name & Color',
  statuses: 'Statuses',
  labels: 'Labels',
  tasks: 'Tasks',
  review: 'Review & Create'
}

interface WizardStatus {
  name: string
  color: string
  icon: string
  order_index: number
  is_done: number
  is_default: number
}

interface WizardLabel {
  name: string
  color: string
  order_index: number
}

export function DeployProjectTemplateWizard({
  template,
  currentUser,
  onClose,
  mode = 'deploy'
}: DeployWizardProps): React.JSX.Element {
  const data: ProjectTemplateData = JSON.parse(template.data)

  const [step, setStep] = useState<WizardStep>('name')
  const [projectName, setProjectName] = useState(template.name)
  const [projectColor, setProjectColor] = useState(template.color)
  const [statuses, setStatuses] = useState<WizardStatus[]>(data.statuses)
  const [labels, setLabels] = useState<WizardLabel[]>(data.labels)
  const [tasks, setTasks] = useState<ProjectTemplateTask[]>(data.tasks)
  const [creating, setCreating] = useState(false)

  const { createProject } = useProjectStore()
  const { createProjectTemplate, updateProjectTemplate } = useTemplateStore()
  const { addToast } = useToast()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const stepIndex = STEPS.indexOf(step)
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  const goNext = (): void => {
    if (!isLast) setStep(STEPS[stepIndex + 1])
  }
  const goBack = (): void => {
    if (!isFirst) setStep(STEPS[stepIndex - 1])
  }

  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const projectId = crypto.randomUUID()
      const project = await createProject({
        id: projectId,
        name: projectName,
        color: projectColor,
        owner_id: currentUser.id
      })

      // Add membership
      await window.api.projects.addMember(project.id, currentUser.id, 'owner')

      // Create statuses
      const statusIdMap: Record<number, string> = {}
      let defaultStatusId = ''
      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i]
        const statusId = crypto.randomUUID()
        await window.api.statuses.create({
          id: statusId,
          project_id: project.id,
          name: s.name,
          color: s.color,
          icon: s.icon,
          order_index: s.order_index,
          is_done: s.is_done,
          is_default: s.is_default
        })
        statusIdMap[i] = statusId
        if (s.is_default === 1) defaultStatusId = statusId
      }
      if (!defaultStatusId && statuses.length > 0) {
        defaultStatusId = statusIdMap[0]
      }

      // Create labels
      const labelIdMap: Record<string, string> = {}
      for (const l of labels) {
        const labelId = crypto.randomUUID()
        await window.api.labels.create({
          id: labelId,
          project_id: project.id,
          name: l.name,
          color: l.color
        })
        labelIdMap[l.name.toLowerCase()] = labelId
      }

      // Create tasks recursively
      const createTaskTree = async (
        taskList: ProjectTemplateTask[],
        parentId: string | null
      ): Promise<void> => {
        for (const t of taskList) {
          const taskId = crypto.randomUUID()
          await window.api.tasks.create({
            id: taskId,
            project_id: project.id,
            owner_id: currentUser.id,
            title: t.title,
            status_id: defaultStatusId,
            description: t.description,
            priority: t.priority,
            order_index: t.order_index,
            parent_id: parentId,
            is_template: 0,
            is_in_my_day: 0,
            recurrence_rule: t.recurrence_rule
          })
          // Assign labels
          for (const labelName of t.labels) {
            const labelId = labelIdMap[labelName.toLowerCase()]
            if (labelId) {
              await window.api.tasks.addLabel(taskId, labelId)
            }
          }
          if (t.subtasks.length > 0) {
            await createTaskTree(t.subtasks, taskId)
          }
        }
      }

      await createTaskTree(tasks, null)

      // Hydrate stores for the new project
      await useProjectStore.getState().hydrateProjects(currentUser.id)
      await useStatusStore.getState().hydrateStatuses(project.id)
      await useLabelStore.getState().hydrateLabels(project.id)
      await useTaskStore.getState().hydrateAllForProject(project.id, currentUser.id)

      // Navigate to new project
      useViewStore.getState().setSelectedProject(project.id)
      addToast({ message: `Project "${projectName}" created from template.` })
      onClose()
    } catch (err) {
      console.error('Failed to deploy project template:', err)
      addToast({ message: 'Failed to create project', variant: 'danger' })
    } finally {
      setCreating(false)
    }
  }, [creating, projectName, projectColor, statuses, labels, tasks, currentUser, createProject, addToast, onClose])

  const handleSaveTemplate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const templateData: ProjectTemplateData = { statuses, labels, tasks }
      const dataStr = JSON.stringify(templateData)
      if (template.id && template.created_at) {
        // Update existing template
        await updateProjectTemplate(template.id, { name: projectName, color: projectColor, data: dataStr })
      } else {
        // Create new template
        await createProjectTemplate({
          id: template.id || crypto.randomUUID(),
          name: projectName,
          color: projectColor,
          owner_id: currentUser.id,
          data: dataStr
        })
      }
      addToast({ message: 'Project template saved' })
      onClose()
    } catch (err) {
      console.error('Failed to save project template:', err)
      addToast({ message: 'Failed to save template', variant: 'danger' })
    } finally {
      setCreating(false)
    }
  }, [creating, projectName, projectColor, statuses, labels, tasks, template, currentUser, createProjectTemplate, updateProjectTemplate, addToast, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '80vh' }}
      >
        {/* Step indicators */}
        <div className="flex items-center gap-1 border-b border-border px-6 py-3">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                s === step
                  ? 'bg-accent/12 text-accent'
                  : i < stepIndex
                    ? 'text-foreground/60 hover:bg-foreground/6'
                    : 'text-muted/40'
              }`}
            >
              {STEP_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="h-[400px] overflow-y-auto p-6">
          {step === 'name' && (
            <StepNameColor
              name={projectName}
              color={projectColor}
              onNameChange={setProjectName}
              onColorChange={setProjectColor}
            />
          )}
          {step === 'statuses' && (
            <StepStatuses statuses={statuses} onChange={setStatuses} />
          )}
          {step === 'labels' && (
            <StepLabels labels={labels} onChange={setLabels} />
          )}
          {step === 'tasks' && <StepTasks tasks={tasks} onChange={setTasks} />}
          {step === 'review' && (
            <StepReview
              name={projectName}
              color={projectColor}
              statuses={statuses}
              labels={labels}
              tasks={tasks}
            />
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={goBack}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-foreground/60 transition-colors hover:bg-foreground/6"
              >
                <ChevronLeft size={12} />
                Back
              </button>
            )}
            {isLast ? (
              <button
                onClick={mode === 'save' ? handleSaveTemplate : handleCreate}
                disabled={creating || !projectName.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-40"
              >
                {creating ? (mode === 'save' ? 'Saving...' : 'Creating...') : (mode === 'save' ? 'Save Template' : 'Create Project')}
              </button>
            ) : (
              <button
                onClick={goNext}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80"
              >
                Next
                <ChevronRight size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// --- Step components ---

interface StepNameColorProps {
  name: string
  color: string
  onNameChange: (name: string) => void
  onColorChange: (color: string) => void
}

function StepNameColor({ name, color, onNameChange, onColorChange }: StepNameColorProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Project Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Color
        </label>
        <input
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </div>
    </div>
  )
}

interface StepStatusesProps {
  statuses: WizardStatus[]
  onChange: (statuses: WizardStatus[]) => void
}

function StepStatuses({ statuses, onChange }: StepStatusesProps): React.JSX.Element {
  const handleAdd = (): void => {
    onChange([
      ...statuses,
      {
        name: 'New Status',
        color: '#888888',
        icon: 'circle',
        order_index: statuses.length,
        is_done: 0,
        is_default: 0
      }
    ])
  }

  const handleRemove = (index: number): void => {
    onChange(statuses.filter((_, i) => i !== index))
  }

  const handleUpdate = (index: number, field: keyof WizardStatus, value: string | number): void => {
    const updated = [...statuses]
    updated[index] = { ...updated[index], [field]: value }
    onChange(updated)
  }

  // Canonical order: default first, middle by order_index, done last
  const sortedIndices = statuses
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const aGroup = a.s.is_default === 1 ? 0 : a.s.is_done === 1 ? 2 : 1
      const bGroup = b.s.is_default === 1 ? 0 : b.s.is_done === 1 ? 2 : 1
      if (aGroup !== bGroup) return aGroup - bGroup
      return a.s.order_index - b.s.order_index
    })

  return (
    <div className="flex flex-col gap-3">
      {sortedIndices.map(({ s, i }) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="color"
            value={s.color}
            onChange={(e) => handleUpdate(i, 'color', e.target.value)}
            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <input
            type="text"
            value={s.name}
            onChange={(e) => handleUpdate(i, 'name', e.target.value)}
            className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          />
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted/60">
            {s.is_default === 1 ? 'Default' : s.is_done === 1 ? 'Done' : ''}
          </span>
          {s.is_default !== 1 && s.is_done !== 1 && statuses.filter((st) => st.is_default !== 1 && st.is_done !== 1).length > 1 && (
            <button
              onClick={() => handleRemove(i)}
              className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={handleAdd}
        className="flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
      >
        <Plus size={12} />
        Add Status
      </button>
    </div>
  )
}

interface StepLabelsProps {
  labels: WizardLabel[]
  onChange: (labels: WizardLabel[]) => void
}

function StepLabels({ labels, onChange }: StepLabelsProps): React.JSX.Element {
  const handleAdd = (): void => {
    onChange([
      ...labels,
      { name: 'New Label', color: '#888888', order_index: labels.length }
    ])
  }

  const handleRemove = (index: number): void => {
    onChange(labels.filter((_, i) => i !== index))
  }

  const handleUpdate = (index: number, field: keyof WizardLabel, value: string | number): void => {
    const updated = [...labels]
    updated[index] = { ...updated[index], [field]: value }
    onChange(updated)
  }

  return (
    <div className="flex flex-col gap-3">
      {labels.length === 0 && (
        <p className="text-sm font-light text-muted/60">No labels in this template.</p>
      )}
      {labels.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="color"
            value={l.color}
            onChange={(e) => handleUpdate(i, 'color', e.target.value)}
            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <input
            type="text"
            value={l.name}
            onChange={(e) => handleUpdate(i, 'name', e.target.value)}
            className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => handleRemove(i)}
            className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={handleAdd}
        className="flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
      >
        <Plus size={12} />
        Add Label
      </button>
    </div>
  )
}

interface StepTasksProps {
  tasks: ProjectTemplateTask[]
  onChange: (tasks: ProjectTemplateTask[]) => void
}

function StepTasks({ tasks, onChange }: StepTasksProps): React.JSX.Element {
  const handleRemove = (index: number): void => {
    onChange(tasks.filter((_, i) => i !== index))
  }

  const handleAdd = (): void => {
    onChange([
      ...tasks,
      {
        title: 'New Task',
        description: null,
        priority: 0,
        recurrence_rule: null,
        order_index: tasks.length,
        labels: [],
        subtasks: []
      }
    ])
  }

  const handleUpdate = (index: number, title: string): void => {
    const updated = [...tasks]
    updated[index] = { ...updated[index], title }
    onChange(updated)
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.length === 0 && (
        <p className="text-sm font-light text-muted/60">No tasks in this template.</p>
      )}
      {tasks.map((t, i) => (
        <TaskTreeNode key={i} task={t} depth={0} onRemove={() => handleRemove(i)} onTitleChange={(title) => handleUpdate(i, title)} />
      ))}
      <button
        onClick={handleAdd}
        className="flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
      >
        <Plus size={12} />
        Add Task
      </button>
    </div>
  )
}

interface TaskTreeNodeProps {
  task: ProjectTemplateTask
  depth: number
  onRemove: () => void
  onTitleChange: (title: string) => void
}

function TaskTreeNode({ task, depth, onRemove, onTitleChange }: TaskTreeNodeProps): React.JSX.Element {
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded px-2 py-1 hover:bg-foreground/6"
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        <input
          type="text"
          value={task.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="flex-1 bg-transparent text-sm font-light text-foreground focus:outline-none"
        />
        <button
          onClick={onRemove}
          className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={10} />
        </button>
      </div>
      {task.subtasks.map((st, i) => (
        <TaskTreeNode
          key={i}
          task={st}
          depth={depth + 1}
          onRemove={() => {
            // Read-only removal for subtasks in tree view
          }}
          onTitleChange={() => {
            // Read-only for subtask titles in this view
          }}
        />
      ))}
    </div>
  )
}

interface StepReviewProps {
  name: string
  color: string
  statuses: WizardStatus[]
  labels: WizardLabel[]
  tasks: ProjectTemplateTask[]
}

function StepReview({ name, color, statuses, labels, tasks }: StepReviewProps): React.JSX.Element {
  const countTasks = (taskList: ProjectTemplateTask[]): number => {
    let count = taskList.length
    for (const t of taskList) {
      count += countTasks(t.subtasks)
    }
    return count
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-lg font-light text-foreground">{name}</span>
      </div>
      <div className="flex flex-col gap-2 text-sm font-light text-foreground/70">
        <p>{statuses.length} statuses</p>
        <p>{labels.length} labels</p>
        <p>{countTasks(tasks)} tasks</p>
      </div>
    </div>
  )
}
