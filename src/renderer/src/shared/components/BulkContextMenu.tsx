import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight, Sun, CircleDot, Signal, Tag, Clock, Clipboard, Trash2
} from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useFocusRestore } from '../hooks/useFocusRestore'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { useTaskStore } from '../stores/taskStore'
import { shouldForceDelete } from '../utils/shiftDelete'
import { useStatusesByProject } from '../stores/statusStore'
import { useLabelsByProject } from '../stores/labelStore'
import { useCreateOrMatchLabel } from '../hooks/useCreateOrMatchLabel'
import {
  StatusSubmenu,
  PrioritySubmenu,
  LabelsSubmenu,
  SnoozeSubmenu
} from './ContextMenuSubmenus'
import { useToast } from './Toast'

type SubmenuId = 'status' | 'priority' | 'labels' | 'snooze' | null

export function BulkContextMenu(): React.JSX.Element | null {
  const { isOpen, isBulk, position, bulkTaskIds, close } = useContextMenuStore()
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuId>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menuPos, setMenuPos] = useState(position)
  const [openLeft, setOpenLeft] = useState(false)

  useFocusRestore()
  useFocusTrap(menuRef, isOpen && isBulk)

  const tasks = useTaskStore((s) => s.tasks)
  const { bulkUpdateTasks, setPendingBulkDeleteTasks, deleteTask, clearSelection } = useTaskStore()
  const { addToast } = useToast()
  const firstTask = bulkTaskIds.length > 0 ? tasks[bulkTaskIds[0]] : null
  const projectId = firstTask?.project_id ?? ''
  const statuses = useStatusesByProject(projectId)
  const allLabels = useLabelsByProject(projectId)
  const createOrMatchLabel = useCreateOrMatchLabel(projectId)

  useEffect(() => {
    if (!isOpen || !isBulk) return
    const menuW = 208
    const menuH = 320
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = Math.min(position.x, vw - menuW - 8)
    const y = Math.min(position.y, vh - menuH - 8)
    setMenuPos({ x: Math.max(4, x), y: Math.max(4, y) })
    setOpenLeft(position.x + menuW + 220 > vw)
    setActiveSubmenu(null)
  }, [isOpen, isBulk, position])

  useEffect(() => {
    if (!isOpen || !isBulk) return
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
  }, [isOpen, isBulk, close])

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

  if (!isOpen || !isBulk || bulkTaskIds.length === 0) return null

  // Check if any selected task is currently in My Day
  const anyInMyDay = bulkTaskIds.some((id) => tasks[id]?.is_in_my_day === 1)

  const handleStatusChange = (statusId: string): void => {
    const st = statuses.find((s) => s.id === statusId)
    const update: { status_id: string; completed_date?: string | null } = { status_id: statusId }
    if (st?.is_done === 1) update.completed_date = new Date().toISOString()
    else update.completed_date = null
    handleAction(() => bulkUpdateTasks(bulkTaskIds, update))
  }

  const handleDelete = (e: React.MouseEvent): void => {
    handleAction(() => {
      if (shouldForceDelete(e)) {
        const ids = [...bulkTaskIds]
        clearSelection()
        for (const id of ids) deleteTask(id)
      } else {
        setPendingBulkDeleteTasks(bulkTaskIds)
      }
    })
  }

  // Build a pseudo-task for PrioritySubmenu (no "current" value in bulk mode)
  const pseudoTask = { priority: -1 } as { priority: number; status_id: string; recurrence_rule: string | null }

  const sortedStatuses = [...statuses].sort((a, b) => a.order_index - b.order_index)

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[10000] w-52 rounded-lg border border-border bg-surface py-1 shadow-xl"
      style={{ left: menuPos.x, top: menuPos.y }}
      role="menu"
      aria-label="Bulk task context menu"
    >
      {/* Header */}
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        {bulkTaskIds.length} tasks selected
      </div>
      <Divider />

      {/* My Day toggle */}
      <MenuItem
        icon={<Sun size={14} />}
        label={anyInMyDay ? 'Remove from My Day' : 'Add to My Day'}
        onClick={() => handleAction(() => bulkUpdateTasks(bulkTaskIds, { is_in_my_day: anyInMyDay ? 0 : 1 }))}
      />
      <Divider />

      {/* Flyout submenus */}
      <FlyoutItem id="status" icon={<CircleDot size={14} />} label="Status" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <StatusSubmenu task={{ status_id: '' } as never} statuses={sortedStatuses} openLeft={openLeft} onStatusChange={handleStatusChange} />
      </FlyoutItem>
      <FlyoutItem id="priority" icon={<Signal size={14} />} label="Priority" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <PrioritySubmenu task={pseudoTask as never} openLeft={openLeft} onPriorityChange={(p) => handleAction(() => bulkUpdateTasks(bulkTaskIds, { priority: p }))} />
      </FlyoutItem>
      <FlyoutItem id="labels" icon={<Tag size={14} />} label="Labels" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <LabelsSubmenu
          allLabels={allLabels}
          assignedLabelIds={new Set<string>()}
          openLeft={openLeft}
          projectId={firstTask?.project_id}
          onToggleLabel={(labelId) => {
            useTaskStore.getState().bulkAddLabel(bulkTaskIds, labelId)
          }}
          onCreateLabel={(name, color) => {
            createOrMatchLabel(name, color)
          }}
        />
      </FlyoutItem>
      <FlyoutItem id="snooze" icon={<Clock size={14} />} label="Snooze" activeSubmenu={activeSubmenu} onEnter={handleSubmenuEnter} onLeave={handleSubmenuLeave}>
        <SnoozeSubmenu openLeft={openLeft} onSnooze={(date) => handleAction(() => bulkUpdateTasks(bulkTaskIds, { due_date: date }))} />
      </FlyoutItem>
      <Divider />

      {/* Copy to clipboard */}
      <MenuItem
        icon={<Clipboard size={14} />}
        label="Copy"
        onClick={() => {
          const titles = bulkTaskIds
            .map((id) => tasks[id]?.title)
            .filter(Boolean) as string[]
          if (titles.length === 0) return
          const text = titles.length === 1 ? titles[0] : titles.map((t) => `- ${t}`).join('\n')
          navigator.clipboard.writeText(text).then(() => {
            addToast({ message: titles.length === 1 ? 'Copied' : `Copied ${titles.length} tasks` })
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
