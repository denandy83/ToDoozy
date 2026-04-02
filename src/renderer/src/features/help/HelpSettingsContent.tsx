import React, { useState, useMemo } from 'react'
import { useSetting } from '../../shared/stores/settingsStore'

interface HelpSectionProps {
  title: string
  children: React.ReactNode
}

function HelpSection({ title, children }: HelpSectionProps): React.JSX.Element {
  return (
    <div>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

interface HelpItemProps {
  label: string
  description: string
}

function HelpItem({ label, description }: HelpItemProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-sm font-light text-muted">{description}</p>
    </div>
  )
}

function ShortcutTableRow({ keys, description }: { keys: string; description: string }): React.JSX.Element {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 pr-4">
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
          {keys}
        </kbd>
      </td>
      <td className="py-2 text-sm font-light text-foreground">{description}</td>
    </tr>
  )
}

interface HelpEntry {
  label: string
  description: string
}

interface HelpSectionData {
  title: string
  items: HelpEntry[]
}

interface ShortcutEntry {
  keys: string
  description: string
  category: string
}

const HELP_SECTIONS: HelpSectionData[] = [
  {
    title: 'Tasks',
    items: [
      { label: 'Creating tasks', description: "Click the 'Add task' input at the top of any project list and press Enter. Use smart shortcuts while typing: @label assigns a label, p:high sets priority, d:today sets due date, r:url attaches a reference link." },
      { label: 'Subtasks', description: 'Right-click a task → Add Subtask, or open the detail panel and use the Subtasks section. Drag a task onto the middle of another task to nest it.' },
      { label: 'Status', description: 'Click the status circle on a task row to cycle through statuses. Right-click for a full status submenu. Each project has configurable statuses (default: Not Started, In Progress, Done).' },
      { label: 'Priorities', description: 'Set priority via right-click menu, the detail panel, or smart input (p:low / p:normal / p:high / p:urgent). Priority is shown as a colored indicator on the task row.' },
      { label: 'Due dates', description: 'Set due dates in the detail panel or via smart input (d:today, d:tomorrow, d:monday, d:jan15). Tasks due today automatically appear in My Day.' },
      { label: 'Multi-select', description: 'Click to select one task. Shift+click to select a range. Cmd+click to toggle individual tasks. Selected tasks can be moved, archived, or deleted together.' },
      { label: 'Reference URL', description: 'Attach a reference link to any task via the detail panel or smart input (r:https://...). Click the link icon on the task row to open it in your browser.' }
    ]
  },
  {
    title: 'My Day',
    items: [
      { label: 'What appears in My Day', description: "Tasks you've explicitly pinned to My Day, plus any tasks with a due date of today. Grouped by project." },
      { label: 'Adding to My Day', description: 'Right-click any task → Pin to My Day. Or open the task detail panel and toggle the My Day switch. Use the quick-add window (Cmd+Shift+Space) to add directly.' },
      { label: 'Quick-add from anywhere', description: 'Press Cmd+Shift+Space (configurable in Settings → General) to open the quick-add window without switching to ToDoozy. The task goes into My Day.' }
    ]
  },
  {
    title: 'Calendar View',
    items: [
      { label: 'Opening the calendar', description: 'Click the Calendar icon in the sidebar to see all tasks with due dates across every project. Toggle between month and week view using the header controls.' },
      { label: 'Navigating dates', description: 'Use the arrow buttons to move between months or weeks. Click "Today" to jump back to the current date. Click any day to see its tasks.' },
      { label: 'Managing tasks from the calendar', description: 'Click a task on the calendar to open its detail panel. Drag tasks between days to change their due date. Tasks without due dates do not appear in the calendar.' }
    ]
  },
  {
    title: 'Projects',
    items: [
      { label: 'Creating projects', description: "Click the + button next to 'Projects' in the sidebar. Choose a name and color. Default statuses (Not Started, In Progress, Done) are created automatically." },
      { label: 'Project settings', description: 'Open Settings → Projects to rename, recolor, reorder, and configure statuses for each project.' },
      { label: 'Sharing projects', description: 'Open project settings → Share to invite other users by email. Shared projects sync in real-time — all members see task changes, status updates, and member avatars instantly.' },
      { label: 'Templates', description: 'Save any project as a template via the template icon in the header. Deploy templates from the Templates view in the sidebar.' }
    ]
  },
  {
    title: 'Labels',
    items: [
      { label: 'Global labels', description: 'Labels are shared across all projects. Create a label once and use it anywhere. Renaming or recoloring a label updates it everywhere.' },
      { label: 'Assigning labels', description: 'Click the label icon on a task row, or use the detail panel. Smart input: type @labelname while adding a task to assign on creation.' },
      { label: 'Filtering by label', description: 'Click any label chip in the task list to filter. Multiple labels filter with AND logic. Click again to clear.' },
      { label: 'Managing labels', description: 'Go to Settings → Labels to create, rename, recolor, and delete labels.' }
    ]
  },
  {
    title: 'Kanban View',
    items: [
      { label: 'Toggling kanban', description: 'Press Cmd+L or click the Kanban button in the header. Available in My Day and project views. Each project remembers your last view mode.' },
      { label: 'Moving cards', description: 'Drag cards between columns to change status. Drag within a column to reorder.' }
    ]
  },
  {
    title: 'Recurrence',
    items: [
      { label: 'Setting recurrence', description: 'Open the detail panel → click the Recurrence field. Choose from Daily, Weekly, Monthly, Yearly, or Custom. The Smart Recurrence Picker shows a preview of upcoming dates.' },
      { label: 'Custom schedules', description: "Create advanced patterns: every 2 weeks on Monday, every 3rd of the month, etc. You can also set an end date or 'after N occurrences' limit." },
      { label: 'After-completion mode', description: "Choose 'after completion' to count from when you actually finish the task, rather than the original due date. Useful for tasks that slip." },
      { label: 'How it works', description: 'When you complete a recurring task, a new occurrence is created automatically with the next due date. The completed task stays in your history.' }
    ]
  },
  {
    title: 'Snooze',
    items: [
      { label: 'Snoozing a task', description: "Right-click a task → Snooze, or use the snooze button in the detail panel. The task disappears from your list until the snooze time arrives." },
      { label: 'Preset options', description: 'Choose Later Today (3 hours), Tomorrow (9 AM), Next Week (Monday 9 AM), or pick a custom date and time.' },
      { label: 'Waking up', description: 'When a snoozed task wakes up, it reappears in your task list and shows a notification. It also returns to My Day if it was pinned.' }
    ]
  },
  {
    title: 'Archiving',
    items: [
      { label: 'Auto-archive', description: 'Enable in Settings → General. Completed tasks are automatically archived after a configurable delay (e.g., 3 days). Auto-archive only applies to local projects — shared projects are excluded to avoid conflicts between users with different settings.' },
      { label: 'Manual archive', description: 'Right-click a task → Archive, or toggle archive in the detail panel. In shared projects, manually archiving a task moves it to the archive for all members. Archiving a parent task also archives its subtasks.' },
      { label: 'Restoring tasks', description: 'Go to the Archive view in the sidebar. Click the restore button on any task to unarchive it. In shared projects, restoring a task makes it visible to all members again.' },
      { label: 'Shared projects', description: 'Tasks in shared projects can only be archived manually, never automatically. Archived shared tasks appear in every member\'s archive and can be restored by any member.' },
      { label: 'Deleting a project', description: 'When a project is deleted, all its tasks — including archived ones — are permanently removed.' },
      { label: 'Unsharing a project', description: 'When a shared project is unshared and kept locally, all archived tasks are preserved in the local copy with their archive status intact.' }
    ]
  },
  {
    title: 'Pomodoro Timer',
    items: [
      { label: 'Starting a timer', description: 'Hover over any task and click the play button that appears. The countdown appears in the macOS menu bar.' },
      { label: 'Timer settings', description: 'Go to Settings → Timer to configure work duration, short break, long break intervals, and auto-start behavior.' },
      { label: 'Menu bar controls', description: 'Click the menu bar icon to pause, resume, or stop the timer from anywhere on your Mac.' }
    ]
  },
  {
    title: 'File Attachments',
    items: [
      { label: 'Attaching files', description: 'Enable iCloud Drive in Settings → iCloud. Then use the attachment icon in the task description toolbar to attach files. Files sync to iCloud Drive for access from other devices.' },
      { label: 'Viewing attachments', description: 'Attachment cards appear below the description. Click to open in the default macOS app. Hover to see the remove button.' },
      { label: 'Limits', description: 'Maximum 10 MB per file, 10 attachments per task.' }
    ]
  },
  {
    title: 'Smart Input',
    items: [
      { label: 'Labels', description: "Type @labelname to assign a label. If the label doesn't exist, it's created automatically." },
      { label: 'Priority', description: 'Type p:low, p:normal, p:high, or p:urgent to set priority.' },
      { label: 'Due date', description: 'Type d:today, d:tomorrow, d:monday, d:jan15, etc. to set a due date. Natural language parsing is supported.' },
      { label: 'Reference URL', description: 'Type r:https://example.com to attach a reference link to the task.' }
    ]
  },
  {
    title: 'Auto-Update',
    items: [
      { label: 'Checking for updates', description: 'ToDoozy checks for updates automatically every 4 hours and on launch. You can also check manually in Settings → Updates.' },
      { label: 'Installing updates', description: 'When an update is available, a banner appears with release notes. Click Download to start, then Install & Restart to apply. Updates install on quit if not applied immediately.' }
    ]
  },
  {
    title: 'MCP — AI Integration',
    items: [
      { label: 'What is MCP?', description: 'The Model Context Protocol lets Claude (or any MCP-compatible AI) read and manage your task list directly — without copy-pasting. Enable in Settings → MCP.' },
      { label: 'Setting up', description: "Go to Settings → MCP to get your connection config. Paste it into Claude's MCP settings. Claude can then create, update, and complete tasks on your behalf." },
      { label: 'Available operations', description: 'List tasks, create tasks, update tasks, complete tasks, and create projects — all through natural language instructions to Claude.' }
    ]
  }
]

function getShortcuts(appToggleShortcut: string): { category: string; entries: ShortcutEntry[] }[] {
  return [
    {
      category: 'Navigation',
      entries: [
        { keys: '⌘1', description: 'My Day', category: 'Navigation' },
        { keys: '⌘2', description: 'Project view (first project)', category: 'Navigation' },
        { keys: '⌘3', description: 'Archive', category: 'Navigation' },
        { keys: '⌘4', description: 'Templates', category: 'Navigation' },
        { keys: '⌘L', description: 'Toggle kanban / list view', category: 'Navigation' },
        { keys: 'Tab / Shift+Tab', description: 'Cycle projects (no task selected)', category: 'Navigation' }
      ]
    },
    {
      category: 'Tasks',
      entries: [
        { keys: 'Enter', description: 'Open task detail panel', category: 'Tasks' },
        { keys: 'Space', description: 'Toggle task status', category: 'Tasks' },
        { keys: '⌘C', description: 'Copy selected task title(s)', category: 'Tasks' },
        { keys: 'Delete / Backspace', description: 'Delete selected task(s)', category: 'Tasks' },
        { keys: 'Shift+Click', description: 'Select a range of tasks', category: 'Tasks' },
        { keys: '⌘Click', description: 'Toggle individual selection', category: 'Tasks' }
      ]
    },
    {
      category: 'Detail Panel',
      entries: [
        { keys: 'Tab', description: 'Cycle fields (title → status → priority → labels → due date → description)', category: 'Detail Panel' },
        { keys: 'Shift+Tab', description: 'Reverse through fields', category: 'Detail Panel' },
        { keys: 'Escape', description: 'Close panel, return focus to task list', category: 'Detail Panel' }
      ]
    },
    {
      category: 'Global',
      entries: [
        { keys: '⌘K', description: 'Open command palette', category: 'Global' },
        { keys: '?', description: 'Show keyboard shortcuts', category: 'Global' },
        { keys: appToggleShortcut, description: 'Show / hide ToDoozy from anywhere', category: 'Global' }
      ]
    }
  ]
}

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}

export function HelpSettingsContent(): React.JSX.Element {
  const appToggleShortcut = useSetting('app_toggle_shortcut') ?? 'Cmd+Shift+B'
  const [search, setSearch] = useState('')
  const query = search.trim()

  const filteredSections = useMemo(() => {
    if (!query) return HELP_SECTIONS
    return HELP_SECTIONS
      .map((section) => {
        if (matchesQuery(section.title, query)) return section
        const filtered = section.items.filter(
          (item) => matchesQuery(item.label, query) || matchesQuery(item.description, query)
        )
        return filtered.length > 0 ? { ...section, items: filtered } : null
      })
      .filter((s): s is HelpSectionData => s !== null)
  }, [query])

  const shortcuts = useMemo(() => getShortcuts(appToggleShortcut), [appToggleShortcut])

  const filteredShortcuts = useMemo(() => {
    if (!query) return shortcuts
    return shortcuts
      .map((group) => {
        if (matchesQuery(group.category, query) || matchesQuery('keyboard shortcuts', query)) return group
        const filtered = group.entries.filter(
          (e) => matchesQuery(e.keys, query) || matchesQuery(e.description, query)
        )
        return filtered.length > 0 ? { ...group, entries: filtered } : null
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
  }, [query, shortcuts])

  const hasResults = filteredSections.length > 0 || filteredShortcuts.length > 0

  return (
    <div className="flex flex-col gap-8">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Help & Documentation</p>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search help..."
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 pl-8 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
        />
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted/50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted/50 hover:text-foreground"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {!hasResults && (
        <p className="text-sm font-light text-muted">No results for &ldquo;{query}&rdquo;</p>
      )}

      {filteredSections.map((section) => (
        <HelpSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <HelpItem key={item.label} label={item.label} description={item.description} />
          ))}
        </HelpSection>
      ))}

      {/* Keyboard Shortcuts Reference */}
      {filteredShortcuts.length > 0 && (
        <HelpSection title="Keyboard Shortcuts">
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <tbody className="divide-y divide-border/30">
                {filteredShortcuts.map((group) => (
                  <React.Fragment key={group.category}>
                    <tr className="bg-foreground/3">
                      <td colSpan={2} className="px-3 py-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted">{group.category}</span>
                      </td>
                    </tr>
                    {group.entries.map((entry) => (
                      <ShortcutTableRow key={entry.keys} keys={entry.keys} description={entry.description} />
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </HelpSection>
      )}
    </div>
  )
}
