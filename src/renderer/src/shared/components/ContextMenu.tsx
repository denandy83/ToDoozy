import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight, Sun, SunMedium, Plus, Copy, Clipboard, Trash2,
  CircleDot, Signal, Repeat, Tag, Clock, Focus
} from 'lucide-react'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { useTaskStore, useTaskLabelsHook } from '../stores/taskStore'
import { useStatusesByProject } from '../stores/statusStore'
import { useLabelStore, useLabelsByProject } from '../stores/labelStore'
import { useToast } from './Toast'
import { shouldForceDelete } from '../utils/shiftDelete'
import {
  StatusSubmenu,
  PrioritySubmenu,
  RecurrenceSubmenu,
  LabelsSubmenu,
  SnoozeSubmenu,
  FocusSubmenu
} from './ContextMenuSubmenus'

type SubmenuId = 'status' | 'priority' | 'recurrence' | 'labels' | 'snooze' | 'focus' | null

export function ContextMenu(): React.JSX.Element | null {
  const { isOpen, position, taskId, close } = useContextMenuStore()
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuId>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menuPos, setMenuPos] = useState(position)
  const [openLeft, setOpenLeft] = useState(false)

  const task = useTaskStore((s) => (taskId ? s.tasks[taskId] : null))
  const projectId = task?.project_id ?? ''
  const statuses = useStatusesByProject(projectId)
  const allLabels = useLabelsByProject(projectId)
  const taskLabels = useTaskLabelsHook(taskId ?? '')
  const { updateTask, deleteTask, duplicateTask, setPendingSubtaskParent, setPendingDeleteTask } = useTaskStore()
  const { addToast } = useToast()

  // Viewport clamp positioning
  useEffect(() => {
    if (!isOpen) return
    const menuW = 208 // w-52
    const menuH = 380 // approximate
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = Math.min(position.x, vw - menuW - 8)
    const y = Math.min(position.y, vh - menuH - 8)
    setMenuPos({ x: Math.max(4, x), y: Math.max(4, y) })
    setOpenLeft(position.x + menuW + 220 > vw)
    setActiveSubmenu(null)
  }, [isOpen, position])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, close])

  // Cleanup hover timer
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  const handleSubmenuEnter = useCallback((id: SubmenuId) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setActiveSubmenu(id), 150)
  }, [])

  const handleSubmenuLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setActiveSubmenu(null), 150)
  }, [])

  const handleAction = useCallback(
    async (action: () => Promise<unknown> | void) => {
      await action()
      close()
    },
    [close]
  )

  if (!isOpen || !task) return null

  const assignedLabelIds = new Set(taskLabels.map((l) => l.id))
  const isInMyDay = task.is_in_my_day === 1

  const handleStatusChange = (statusId: string): void => {
    const st = statuses.find((s) => s.id === statusId)
    const update: { status_id: string; completed_date?: string | null } = { status_id: statusId }
    if (st?.is_done === 1) update.completed_date = new Date().toISOString()
    else update.completed_date = null
    handleAction(() => updateTask(task.id, update))
  }

  const handleDelete = (e: React.MouseEvent): void => {
    handleAction(() => {
      if (shouldForceDelete(e)) {
        deleteTask(task.id)
      } else {
        setPendingDeleteTask(task.id)
      }
    })
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[10000] w-52 rounded-lg border border-border bg-surface py-1 shadow-xl"
      style={{ left: menuPos.x, top: menuPos.y }}
      role="menu"
      aria-label="Task context menu"
    >
      {/* Pin/Unpin My Day */}
      <MenuItem
        icon={isInMyDay ? <SunMedium size={14} /> : <Sun size={14} />}
        label={isInMyDay ? 'Remove from My Day' : 'Add to My Day'}
        onClick={() => handleAction(() => updateTask(task.id, { is_in_my_day: isInMyDay ? 0 : 1 }))}
      />
      {/* Add Subtask */}
      <MenuItem
        icon={<Plus size={14} />}
        label="Add Subtask"
        onClick={() =>
          handleAction(() => {
            setPendingSubtaskParent(task.id)
          })
        }
      />
      <Divider />

      {/* Flyout submenus */}
      <FlyoutItem id="status" icon={<CircleDot size={14} />} label="Status" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <StatusSubmenu task={task} statuses={statuses} openLeft={openLeft} onStatusChange={handleStatusChange} />
      </FlyoutItem>
      <FlyoutItem id="priority" icon={<Signal size={14} />} label="Priority" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <PrioritySubmenu task={task} openLeft={openLeft} onPriorityChange={(p) => handleAction(() => updateTask(task.id, { priority: p }))} />
      </FlyoutItem>
      <FlyoutItem id="recurrence" icon={<Repeat size={14} />} label="Recurrence" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <RecurrenceSubmenu task={task} openLeft={openLeft} onRecurrenceChange={(r) => handleAction(() => updateTask(task.id, { recurrence_rule: r }))} />
      </FlyoutItem>
      <FlyoutItem id="labels" icon={<Tag size={14} />} label="Labels" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <LabelsSubmenu
          allLabels={allLabels}
          assignedLabelIds={assignedLabelIds}
          openLeft={openLeft}
          onToggleLabel={(labelId) => {
            if (assignedLabelIds.has(labelId)) {
              useTaskStore.getState().removeLabel(task.id, labelId)
            } else {
              useTaskStore.getState().addLabel(task.id, labelId)
            }
          }}
          onCreateLabel={(name, color) => {
            useLabelStore.getState().createLabel({
              id: crypto.randomUUID(),
              project_id: task.project_id,
              name,
              color
            })
          }}
        />
      </FlyoutItem>
      <FlyoutItem id="snooze" icon={<Clock size={14} />} label="Snooze" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <SnoozeSubmenu openLeft={openLeft} currentDueDate={task.due_date} onSnooze={(date) => handleAction(() => updateTask(task.id, { due_date: date }))} />
      </FlyoutItem>
      <FlyoutItem id="focus" icon={<Focus size={14} />} label="Focus" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <FocusSubmenu openLeft={openLeft} onFocus={(mins) => handleAction(() => { addToast({ message: `Focus: ${mins} min` }) })} />
      </FlyoutItem>
      <Divider />

      {/* Duplicate */}
      <MenuItem
        icon={<Copy size={14} />}
        label="Duplicate"
        onClick={() => handleAction(() => duplicateTask(task.id, crypto.randomUUID()))}
      />
      {/* Copy to clipboard */}
      <MenuItem
        icon={<Clipboard size={14} />}
        label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(task.title).then(() => {
            addToast({ message: 'Copied' })
          }, (err) => {
            console.error('Failed to copy to clipboard:', err)
          })
          close()
        }}
      />
      <Divider />

      {/* Delete */}
      <button
        onClick={handleDelete}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-light text-danger transition-colors hover:bg-danger/10"
        role="menuitem"
      >
        <Trash2 size={14} />
        <span>Delete</span>
      </button>
    </div>,
    document.body
  )
}

// --- Small helper components ---

function Divider(): React.JSX.Element {
  return <div className="my-1 border-t border-border" />
}

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

function MenuItem({ icon, label, onClick }: MenuItemProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
      role="menuitem"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

interface FlyoutItemProps {
  id: SubmenuId
  icon: React.ReactNode
  label: string
  activeSubmenu: SubmenuId
  children: React.ReactNode
  onEnter: (id: SubmenuId) => void
  onLeave: () => void
}

function FlyoutItem({ id, icon, label, activeSubmenu, children, onEnter, onLeave }: FlyoutItemProps): React.JSX.Element {
  return (
    <div
      className="relative"
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={onLeave}
    >
      <div
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm font-light transition-colors ${
          activeSubmenu === id ? 'bg-foreground/6 text-foreground' : 'text-foreground hover:bg-foreground/6'
        }`}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={activeSubmenu === id}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight size={12} className="text-muted" />
      </div>
      {activeSubmenu === id && children}
    </div>
  )
}
