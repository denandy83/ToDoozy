import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { Label } from '../../../../shared/types'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useLabelStore } from '../stores/labelStore'
import { useToast } from './Toast'

interface LabelPickerProps {
  allLabels: Label[]
  assignedLabelIds: Set<string>
  onToggleLabel: (labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
  onClose: () => void
  projectId?: string
  globalLabels?: Label[]
  onAddGlobalLabel?: (labelId: string) => void
}

export function LabelPicker({
  allLabels,
  assignedLabelIds,
  onToggleLabel,
  onCreateLabel,
  onClose,
  projectId,
  globalLabels = [],
  onAddGlobalLabel
}: LabelPickerProps): React.JSX.Element {
  const { addToProject } = useLabelStore()
  const { addToast } = useToast()
  const [newLabelMode, setNewLabelMode] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#6366f1')
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useFocusTrap(ref)

  useEffect(() => {
    if (newLabelMode) nameInputRef.current?.focus()
    else searchInputRef.current?.focus()
  }, [newLabelMode])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Fetch all global labels once on mount
  const [allGlobalLabels, setAllGlobalLabels] = useState<Label[]>([])
  useEffect(() => {
    if (globalLabels.length > 0) {
      setAllGlobalLabels(globalLabels)
    } else {
      window.api.labels.findAll().then(setAllGlobalLabels).catch(() => {})
    }
  }, [globalLabels])

  const handleAddGlobalLabel = useCallback(async (labelId: string) => {
    if (onAddGlobalLabel) {
      onAddGlobalLabel(labelId)
      return
    }
    if (!projectId) return
    await addToProject(projectId, labelId)
    const label = allGlobalLabels.find((l) => l.id === labelId)
    if (label) addToast({ message: `Existing label added: ${label.name}` })
    onToggleLabel(labelId)
    setSearchQuery('')
  }, [onAddGlobalLabel, projectId, addToProject, allGlobalLabels, addToast, onToggleLabel])

  const handleCreateLabel = useCallback(() => {
    const trimmed = newLabelName.trim()
    if (!trimmed) return
    onCreateLabel(trimmed, newLabelColor)
    setNewLabelName('')
    setNewLabelColor('#6366f1')
    setNewLabelMode(false)
  }, [newLabelName, newLabelColor, onCreateLabel])

  const filteredLabels = allLabels.filter((l) => l.name.toLowerCase().includes(searchQuery.toLowerCase()))

  // Global labels not in this project that match the search
  const localIds = useMemo(() => new Set(allLabels.map((l) => l.id)), [allLabels])
  const filteredGlobalLabels = useMemo(
    () => searchQuery.trim()
      ? allGlobalLabels.filter((l) => !localIds.has(l.id) && l.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : [],
    [allGlobalLabels, localIds, searchQuery]
  )

  const totalItems = filteredLabels.length + filteredGlobalLabels.length

  // Reset highlighted index when search changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [searchQuery])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (newLabelMode) {
          setNewLabelMode(false)
        } else {
          onClose()
        }
      }
      if (e.key === 'ArrowDown' && !newLabelMode) {
        e.preventDefault()
        setHighlightedIndex((prev) => Math.min(prev + 1, totalItems))
      }
      if (e.key === 'ArrowUp' && !newLabelMode) {
        e.preventDefault()
        setHighlightedIndex((prev) => Math.max(prev - 1, 0))
      }
      if (e.key === 'Enter' && !newLabelMode) {
        e.preventDefault()
        if (highlightedIndex < filteredLabels.length) {
          onToggleLabel(filteredLabels[highlightedIndex].id)
          setSearchQuery('')
        } else if (highlightedIndex < filteredLabels.length + filteredGlobalLabels.length) {
          // Global label selected — add to project then toggle
          const globalLabel = filteredGlobalLabels[highlightedIndex - filteredLabels.length]
          if (globalLabel) {
            handleAddGlobalLabel(globalLabel.id)
            setSearchQuery('')
          }
        } else {
          // "New label" is selected
          if (searchQuery.trim()) {
            setNewLabelName(searchQuery.trim())
          }
          setNewLabelMode(true)
          setSearchQuery('')
        }
        return
      }
      if (e.key === 'Enter' && newLabelMode) {
        e.preventDefault()
        handleCreateLabel()
      }
    },
    [newLabelMode, handleCreateLabel, onClose, filteredLabels, filteredGlobalLabels, totalItems, highlightedIndex, onToggleLabel, handleAddGlobalLabel, searchQuery]
  )

  return (
    <div
      ref={ref}
      onKeyDown={handleKeyDown}
      className="w-56 rounded-lg border border-border bg-background p-1 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100"
    >
      {newLabelMode ? (
        <div className="flex flex-col gap-2 p-2">
          <input
            ref={nameInputRef}
            type="text"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="Label name"
            className="rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newLabelColor}
              onChange={(e) => setNewLabelColor(e.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <button
              onClick={handleCreateLabel}
              className="flex-1 rounded bg-accent px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80"
            >
              Create
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-2 pb-1 pt-1">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search labels..."
              className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground placeholder:text-muted/40 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredLabels.map((label, index) => {
              const isAssigned = assignedLabelIds.has(label.id)
              return (
                <button
                  key={label.id}
                  onClick={() => onToggleLabel(label.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-light transition-colors hover:bg-foreground/6 ${index === highlightedIndex ? 'bg-foreground/6' : ''}`}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 truncate">{label.name}</span>
                  {isAssigned && (
                    <span className="text-accent text-xs">&#10003;</span>
                  )}
                </button>
              )
            })}
            {allLabels.length === 0 && filteredGlobalLabels.length === 0 && (
              <p className="px-2 py-1.5 text-[10px] text-muted">No labels</p>
            )}
            {filteredGlobalLabels.length > 0 && (
              <>
                <div className="mx-2 my-1 border-t border-border" />
                {filteredGlobalLabels.map((label, index) => {
                  const globalIndex = filteredLabels.length + index
                  return (
                    <button
                      key={label.id}
                      onClick={() => handleAddGlobalLabel(label.id)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-light transition-colors hover:bg-foreground/6 ${globalIndex === highlightedIndex ? 'bg-foreground/6' : ''}`}
                    >
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="flex-1 truncate">{label.name}</span>
                      <span className="text-[9px] text-muted">not in this project</span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <button
              onClick={() => setNewLabelMode(true)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-light text-muted transition-colors hover:bg-foreground/6 hover:text-foreground ${highlightedIndex === totalItems ? 'bg-foreground/6 text-foreground' : ''}`}
            >
              <Plus size={14} />
              New label...
            </button>
          </div>
        </>
      )}
    </div>
  )
}
