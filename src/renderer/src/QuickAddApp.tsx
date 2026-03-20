import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Project, ThemeConfig } from '../../shared/types'
import { applyThemeConfig } from './shared/hooks/useThemeApplicator'

interface ProjectOption {
  id: string
  name: string
  color: string
  isMyDay: boolean
}

const MY_DAY_ID = '__my_day__'

export default function QuickAddApp(): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedDestination, setSelectedDestination] = useState(MY_DAY_ID)
  const [userId, setUserId] = useState<string | null>(null)
  const [newTaskPosition, setNewTaskPosition] = useState<string>('top')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Initialize: load user, projects, settings, theme
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        // Load session to get user ID
        const sessionJson = await window.api.auth.getSession()
        if (!sessionJson) {
          await window.api.quickadd.hide()
          return
        }
        const session = JSON.parse(sessionJson) as { access_token: string }
        // Decode JWT to get user ID
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const uid = payload.sub as string
        setUserId(uid)

        // Load projects
        const userProjects = await window.api.projects.getProjectsForUser(uid)
        setProjects(userProjects)

        // Load settings
        const settings = await window.api.settings.getAll()
        const settingsMap: Record<string, string | null> = {}
        for (const s of settings) {
          settingsMap[s.key] = s.value
        }
        setNewTaskPosition(settingsMap['new_task_position'] ?? 'top')

        // Apply theme
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
      setTitle('')
      setSelectedDestination(MY_DAY_ID)
      setDropdownOpen(false)
      inputRef.current?.focus()
    })
    return unsub
  }, [])

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
    const trimmed = title.trim()
    if (!trimmed || !userId) return

    try {
      const isMyDay = selectedDestination === MY_DAY_ID
      // Determine the target project
      let projectId: string
      if (isMyDay) {
        // Use the default project for My Day tasks
        const defaultProject = projects.find((p) => p.is_default === 1) ?? projects[0]
        if (!defaultProject) return
        projectId = defaultProject.id
      } else {
        projectId = selectedDestination
      }

      // Get default status for the project
      const defaultStatus = await window.api.statuses.findDefault(projectId)
      if (!defaultStatus) return

      // Get order index
      const allTasks = await window.api.tasks.findByProjectId(projectId)
      const orderIndices = allTasks.map((t) => t.order_index)
      const maxIndex = orderIndices.length > 0 ? Math.max(...orderIndices) : 0
      const minIndex = orderIndices.length > 0 ? Math.min(...orderIndices) : 0
      const orderIndex = newTaskPosition === 'bottom' ? maxIndex + 1 : minIndex - 1

      await window.api.tasks.create({
        id: crypto.randomUUID(),
        project_id: projectId,
        owner_id: userId,
        title: trimmed,
        status_id: defaultStatus.id,
        order_index: orderIndex,
        is_in_my_day: isMyDay ? 1 : 0
      })

      // Notify main window to refresh
      await window.api.quickadd.notifyTaskCreated()

      // Clear and hide
      setTitle('')
      await window.api.quickadd.hide()
    } catch (err) {
      console.error('Failed to create task:', err)
    }
  }, [title, userId, selectedDestination, projects, newTaskPosition])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !dropdownOpen) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTitle('')
        window.api.quickadd.hide()
      }
    },
    [handleSubmit, dropdownOpen]
  )

  if (!ready) {
    return <div className="h-full w-full" />
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center p-0">
      <div className="w-full rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
        {/* Title input */}
        <div className="flex items-center px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            autoFocus
            className="flex-1 bg-transparent text-[15px] font-light tracking-tight text-foreground placeholder:text-muted/40 focus:outline-none"
          />
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
    </div>
  )
}
