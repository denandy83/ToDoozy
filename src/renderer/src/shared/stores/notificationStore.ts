import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Notification, CreateNotificationInput } from '../../../../shared/types'

interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  panelOpen: boolean
}

interface NotificationActions {
  hydrate(): Promise<void>
  createNotification(input: CreateNotificationInput): Promise<Notification>
  markAsRead(id: string): Promise<void>
  markAllAsRead(): Promise<void>
  deleteNotification(id: string): Promise<void>
  deleteAllNotifications(): Promise<void>
  togglePanel(): void
  closePanel(): void
}

export const useNotificationStore = createWithEqualityFn<NotificationState & NotificationActions>(
  (set) => ({
    notifications: [],
    unreadCount: 0,
    panelOpen: false,

    hydrate: async () => {
      const [notifications, unreadCount] = await Promise.all([
        window.api.notifications.findAll(50),
        window.api.notifications.getUnreadCount()
      ])
      set({ notifications, unreadCount })
    },

    createNotification: async (input) => {
      const notification = await window.api.notifications.create(input)
      set((state) => ({
        notifications: [notification, ...state.notifications].slice(0, 50),
        unreadCount: state.unreadCount + 1
      }))
      return notification
    },

    markAsRead: async (id) => {
      await window.api.notifications.markAsRead(id)
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: 1 } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1)
      }))
    },

    markAllAsRead: async () => {
      await window.api.notifications.markAllAsRead()
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, read: 1 })),
        unreadCount: 0
      }))
    },

    deleteNotification: async (id) => {
      await window.api.notifications.deleteNotification(id)
      set((state) => {
        const removed = state.notifications.find((n) => n.id === id)
        return {
          notifications: state.notifications.filter((n) => n.id !== id),
          unreadCount: removed?.read === 0 ? state.unreadCount - 1 : state.unreadCount
        }
      })
    },

    deleteAllNotifications: async () => {
      await window.api.notifications.deleteAll()
      set({ notifications: [], unreadCount: 0 })
    },

    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
    closePanel: () => set({ panelOpen: false })
  }),
  shallow
)
