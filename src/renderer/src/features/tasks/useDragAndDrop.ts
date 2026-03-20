import { useState, useCallback, useRef } from 'react'
import {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  UniqueIdentifier,
  CollisionDetection,
  closestCenter,
  pointerWithin
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
  onStatusChange?: (taskId: string, newStatusId: string) => Promise<void>
  onBucketDrop?: (taskId: string, bucketKey: string) => Promise<void>
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

function getAboveOrBelow(overRect: DOMRect, pointerY: number): 'above' | 'below' {
  const midY = overRect.top + overRect.height / 2
  return pointerY < midY ? 'above' : 'below'
}

export function useDragAndDrop({
  tasks,
  onReorder,
  onReparent,
  onMoveToView,
  onStatusChange,
  onBucketDrop,
  getTasksForParent
}: UseDragAndDropOptions): UseDragAndDropReturn {
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange
  const [dragState, setDragState] = useState<DragState>({
    activeId: null,
    activeTask: null,
    dropIndicator: null,
    isDragging: false
  })

  const lastOverIdRef = useRef<UniqueIdentifier | null>(null)
  const dropIndicatorRef = useRef<DropIndicator | null>(null)
  const pointerYRef = useRef<number>(0)
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track actual pointer position via native event
  const pointerMoveHandler = useRef<((e: PointerEvent) => void) | null>(null)

  const cleanupPointerListener = useCallback(() => {
    if (pointerMoveHandler.current) {
      window.removeEventListener('pointermove', pointerMoveHandler.current)
      pointerMoveHandler.current = null
    }
  }, [])

  const clearDwellTimer = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = null
    }
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const activeTask = tasks[active.id as string] ?? null

      // Track live pointer position
      cleanupPointerListener()
      const handler = (e: PointerEvent): void => {
        pointerYRef.current = e.clientY
      }
      pointerMoveHandler.current = handler
      window.addEventListener('pointermove', handler)

      setDragState({
        activeId: active.id as string,
        activeTask,
        dropIndicator: null,
        isDragging: true
      })
    },
    [tasks, cleanupPointerListener]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event

      if (!over || !dragState.activeId) {
        clearDwellTimer()
        if (dragState.dropIndicator !== null) {
          setDragState((prev) => ({ ...prev, dropIndicator: null }))
        }
        return
      }

      const overId = over.id as string

      // Skip if hovering over self
      if (overId === dragState.activeId) {
        clearDwellTimer()
        if (dragState.dropIndicator !== null) {
          setDragState((prev) => ({ ...prev, dropIndicator: null }))
        }
        return
      }

      // Check if this is a sidebar nav drop target
      if (overId.startsWith('nav-')) {
        const indicator: DropIndicator = { targetId: overId, intent: 'inside' }
        dropIndicatorRef.current = indicator
        setDragState((prev) => ({ ...prev, dropIndicator: indicator }))
        return
      }

      // Check if this is a kanban column drop target
      if (overId.startsWith('kanban-column-')) {
        const indicator: DropIndicator = { targetId: overId, intent: 'inside' }
        dropIndicatorRef.current = indicator
        setDragState((prev) => ({ ...prev, dropIndicator: indicator }))
        return
      }

      // If we moved to a different target, reset dwell timer
      const prevOverId = lastOverIdRef.current
      const sameTarget = prevOverId === overId

      // If already dwelling on this target and showing 'inside', keep it
      if (sameTarget && dropIndicatorRef.current?.intent === 'inside') {
        lastOverIdRef.current = over.id
        return
      }

      // Calculate above/below based on pointer position
      const overElement = over.rect
      let intent: DropIntent = 'above'
      if (overElement && pointerYRef.current > 0) {
        const overRect = {
          top: overElement.top,
          height: overElement.height
        } as DOMRect
        intent = getAboveOrBelow(overRect, pointerYRef.current)
      }

      const indicator: DropIndicator = { targetId: overId, intent }
      dropIndicatorRef.current = indicator
      setDragState((prev) => ({ ...prev, dropIndicator: indicator }))

      // Start dwell timer: if hovering over same task for 500ms, switch to 'inside'
      if (!sameTarget) {
        clearDwellTimer()
        dwellTimerRef.current = setTimeout(() => {
          const insideIndicator: DropIndicator = { targetId: overId, intent: 'inside' }
          dropIndicatorRef.current = insideIndicator
          setDragState((prev) => ({ ...prev, dropIndicator: insideIndicator }))
        }, 750)
      }

      lastOverIdRef.current = over.id
    },
    [dragState.activeId, dragState.dropIndicator, clearDwellTimer]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      const activeId = active.id as string
      const activeTask = tasks[activeId]

      // Save the drop indicator from ref BEFORE clearing state
      const savedIndicator = dropIndicatorRef.current

      clearDwellTimer()
      cleanupPointerListener()
      setDragState({
        activeId: null,
        activeTask: null,
        dropIndicator: null,
        isDragging: false
      })
      dropIndicatorRef.current = null

      if (!over || !activeTask) return

      const overId = over.id as string

      // Handle sidebar nav drops
      if (overId.startsWith('nav-') && onMoveToView) {
        const viewId = overId.replace('nav-', '')
        await onMoveToView(activeId, viewId)
        return
      }

      // Handle kanban column drops — bucket columns (My Day) or regular status columns
      if (overId.startsWith('kanban-column-')) {
        const columnId = overId.replace('kanban-column-', '')
        if (columnId.startsWith('__bucket_') && onBucketDrop) {
          const bucketKey = columnId.replace('__bucket_', '')
          await onBucketDrop(activeId, bucketKey)
          return
        }
        if (onStatusChangeRef.current && columnId !== activeTask.status_id) {
          await onStatusChangeRef.current(activeId, columnId)
        }
        return
      }

      // Don't drop on self
      if (overId === activeId) return

      const overTask = tasks[overId]
      if (!overTask) return

      // Read intent from the saved indicator (not from cleared state)
      const intent = savedIndicator?.targetId === overId
        ? savedIndicator.intent
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

        // If moving to a different status, change it
        if (activeTask.status_id !== targetStatusId && onStatusChangeRef.current) {
          await onStatusChangeRef.current(activeId, targetStatusId)
        }

        // Reorder within the target context
        const siblings = getTasksForParent(targetParentId, targetStatusId)
        const filtered = siblings.filter((t) => t.id !== activeId)
        const overIndex = filtered.findIndex((t) => t.id === overId)

        const newOrder = [...filtered]
        const insertIndex = intent === 'above' ? overIndex : overIndex + 1
        newOrder.splice(insertIndex, 0, activeTask)

        await onReorder(newOrder.map((t) => t.id))
      }
    },
    [tasks, onReorder, onReparent, onMoveToView, getTasksForParent, cleanupPointerListener, clearDwellTimer]
  )

  const handleDragCancel = useCallback(() => {
    clearDwellTimer()
    cleanupPointerListener()
    setDragState({
      activeId: null,
      activeTask: null,
      dropIndicator: null,
      isDragging: false
    })
    dropIndicatorRef.current = null
  }, [cleanupPointerListener, clearDwellTimer])

  // Custom collision detection: pointer-within for all elements, closestCenter as fallback
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args)

      // Nav items always take priority
      const navCollisions = pointerCollisions.filter((c) =>
        String(c.id).startsWith('nav-')
      )
      if (navCollisions.length > 0) return navCollisions

      // For kanban: prefer card collisions over column collisions
      // (cards are children of columns, so both match pointerWithin)
      const cardCollisions = pointerCollisions.filter((c) => {
        const id = String(c.id)
        return !id.startsWith('nav-') && !id.startsWith('kanban-column-')
      })
      if (cardCollisions.length > 0) return cardCollisions

      // Kanban column (when pointer is in empty space within column, not over a card)
      const kanbanCollisions = pointerCollisions.filter((c) =>
        String(c.id).startsWith('kanban-column-')
      )
      if (kanbanCollisions.length > 0) return kanbanCollisions

      // Fallback to closestCenter when pointer isn't inside any element
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
