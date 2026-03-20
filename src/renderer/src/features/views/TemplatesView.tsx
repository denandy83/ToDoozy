import { useMemo, useRef, useEffect, useCallback } from 'react'
import { Copy } from 'lucide-react'
import { useTaskStore } from '../../shared/stores'
import { useDefaultStatus } from '../../shared/stores'
import { useProjectStore, selectCurrentProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import type { Task } from '../../../../shared/types'

export function TemplatesView(): React.JSX.Element {
  const currentProject = useProjectStore(selectCurrentProject)
  const projectId = currentProject?.id ?? ''
  const defaultStatus = useDefaultStatus(projectId)
  const currentUser = useAuthStore((s) => s.currentUser)
  const allTasks = useTaskStore((s) => s.tasks)
  const { createTask, setCurrentTask } = useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const { addToast } = useToast()
  const containerRef = useRef<HTMLDivElement>(null)

  const templateTasks = useMemo(
    () =>
      Object.values(allTasks)
        .filter((t) => t.is_template === 1)
        .sort((a, b) => a.order_index - b.order_index),
    [allTasks]
  )

  const handleUseTemplate = useCallback(
    async (template: Task) => {
      if (!currentUser || !defaultStatus) return

      await createTask({
        id: crypto.randomUUID(),
        project_id: template.project_id,
        owner_id: currentUser.id,
        title: template.title,
        status_id: defaultStatus.id,
        priority: template.priority,
        description: template.description,
        order_index: 0,
        is_in_my_day: 0,
        is_template: 0
      })
      addToast({ message: `Created task from "${template.title}"` })
    },
    [currentUser, defaultStatus, createTask, addToast]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const currentTaskId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentTaskId
        ? templateTasks.findIndex((t) => t.id === currentTaskId)
        : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, templateTasks.length - 1)
          if (templateTasks[nextIndex]) setCurrentTask(templateTasks[nextIndex].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
          } else {
            setCurrentTask(templateTasks[currentIndex - 1].id)
          }
          break
        }
        case 'Enter': {
          if (currentTaskId) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            if (task) handleUseTemplate(task)
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskIds, templateTasks, setCurrentTask, allTasks, handleUseTemplate])

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <div className="flex-1 overflow-y-auto">
        {templateTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => setCurrentTask(task.id)}
            className={`group flex items-center gap-3 border-b border-border/50 px-6 py-3 transition-colors ${
              selectedTaskIds.has(task.id)
                ? 'bg-accent/12 border-l-2 border-l-accent/15'
                : 'hover:bg-foreground/6'
            }`}
            role="row"
          >
            <LayoutTemplateIcon />
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-light tracking-tight text-foreground">
                {task.title}
              </span>
              {task.description && (
                <span className="text-[11px] font-light text-muted/60 line-clamp-1">
                  {task.description}
                </span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleUseTemplate(task)
              }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent opacity-0 transition-opacity hover:bg-accent/10 group-hover:opacity-100"
            >
              <Copy size={12} />
              Use Template
            </button>
          </div>
        ))}

        {templateTasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="text-center">
              <p className="text-sm font-light text-muted/60">No templates yet.</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted/40">
                Mark tasks as templates to reuse them
              </p>
            </div>
          </div>
        )}
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
