import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronDown, Calendar, X } from 'lucide-react'
import type { Project, Label, ThemeConfig } from '../../shared/types'
import { applyThemeConfig } from './shared/hooks/useThemeApplicator'
import { useSmartInput } from './shared/hooks/useSmartInput'
import { InputSuggestionPopup, type SuggestionData, type InputSuggestionPopupProps } from './shared/components/InputSuggestionPopup'
import { LabelChip } from './shared/components/LabelChip'
import { PriorityBadge } from './shared/components/PriorityBadge'
import {
  filterLabels,
  filterPriorities,
  filterDates,
  getNextAutoColor
} from './shared/hooks/smartInputParser'

interface ProjectOption {
  id: string
  name: string
  color: string
  isMyDay: boolean
}

const MY_DAY_ID = '__my_day__'

export default function QuickAddApp(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectLabels, setProjectLabels] = useState<Label[]>([])
  const [selectedDestination, setSelectedDestination] = useState(MY_DAY_ID)
  const [userId, setUserId] = useState<string | null>(null)
  const [newTaskPosition, setNewTaskPosition] = useState<string>('top')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const smart = useSmartInput(inputRef)

  // Resolve the target project ID for the current destination
  const targetProjectId = useMemo(() => {
    if (selectedDestination === MY_DAY_ID) {
      const defaultProject = projects.find((p) => p.is_default === 1) ?? projects[0]
      return defaultProject?.id ?? null
    }
    return selectedDestination
  }, [selectedDestination, projects])

  // Load labels when target project changes
  useEffect(() => {
    if (!targetProjectId) return
    window.api.labels.findByProjectId(targetProjectId).then(setProjectLabels).catch(() => setProjectLabels([]))
  }, [targetProjectId])

  // Initialize: load user, projects, settings, theme
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const sessionJson = await window.api.auth.getSession()
        if (!sessionJson) {
          await window.api.quickadd.hide()
          return
        }
        const session = JSON.parse(sessionJson) as { access_token: string }
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const uid = payload.sub as string
        setUserId(uid)

        const userProjects = await window.api.projects.getProjectsForUser(uid)
        setProjects(userProjects)

        const settings = await window.api.settings.getAll()
        const settingsMap: Record<string, string | null> = {}
        for (const s of settings) {
          settingsMap[s.key] = s.value
        }
        setNewTaskPosition(settingsMap['new_task_position'] ?? 'top')

        const themeId = settingsMap['theme_id']
        if (themeId) {
          const config = await window.api.themes.getConfig(themeId)
          if (config) {
            applyThemeConfig(config as ThemeConfig)
          }
        }

        setReady(true)
      } catch (err) {
        console.error('Quick-add init failed:', err)
      }
    }
    init()
  }, [])

  // Focus input when window receives focus signal
  useEffect(() => {
    const unsub = window.api.quickadd.onFocus(() => {
      smart.reset()
      setSelectedDestination(MY_DAY_ID)
      setDropdownOpen(false)
      inputRef.current?.focus()
    })
    return unsub
  }, [smart])

  // Auto-focus when ready
  useEffect(() => {
    if (ready) {
      inputRef.current?.focus()
    }
  }, [ready])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const destinations: ProjectOption[] = [
    { id: MY_DAY_ID, name: 'My Day', color: '#f59e0b', isMyDay: true },
    ...projects.map((p) => ({ id: p.id, name: p.name, color: p.color, isMyDay: false }))
  ]

  const selectedDest = destinations.find((d) => d.id === selectedDestination) ?? destinations[0]

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmed = smart.getSubmitTitle()
    if (!trimmed || !userId) return

    try {
      const isMyDay = selectedDestination === MY_DAY_ID
      let projectId: string
      if (isMyDay) {
        const defaultProject = projects.find((p) => p.is_default === 1) ?? projects[0]
        if (!defaultProject) return
        projectId = defaultProject.id
      } else {
        projectId = selectedDestination
      }

      const defaultStatus = await window.api.statuses.findDefault(projectId)
      if (!defaultStatus) return

      const allTasks = await window.api.tasks.findByProjectId(projectId)
      const orderIndices = allTasks.map((t) => t.order_index)
      const maxIndex = orderIndices.length > 0 ? Math.max(...orderIndices) : 0
      const minIndex = orderIndices.length > 0 ? Math.min(...orderIndices) : 0
      const orderIndex = newTaskPosition === 'bottom' ? maxIndex + 1 : minIndex - 1

      const taskId = crypto.randomUUID()
      await window.api.tasks.create({
        id: taskId,
        project_id: projectId,
        owner_id: userId,
        title: trimmed,
        status_id: defaultStatus.id,
        order_index: orderIndex,
        is_in_my_day: isMyDay ? 1 : 0,
        priority: smart.selectedPriority ?? 0,
        due_date: smart.selectedDate
      })

      // Assign labels
      for (const label of smart.attachedLabels) {
        await window.api.tasks.addLabel(taskId, label.id)
      }

      await window.api.quickadd.notifyTaskCreated()

      smart.reset()
      await window.api.quickadd.hide()
    } catch (err) {
      console.error('Failed to create task:', err)
    }
  }, [smart, userId, selectedDestination, projects, newTaskPosition])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (smart.popupState) return // Popup handles its own keys

      if (e.key === 'Enter' && !dropdownOpen) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        smart.reset()
        window.api.quickadd.hide()
      }
      if (e.key === 'Backspace' && smart.inputValue === '') {
        smart.removeLastChip()
      }
    },
    [handleSubmit, dropdownOpen, smart]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      smart.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
    },
    [smart]
  )

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      smart.handleCursorMove(target.selectionStart ?? target.value.length)
    },
    [smart]
  )

  const handlePopupSelect = useCallback(
    (data: SuggestionData) => {
      if (data.type === 'label') {
        smart.selectLabel(data.label)
      } else if (data.type === 'label-create') {
        if (targetProjectId) {
          window.api.labels
            .create({ id: crypto.randomUUID(), project_id: targetProjectId, name: data.name, color: data.color })
            .then((created) => {
              smart.selectLabel(created)
              setProjectLabels((prev) => [...prev, created])
            })
            .catch((err: unknown) => console.error('Failed to create label:', err))
        }
        if (smart.popupState?.operator) {
          const newValue =
            smart.inputValue.slice(0, smart.popupState.operator.startIndex) +
            smart.inputValue.slice(smart.popupState.operator.endIndex)
          smart.setInputValue(newValue.replace(/  +/g, ' ').trim())
        }
        smart.dismissPopup()
      } else if (data.type === 'priority') {
        smart.selectPriority(data.option.value)
      } else if (data.type === 'date') {
        smart.selectDate(data.option.date)
      }
    },
    [smart, targetProjectId]
  )

  const popupItems = useMemo(() => {
    if (!smart.popupState) return []

    if (smart.popupState.type === '@') {
      const filtered = filterLabels(projectLabels, smart.popupState.query)
      const items: InputSuggestionPopupProps['items'] = filtered.map((l) => ({
        id: l.id,
        label: l.name,
        color: l.color,
        data: { type: 'label' as const, label: l }
      }))
      if (smart.popupState.query.trim()) {
        const autoColor = getNextAutoColor(projectLabels)
        items.push({
          id: '__create__',
          label: `+ Create "${smart.popupState.query.trim()}"`,
          color: autoColor,
          data: {
            type: 'label-create' as const,
            name: smart.popupState.query.trim(),
            color: autoColor
          }
        })
      }
      return items
    }

    if (smart.popupState.type === 'p:') {
      return filterPriorities(smart.popupState.query).map((p) => ({
        id: `priority-${p.value}`,
        label: p.label,
        color: p.color,
        data: { type: 'priority' as const, option: p }
      }))
    }

    if (smart.popupState.type === 'd:') {
      return filterDates(smart.popupState.query).map((d) => ({
        id: `date-${d.date}`,
        label: d.label,
        icon: 'calendar' as const,
        secondaryText: d.formatted,
        data: { type: 'date' as const, option: d }
      }))
    }

    return []
  }, [smart.popupState, projectLabels])

  const hasChips = smart.attachedLabels.length > 0 || smart.selectedPriority !== null || smart.selectedDate !== null

  if (!ready) {
    return <div className="h-full w-full" />
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center p-0">
      <div className="w-full rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
        {/* Title input */}
        <div className="px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={smart.inputValue}
            onChange={handleChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            autoFocus
            className="w-full bg-transparent text-[15px] font-light tracking-tight text-foreground placeholder:text-muted/40 focus:outline-none"
          />
          {hasChips && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {smart.attachedLabels.map((l) => (
                <LabelChip
                  key={l.id}
                  name={l.name}
                  color={l.color}
                  onRemove={() => smart.removeLabel(l.id)}
                />
              ))}
              {smart.selectedPriority !== null && smart.selectedPriority > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <PriorityBadge priority={smart.selectedPriority} />
                  <button
                    onClick={smart.removePriority}
                    className="rounded-full p-0.5 text-muted hover:bg-foreground/6 hover:text-foreground"
                    aria-label="Remove priority"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
              {smart.selectedDate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                  <Calendar size={10} />
                  {smart.selectedDate}
                  <button
                    onClick={smart.removeDate}
                    className="ml-0.5 rounded-full p-0 hover:text-foreground"
                    aria-label="Remove date"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Destination dropdown */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: selectedDest?.color ?? '#888' }}
              />
              {selectedDest?.name ?? 'My Day'}
              <ChevronDown size={10} />
            </button>

            {dropdownOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg border border-border bg-surface py-1 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100">
                {destinations.map((dest) => (
                  <button
                    key={dest.id}
                    onClick={() => {
                      setSelectedDestination(dest.id)
                      setDropdownOpen(false)
                      inputRef.current?.focus()
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-light transition-colors hover:bg-foreground/6 ${
                      selectedDestination === dest.id ? 'text-accent' : 'text-foreground'
                    }`}
                  >
                    <span
                      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: dest.color }}
                    />
                    {dest.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted/40">
            <kbd className="rounded border border-border px-1 py-0.5 text-[9px]">Enter</kbd>
            <span>to add</span>
            <kbd className="ml-1 rounded border border-border px-1 py-0.5 text-[9px]">Esc</kbd>
            <span>to close</span>
          </div>
        </div>
      </div>

      {smart.popupState && popupItems.length > 0 && (
        <InputSuggestionPopup
          items={popupItems}
          position={smart.popupState.position}
          onSelect={handlePopupSelect}
          onDismiss={smart.dismissPopup}
        />
      )}
    </div>
  )
}
