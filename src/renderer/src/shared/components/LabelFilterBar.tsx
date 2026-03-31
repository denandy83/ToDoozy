import { useCallback } from 'react'
import { X } from 'lucide-react'
import {
  useLabelStore,
  useAuthStore,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode
} from '../stores'
import { useToast } from './Toast'
import { shouldForceDelete } from '../utils/shiftDelete'
import type { Label } from '../../../../shared/types'
import type { LabelFilterMode } from '../stores'

interface LabelFilterBarProps {
  labels: Label[]
  projectId?: string
}

export function LabelFilterBar({ labels, projectId }: LabelFilterBarProps): React.JSX.Element | null {
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const { toggleLabelFilter, clearLabelFilters, setFilterMode, removeFromProject } = useLabelStore()
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const { addToast } = useToast()

  const handleRemoveLabel = useCallback(async (label: Label, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!projectId) return

    if (shouldForceDelete(e)) {
      await removeFromProject(projectId, label.id)
      return
    }

    // Count tasks in this project that have this label
    const projects = await window.api.labels.findProjectsUsingLabel(userId, label.id)
    const projectInfo = projects.find((p) => p.project_id === projectId)
    const count = projectInfo?.task_count ?? 0

    const taskMsg = count > 0
      ? `${count} task${count === 1 ? '' : 's'} will lose this label.`
      : 'No tasks use this label.'

    addToast({
      message: `Delete "${label.name}" from this project? ${taskMsg}`,
      persistent: true,
      actions: [
        { label: 'Delete', variant: 'danger', onClick: async () => {
          await removeFromProject(projectId, label.id)
        }},
        { label: 'Cancel', variant: 'muted', onClick: () => {} }
      ]
    })
  }, [projectId, userId, removeFromProject, addToast])

  const handleToggleMode = useCallback(() => {
    const next: LabelFilterMode = filterMode === 'hide' ? 'blur' : 'hide'
    setFilterMode(next)
  }, [filterMode, setFilterMode])

  if (labels.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Labels
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-1">
        {labels.map((label) => {
          const isActive = activeLabelFilters.has(label.id)
          return (
            <span
              key={label.id}
              className="group/chip inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 pr-1 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
              style={{
                backgroundColor: isActive ? `${label.color}30` : `${label.color}15`,
                color: label.color,
                border: `1px solid ${isActive ? label.color : `${label.color}30`}`,
                boxShadow: isActive ? `0 0 0 2px ${label.color}40` : 'none'
              }}
            >
              <button
                onClick={() => toggleLabelFilter(label.id)}
                className="transition-colors"
                aria-pressed={isActive}
                aria-label={`Filter by ${label.name}`}
              >
                {label.name}
              </button>
              {projectId && (
                <button
                  onClick={(e) => handleRemoveLabel(label, e)}
                  className="rounded-full p-0.5 transition-colors hover:bg-black/10"
                  aria-label={`Delete ${label.name} from project`}
                  title="Delete from project"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          )
        })}
      </div>

      {hasActiveFilters && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggleMode}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title={`Filter mode: ${filterMode}. Click to toggle.`}
          >
            {filterMode === 'hide' ? 'Hide' : 'Blur'}
          </button>
          <button
            onClick={clearLabelFilters}
            className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            aria-label="Clear label filters"
            title="Clear filters"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
