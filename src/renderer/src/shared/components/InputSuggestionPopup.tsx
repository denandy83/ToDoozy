import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Plus } from 'lucide-react'
import type { Label } from '../../../../shared/types'
import type { PriorityOption, DateOption } from '../hooks/smartInputParser'

export interface LabelSuggestion {
  type: 'label'
  label: Label
}

export interface LabelCreateSuggestion {
  type: 'label-create'
  name: string
  color: string
}

export interface PrioritySuggestion {
  type: 'priority'
  option: PriorityOption
}

export interface DateSuggestion {
  type: 'date'
  option: DateOption
}

export type SuggestionData = LabelSuggestion | LabelCreateSuggestion | PrioritySuggestion | DateSuggestion

export interface InputSuggestionPopupProps {
  items: Array<{
    id: string
    label: string
    color?: string
    icon?: 'calendar' | 'create'
    secondaryText?: string
    data: SuggestionData
  }>
  position: { top: number; left: number }
  onSelect: (data: SuggestionData) => void
  onDismiss: () => void
}

export function InputSuggestionPopup({
  items,
  position,
  onSelect,
  onDismiss
}: InputSuggestionPopupProps): React.JSX.Element | null {
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset highlight when items change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [items])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (items.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setHighlightedIndex((prev) => (prev + 1) % items.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setHighlightedIndex((prev) => (prev - 1 + items.length) % items.length)
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          e.stopPropagation()
          if (items[highlightedIndex]) {
            onSelect(items[highlightedIndex].data)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onDismiss()
          break
      }
    },
    [items, highlightedIndex, onSelect, onDismiss]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (items.length === 0) return null

  // Clamp to viewport
  const adjustedLeft = Math.min(position.left, window.innerWidth - 240)
  const adjustedTop = Math.min(position.top, window.innerHeight - items.length * 32 - 8)

  return createPortal(
    <div
      ref={containerRef}
      className="fixed w-56 rounded-lg border border-border bg-surface py-1 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100"
      style={{
        top: adjustedTop,
        left: adjustedLeft,
        zIndex: 9999
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-light transition-colors ${
            index === highlightedIndex ? 'bg-foreground/6' : ''
          }`}
          onMouseEnter={() => setHighlightedIndex(index)}
          onMouseDown={(e) => {
            e.preventDefault() // Prevent input blur
            onSelect(item.data)
          }}
        >
          {item.icon === 'calendar' ? (
            <Calendar size={12} className="flex-shrink-0 text-muted" />
          ) : item.icon === 'create' ? (
            <Plus size={12} className="flex-shrink-0 text-muted" />
          ) : item.color ? (
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
          ) : null}
          <span className="flex-1 truncate text-foreground">{item.label}</span>
          {item.secondaryText && (
            <span className="flex-shrink-0 text-[10px] text-muted">{item.secondaryText}</span>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}
