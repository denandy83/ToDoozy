import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTaskStore } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import { useViewStore } from '../../shared/stores/viewStore'
import { useToast } from '../../shared/components/Toast'
import type { Task, Project, User } from '../../../../shared/types'

interface UseTemplateModalProps {
  template: Task
  projects: Project[]
  currentUser: User
  onClose: () => void
}

export function UseTemplateModal({
  template,
  projects,
  currentUser,
  onClose
}: UseTemplateModalProps): React.JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState(
    projects[0]?.id ?? ''
  )
  const { createTask, addLabel, setCurrentTask } = useTaskStore()
  const { addToast } = useToast()

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleUse = useCallback(async () => {
    if (!selectedProjectId) return

    const targetStatuses = Object.values(useStatusStore.getState().statuses).filter(
      (s) => s.project_id === selectedProjectId
    )
    const defaultStatus =
      targetStatuses.find((s) => s.is_default === 1) ?? targetStatuses[0]
    if (!defaultStatus) return

    // Get template labels
    const templateLabels = useTaskStore.getState().taskLabels[template.id] ?? []

    // Get or create labels globally, then link to target project
    const allLabels = Object.values(useLabelStore.getState().labels)
    const labelIdMap: Record<string, string> = {}

    for (const tl of templateLabels) {
      const existing = allLabels.find(
        (l) => l.name.toLowerCase() === tl.name.toLowerCase()
      )
      if (existing) {
        labelIdMap[tl.id] = existing.id
        // Ensure label is linked to target project
        await useLabelStore.getState().addToProject(selectedProjectId, existing.id)
      } else {
        // Auto-create new global label linked to target project
        const newLabel = await useLabelStore.getState().createLabel({
          id: crypto.randomUUID(),
          user_id: currentUser.id,
          project_id: selectedProjectId,
          name: tl.name,
          color: tl.color
        })
        labelIdMap[tl.id] = newLabel.id
      }
    }

    // Create the task
    const newTaskId = crypto.randomUUID()
    const newTask = await createTask({
      id: newTaskId,
      project_id: selectedProjectId,
      owner_id: currentUser.id,
      title: template.title,
      status_id: defaultStatus.id,
      priority: template.priority,
      description: template.description,
      order_index: 0,
      is_in_my_day: 0,
      is_template: 0,
      recurrence_rule: template.recurrence_rule
    })

    // Add labels
    for (const tl of templateLabels) {
      const targetLabelId = labelIdMap[tl.id]
      if (targetLabelId) {
        await addLabel(newTask.id, targetLabelId)
      }
    }

    // Recursively create subtasks
    await createSubtasksFromTemplate(
      template.id,
      newTask.id,
      selectedProjectId,
      defaultStatus.id,
      currentUser.id,
      labelIdMap
    )

    // Navigate to the new task
    useViewStore.getState().setSelectedProject(selectedProjectId)
    setCurrentTask(newTask.id)
    addToast({ message: 'Task created from template.' })
    onClose()
  }, [selectedProjectId, template, currentUser, createTask, addLabel, setCurrentTask, addToast, onClose])

  const createSubtasksFromTemplate = async (
    templateParentId: string,
    newParentId: string,
    projectId: string,
    defaultStatusId: string,
    ownerId: string,
    labelIdMap: Record<string, string>
  ): Promise<void> => {
    const allTasks = useTaskStore.getState().tasks
    const subtasks = Object.values(allTasks)
      .filter((t) => t.parent_id === templateParentId && t.is_template === 1)
      .sort((a, b) => a.order_index - b.order_index)

    for (const st of subtasks) {
      const newSubId = crypto.randomUUID()
      await createTask({
        id: newSubId,
        project_id: projectId,
        owner_id: ownerId,
        title: st.title,
        status_id: defaultStatusId,
        priority: st.priority,
        description: st.description,
        parent_id: newParentId,
        order_index: st.order_index,
        is_in_my_day: 0,
        is_template: 0,
        recurrence_rule: st.recurrence_rule
      })

      // Copy subtask labels
      const stLabels = useTaskStore.getState().taskLabels[st.id] ?? []
      for (const sl of stLabels) {
        const targetLabelId = labelIdMap[sl.id]
        if (targetLabelId) {
          await addLabel(newSubId, targetLabelId)
        }
      }

      // Recursive
      await createSubtasksFromTemplate(
        st.id,
        newSubId,
        projectId,
        defaultStatusId,
        ownerId,
        labelIdMap
      )
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Use Template
        </h2>
        <p className="mb-4 text-sm font-light text-foreground">
          Create &ldquo;{template.title}&rdquo; in:
        </p>

        {/* Project picker */}
        <div className="mb-6">
          <div className="flex flex-col gap-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-light transition-colors ${
                  selectedProjectId === project.id
                    ? 'bg-accent/12 text-foreground'
                    : 'text-foreground/70 hover:bg-foreground/6'
                }`}
              >
                <div
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                {project.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
          >
            Cancel
          </button>
          <button
            onClick={handleUse}
            disabled={!selectedProjectId || !selectedProject}
            className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
