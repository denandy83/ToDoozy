/**
 * Bell icon with unread count badge. Click toggles the notification panel.
 */
import { Bell } from 'lucide-react'
import { useNotificationStore } from '../../shared/stores/notificationStore'

export function NotificationBell(): React.JSX.Element {
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const togglePanel = useNotificationStore((s) => s.togglePanel)

  return (
    <button
      onClick={togglePanel}
      className="relative flex items-center justify-center rounded-md p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
      title="Notifications"
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <Bell size={16} />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
