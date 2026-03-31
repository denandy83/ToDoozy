import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Calendar, X, AlignLeft, Link } from 'lucide-react'
import type { Project, Label, ThemeConfig } from '../../shared/types'
import { applyThemeConfig } from './shared/hooks/useThemeApplicator'
import { useSmartInput } from './shared/hooks/useSmartInput'
import { InputSuggestionPopup, type SuggestionData, type InputSuggestionPopupProps } from './shared/components/InputSuggestionPopup'
import { LabelChip } from './shared/components/LabelChip'
import { PriorityBadge } from './shared/components/PriorityBadge'
import { formatDate } from './shared/utils/dateFormat'
import {
  filterLabels,
  filterPriorities,
  filterDates,
  filterProjects,
  getNextAutoColor
} from './shared/hooks/smartInputParser'


export default function QuickAddApp(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectLabels, setProjectLabels] = useState<Label[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [addToMyDay, setAddToMyDay] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [newTaskPosition, setNewTaskPosition] = useState<string>('top')
  const [dateFormat, setDateFormat] = useState<string>('dd/mm/yyyy')
  const [ready, setReady] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [description, setDescription] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const smart = useSmartInput(inputRef)

  // Auto-select default project once loaded
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      const defaultProject = projects.find((p) => p.is_default === 1) ?? projects[0]
      setSelectedProjectId(defaultProject.id)
    }
  }, [projects, selectedProjectId])

  const targetProjectId = selectedProjectId

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

        const settings = await window.api.settings.getAll(uid)
        const settingsMap: Record<string, string | null> = {}
        for (const s of settings) {
          settingsMap[s.key] = s.value
        }
        setNewTaskPosition(settingsMap['new_task_position'] ?? 'top')
        setAddToMyDay((settingsMap['quickadd_default_myday'] ?? 'true') === 'true')
        setDateFormat(settingsMap['date_format'] ?? 'dd/mm/yyyy')

        // Set default project from settings, fallback to is_default project
        const quickAddProject = settingsMap['quickadd_default_project']
        const defaultProj = userProjects.find((p) => quickAddProject ? p.id === quickAddProject : p.is_default === 1) ?? userProjects[0]
        if (defaultProj) setSelectedProjectId(defaultProj.id)

        const themeId = settingsMap['theme_id']
        if (themeId) {
          const config = await window.api.themes.getConfig(themeId)
          if (config) {
            applyThemeConfig(config as ThemeConfig)
          }
        }

        setReady(true)
        // Signal to main process that theme is applied and window can be shown
        window.api.quickadd.signalReady()
      } catch (err) {
        console.error('Quick-add init failed:', err)
      }
    }
    init()
  }, [])

  // Auto-focus when ready
  useEffect(() => {
    if (ready) {
      inputRef.current?.focus()
    }
  }, [ready])



  const handleSubmit = useCallback(async (): Promise<void> => {
    const { title: trimmed, extractedReferenceUrl } = smart.getSubmitData()
    if (!trimmed || !userId || !selectedProjectId) return

    try {
      const defaultStatus = await window.api.statuses.findDefault(selectedProjectId)
      if (!defaultStatus) return

      const allTasks = await window.api.tasks.findByProjectId(selectedProjectId)
      const statusTasks = allTasks.filter((t) => t.status_id === defaultStatus.id && t.parent_id === null)
      const orderIndices = statusTasks.map((t) => t.order_index)
      const maxIndex = orderIndices.length > 0 ? Math.max(...orderIndices) : 0
      const minIndex = orderIndices.length > 0 ? Math.min(...orderIndices) : 0
      const orderIndex = newTaskPosition === 'bottom' ? maxIndex + 1 : minIndex - 1

      const taskId = crypto.randomUUID()
      await window.api.tasks.create({
        id: taskId,
        project_id: selectedProjectId,
        owner_id: userId,
        title: trimmed,
        description: description.trim() || null,
        status_id: defaultStatus.id,
        order_index: orderIndex,
        is_in_my_day: addToMyDay ? 1 : 0,
        priority: smart.selectedPriority ?? 0,
        due_date: smart.selectedDate,
        reference_url: extractedReferenceUrl || smart.referenceUrl
      })

      // Assign labels
      for (const label of smart.attachedLabels) {
        await window.api.tasks.addLabel(taskId, label.id)
      }

      await window.api.quickadd.notifyTaskCreated()

      smart.reset()
      setDescription('')
      setShowDescription(false)
      await window.api.quickadd.hide()
    } catch (err) {
      console.error('Failed to create task:', err)
    }
  }, [smart, userId, selectedProjectId, addToMyDay, newTaskPosition, description])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (smart.popupState) return // Popup handles its own keys

      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Tab' && showDescription) {
        e.preventDefault()
        descriptionRef.current?.focus()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        smart.reset()
        setDescription('')
        setShowDescription(false)
        window.api.quickadd.hide()
      }
      if (e.key === 'Backspace' && smart.inputValue === '') {
        smart.removeLastChip()
      }
    },
    [handleSubmit, smart, showDescription]
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
      } else if (data.type === 'project') {
        // Just switch the dropdown, no chip — use selectProject which clears suppressed positions
        setSelectedProjectId(data.project.id)
        smart.selectProject(data.project)
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
      return filterDates(smart.popupState.query, dateFormat).map((d) => ({
        id: `date-${d.date}`,
        label: d.label,
        icon: 'calendar' as const,
        secondaryText: d.formatted,
        data: { type: 'date' as const, option: d }
      }))
    }

    if (smart.popupState.type === '/') {
      return filterProjects(projects, smart.popupState.query).map((p) => ({
        id: `project-${p.id}`,
        label: p.name,
        color: p.color,
        data: { type: 'project' as const, project: p }
      }))
    }

    return []
  }, [smart.popupState, projectLabels, projects])

  const hasChips = smart.attachedLabels.length > 0 || smart.selectedPriority !== null || smart.selectedDate !== null || smart.referenceUrl !== null

  if (!ready) {
    return <div className="w-screen bg-transparent" />
  }

  return (
    <div className="flex w-screen flex-col justify-end bg-transparent p-1" style={{ height: '100vh' }}>
      <div className="relative w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Title input */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={smart.inputValue}
              onChange={handleChange}
              onSelect={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder="Add a task..."
              autoFocus
              className="flex-1 bg-transparent text-[15px] font-light tracking-tight text-foreground placeholder:text-muted/40 focus:outline-none"
            />
            <button
              onClick={() => {
                setShowDescription((prev) => {
                  if (!prev) {
                    setTimeout(() => descriptionRef.current?.focus(), 0)
                  }
                  return !prev
                })
              }}
              className={`flex-shrink-0 rounded p-1 transition-colors ${showDescription ? 'bg-accent/15 text-accent' : 'text-muted/40 hover:text-muted'}`}
              aria-label="Toggle description"
              title="Add description"
              tabIndex={0}
            >
              <AlignLeft size={14} />
            </button>
          </div>
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
                  {formatDate(smart.selectedDate)}
                  <button
                    onClick={smart.removeDate}
                    className="ml-0.5 rounded-full p-0 hover:text-foreground"
                    aria-label="Remove date"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
              {smart.referenceUrl && (
                <span className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                  <Link size={10} className="flex-shrink-0" />
                  <span className="truncate">{smart.referenceUrl}</span>
                  <button
                    onClick={smart.removeReferenceUrl}
                    className="ml-0.5 flex-shrink-0 rounded-full p-0 hover:text-foreground"
                    aria-label="Remove reference URL"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
            </div>
          )}

          {showDescription && (
            <div className="mt-2">
              <textarea
                ref={descriptionRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    e.preventDefault()
                    handleSubmit()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    inputRef.current?.focus()
                  }
                }}
                placeholder="Description..."
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-foreground/3 px-3 py-2 text-sm font-light text-foreground placeholder:text-muted/40 focus:border-accent/30 focus:outline-none"
              />
              <div className="mt-1 flex items-center gap-1 text-[10px] text-muted/40">
                <span className="text-[9px] font-bold uppercase tracking-wider">⌘ + Enter</span>
                <span>to add</span>
                <span className="ml-1 text-[9px] font-bold uppercase tracking-wider">Esc</span>
                <span>to go back</span>
              </div>
            </div>
          )}
        </div>

        {/* Project selector + My Day checkbox */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <div className="flex items-center gap-3">
            {/* Project dropdown — native select for macOS behavior */}
            <select
              value={selectedProjectId ?? ''}
              onChange={(e) => {
                setSelectedProjectId(e.target.value)
                inputRef.current?.focus()
              }}
              className="rounded-lg border border-border bg-transparent px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground focus:outline-none cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Add to My Day checkbox */}
            <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground">
              <input
                type="checkbox"
                checked={addToMyDay}
                onChange={(e) => {
                  setAddToMyDay(e.target.checked)
                  inputRef.current?.focus()
                }}
                className="h-3 w-3 rounded border-border accent-accent"
              />
              My Day
            </label>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted/40">
            <span className="text-[9px] font-bold uppercase tracking-wider">Enter</span>
            <span>to add</span>
            <span className="ml-1 text-[9px] font-bold uppercase tracking-wider">Esc</span>
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
