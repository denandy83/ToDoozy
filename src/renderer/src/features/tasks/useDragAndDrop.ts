import { useState, useCallback, useRef } from 'react'
import {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  UniqueIdentifier,
  CollisionDetection,
  closestCenter,
  pointerWithin,
  rectIntersection
} from '@dnd-kit/core'
import type { Task } from '../../../../shared/types'

export type DropIntent = 'above' | 'inside' | 'below'

export interface DropIndicator {
  targetId: string
  intent: DropIntent
}

export interface DragState {
  activeId: string | null
  activeTask: Task | null
  dropIndicator: DropIndicator | null
  isDragging: boolean
}

interface UseDragAndDropOptions {
  tasks: Record<string, Task>
  onReorder: (taskIds: string[]) => Promise<void>
  onReparent: (taskId: string, newParentId: string | null) => Promise<void>
  onMoveToView?: (taskId: string, viewId: string) => Promise<void>
  getTasksForParent: (parentId: string | null, statusId: string) => Task[]
}

interface UseDragAndDropReturn {
  dragState: DragState
  handleDragStart: (event: DragStartEvent) => void
  handleDragOver: (event: DragOverEvent) => void
  handleDragEnd: (event: DragEndEvent) => void
  handleDragCancel: () => void
  collisionDetection: CollisionDetection
}

function getDropIntent(overRect: DOMRect, pointerY: number): DropIntent {
  const relativeY = pointerY - overRect.top
  const height = overRect.height
  const pct = relativeY / height

  if (pct < 0.2) return 'above'
  if (pct > 0.8) return 'below'
  return 'inside'
}

export function useDragAndDrop({
  tasks,
  onReorder,
  onReparent,
  onMoveToView,
  getTasksForParent
}: UseDragAndDropOptions): UseDragAndDropReturn {
  const [dragState, setDragState] = useState<DragState>({
    activeId: null,
    activeTask: null,
    dropIndicator: null,
    isDragging: false
  })

  const lastOverIdRef = useRef<UniqueIdentifier | null>(null)

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const activeTask = tasks[active.id as string] ?? null
      setDragState({
        activeId: active.id as string,
        activeTask,
        dropIndicator: null,
        isDragging: true
      })
    },
    [tasks]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over, activatorEvent } = event

      if (!over || !dragState.activeId) {
        if (dragState.dropIndicator !== null) {
          setDragState((prev) => ({ ...prev, dropIndicator: null }))
        }
        return
      }

      const overId = over.id as string

      // Skip if hovering over self
      if (overId === dragState.activeId) {
        if (dragState.dropIndicator !== null) {
          setDragState((prev) => ({ ...prev, dropIndicator: null }))
        }
        return
      }

      // Check if this is a sidebar nav drop target
      if (overId.startsWith('nav-')) {
        setDragState((prev) => ({
          ...prev,
          dropIndicator: { targetId: overId, intent: 'inside' }
        }))
        return
      }

      // Calculate drop intent based on pointer position
      const overElement = over.rect
      if (overElement && activatorEvent instanceof PointerEvent) {
        // Use the delta from the event to approximate current pointer Y
        const overRect = {
          top: overElement.top,
          height: overElement.height
        } as DOMRect

        // Get current pointer position from the active event's client coordinates
        const pointerY = (activatorEvent as PointerEvent).clientY + (event.delta?.y ?? 0)
        const intent = getDropIntent(overRect, pointerY)

        setDragState((prev) => ({
          ...prev,
          dropIndicator: { targetId: overId, intent }
        }))
      } else {
        setDragState((prev) => ({
          ...prev,
          dropIndicator: { targetId: overId, intent: 'above' }
        }))
      }

      lastOverIdRef.current = over.id
    },
    [dragState.activeId, dragState.dropIndicator]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      const activeId = active.id as string
      const activeTask = tasks[activeId]

      setDragState({
        activeId: null,
        activeTask: null,
        dropIndicator: null,
        isDragging: false
      })

      if (!over || !activeTask) return

      const overId = over.id as string

      // Handle sidebar nav drops
      if (overId.startsWith('nav-') && onMoveToView) {
        const viewId = overId.replace('nav-', '')
        await onMoveToView(activeId, viewId)
        return
      }

      // Don't drop on self
      if (overId === activeId) return

      const overTask = tasks[overId]
      if (!overTask) return

      // Calculate the intent from the last known drop indicator
      const intent = dragState.dropIndicator?.targetId === overId
        ? dragState.dropIndicator.intent
        : 'above'

      if (intent === 'inside') {
        // Make active task a child of over task
        await onReparent(activeId, overId)
        // Reorder children of the new parent
        const siblings = getTasksForParent(overId, overTask.status_id)
        const newOrder = [...siblings.filter((t) => t.id !== activeId), activeTask]
        await onReorder(newOrder.map((t) => t.id))
      } else {
        // Reorder: place active above or below the over task
        const targetParentId = overTask.parent_id
        const targetStatusId = overTask.status_id

        // If moving to a different parent, reparent first
        if (activeTask.parent_id !== targetParentId) {
          await onReparent(activeId, targetParentId)
        }

        // If moving to a different status, that's handled by reparent/update
        const siblings = getTasksForParent(targetParentId, targetStatusId)
        const filtered = siblings.filter((t) => t.id !== activeId)
        const overIndex = filtered.findIndex((t) => t.id === overId)

        const newOrder = [...filtered]
        const insertIndex = intent === 'above' ? overIndex : overIndex + 1
        newOrder.splice(insertIndex, 0, activeTask)

        await onReorder(newOrder.map((t) => t.id))
      }
    },
    [tasks, dragState.dropIndicator, onReorder, onReparent, onMoveToView, getTasksForParent]
  )

  const handleDragCancel = useCallback(() => {
    setDragState({
      activeId: null,
      activeTask: null,
      dropIndicator: null,
      isDragging: false
    })
  }, [])

  // Custom collision detection: use pointer-within for nav items, closestCenter for tasks
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      // First check pointer-within for sidebar nav items
      const pointerCollisions = pointerWithin(args)
      const navCollisions = pointerCollisions.filter((c) =>
        String(c.id).startsWith('nav-')
      )
      if (navCollisions.length > 0) return navCollisions

      // Then use rectIntersection for task items
      const rectCollisions = rectIntersection(args)
      if (rectCollisions.length > 0) return rectCollisions

      // Fall back to closest center
      return closestCenter(args)
    },
    []
  )

  return {
    dragState,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    collisionDetection
  }
}
