/**
 * Flyout panel listing recent notifications. Click a notification to navigate
 * to the relevant task/project and mark as read.
 */
import { useEffect, useRef } from 'react'
import { X, CheckCheck } from 'lucide-react'
import { useNotificationStore } from '../../shared/stores/notificationStore'
import { useViewStore } from '../../shared/stores/viewStore'
import { useTaskStore } from '../../shared/stores/taskStore'

export function NotificationPanel(): React.JSX.Element | null {
  const panelOpen = useNotificationStore((s) => s.panelOpen)
  const closePanel = useNotificationStore((s) => s.closePanel)
  const notifications = useNotificationStore((s) => s.notifications)
  const markAsRead = useNotificationStore((s) => s.markAsRead)
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!panelOpen) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closePanel()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [panelOpen, closePanel])

  // Close on click outside
  useEffect(() => {
    if (!panelOpen) return
    const handler = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel()
      }
    }
    // Delay to avoid closing immediately on bell click
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [panelOpen, closePanel])

  if (!panelOpen) return null

  const handleNotificationClick = async (n: typeof notifications[0]): Promise<void> => {
    if (n.read === 0) {
      await markAsRead(n.id)
    }
    // Navigate to task if available
    if (n.task_id && n.project_id) {
      useViewStore.setState({ currentView: 'project', selectedProjectId: n.project_id })
      useTaskStore.getState().selectTask(n.task_id)
      closePanel()
    }
  }

  const formatTime = (isoDate: string): string => {
    const diff = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-border bg-background shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Notifications
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => markAllAsRead()}
            className="rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title="Mark all as read"
          >
            <CheckCheck size={14} />
          </button>
          <button
            onClick={closePanel}
            className="rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted">
            <p className="text-sm font-light">No notifications yet</p>
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              className={`flex w-full items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-foreground/6 ${
                n.read === 0 ? 'bg-accent/5' : ''
              }`}
            >
              {n.read === 0 && (
                <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
              )}
              <div className={`flex-1 ${n.read === 0 ? '' : 'pl-5'}`}>
                <p className="text-[13px] font-light leading-tight text-foreground">
                  {n.message}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted">
                  {formatTime(n.created_at)}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
