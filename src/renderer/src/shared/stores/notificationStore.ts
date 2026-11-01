import { hydrationContext } from './hydrationContext'
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
      const { api, isCurrent } = hydrationContext()
      const [notifications, unreadCount] = await Promise.all([
        api.notifications.findAll(50),
        api.notifications.getUnreadCount()
      ])
      if (!await isCurrent()) return
      set({ notifications, unreadCount })
    },

    createNotification: async (input) => {
      const { api, isCurrent } = hydrationContext()
      const notification = await api.notifications.create(input)
      if (!await isCurrent()) return notification
      set((state) => ({
        notifications: [notification, ...state.notifications].slice(0, 50),
        unreadCount: state.unreadCount + 1
      }))
      return notification
    },

    markAsRead: async (id) => {
      const { api, isCurrent } = hydrationContext()
      await api.notifications.markAsRead(id)
      if (!await isCurrent()) return
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: 1 } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1)
      }))
    },

    markAllAsRead: async () => {
      const { api, isCurrent } = hydrationContext()
      await api.notifications.markAllAsRead()
      if (!await isCurrent()) return
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, read: 1 })),
        unreadCount: 0
      }))
    },

    deleteNotification: async (id) => {
      const { api, isCurrent } = hydrationContext()
      await api.notifications.deleteNotification(id)
      if (!await isCurrent()) return
      set((state) => {
        const removed = state.notifications.find((n) => n.id === id)
        return {
          notifications: state.notifications.filter((n) => n.id !== id),
          unreadCount: removed?.read === 0 ? state.unreadCount - 1 : state.unreadCount
        }
      })
    },

    deleteAllNotifications: async () => {
      const { api, isCurrent } = hydrationContext()
      await api.notifications.deleteAll()
      if (!await isCurrent()) return
      set({ notifications: [], unreadCount: 0 })
    },

    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
    closePanel: () => set({ panelOpen: false })
  }),
  shallow
)
