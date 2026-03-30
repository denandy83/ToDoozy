import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { useFocusTrap } from '../../shared/hooks/useFocusTrap'
import { useFocusRestore } from '../../shared/hooks/useFocusRestore'
import { useCommandPaletteStore } from '../../shared/stores/commandPaletteStore'
import { useCommandPaletteSearch } from './useCommandPaletteSearch'
import { CommandPaletteResult } from './CommandPaletteResult'
import { useTaskStore } from '../../shared/stores/taskStore'
import { useViewStore } from '../../shared/stores/viewStore'

export function CommandPalette(): React.JSX.Element | null {
  const { isOpen, query, selectedIndex, close, setQuery, setSelectedIndex } =
    useCommandPaletteStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const results = useCommandPaletteSearch(query)

  useFocusRestore()
  useFocusTrap(containerRef, isOpen)
  const allTasks = useTaskStore((s) => s.tasks)
  const setCurrentTask = useTaskStore((s) => s.setCurrentTask)
  const selectTask = useTaskStore((s) => s.selectTask)
  const setSelectedProject = useViewStore((s) => s.setSelectedProject)
  const setView = useViewStore((s) => s.setView)

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleSelect = useCallback(
    (taskId: string) => {
      const task = allTasks[taskId]
      if (task) {
        if (task.is_archived === 1) {
          // Navigate to archive view for archived tasks
          setSelectedProject(task.project_id)
          setView('archive')
        } else {
          // Navigate to the task's project
          setSelectedProject(task.project_id)
        }
        // Select and open the task
        selectTask(taskId)
        setCurrentTask(taskId)
        // Scroll the task row into view after the view renders
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)?.scrollIntoView({ block: 'nearest' })
        })
      }
      close()
    },
    [allTasks, setSelectedProject, setView, selectTask, setCurrentTask, close]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(Math.min(selectedIndex + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(Math.max(selectedIndex - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex].id)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          close()
          break
      }
    },
    [selectedIndex, results, setSelectedIndex, handleSelect, close]
  )

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        close()
      }
    },
    [close]
  )

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        className="w-full max-w-xl rounded-xl border border-border bg-surface shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks... (p:high l:work s:done d:today has:subtasks)"
            className="flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted focus:outline-none"
            aria-label="Search tasks"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className={`max-h-[400px] overflow-y-auto ${results.length > 0 || query.trim() ? 'p-2' : ''}`} role="listbox">
          {query.trim() && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-sm font-light text-muted">No results found</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted/60">
                Try a different search
              </p>
            </div>
          )}
          {results.map((task, index) => (
            <CommandPaletteResult
              key={task.id}
              task={task}
              isSelected={index === selectedIndex}
              onSelect={handleSelect}
              onHover={() => setSelectedIndex(index)}
            />
          ))}
        </div>

        {/* Footer hints */}
        {query.trim() === '' && (
          <div className="border-t border-border px-4 py-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <OperatorHint prefix="p:" example="high" />
              <OperatorHint prefix="l:" example="work" />
              <OperatorHint prefix="s:" example="done" />
              <OperatorHint prefix="d:" example="today" />
              <OperatorHint prefix="has:" example="subtasks" />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

interface OperatorHintProps {
  prefix: string
  example: string
}

function OperatorHint({ prefix, example }: OperatorHintProps): React.JSX.Element {
  return (
    <span className="text-[10px] text-muted">
      <span className="font-bold text-accent">{prefix}</span>
      <span className="font-light">{example}</span>
    </span>
  )
}
