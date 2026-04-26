import React, { useState, useMemo } from 'react'
import { useSetting } from '../../shared/stores/settingsStore'
import { useSidebarItems } from '../sidebar'

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
      { label: 'Subtasks', description: 'Right-click a task → Add Subtask, or open the detail panel and use the Subtasks section. Drag a task onto the middle of another task to nest it. A progress bar shows done/total subtask count.' },
      { label: 'Status', description: 'Click the status circle on a task row to cycle through statuses. Right-click for a full status submenu. Each project has configurable statuses (default: Not Started, In Progress, Done).' },
      { label: 'Priorities', description: 'Set priority via right-click menu, the detail panel, or smart input (p:low / p:normal / p:high / p:urgent). Configure how priority is displayed in Settings → Appearance → Priority Display.' },
      { label: 'Due dates', description: 'Set due dates in the detail panel or via smart input (d:today, d:tomorrow, d:monday, d:jan15). Tasks due today can automatically appear in My Day (see My Day Auto-Add setting).' },
      { label: 'Multi-select', description: 'Click to select one task. Shift+click to select a range. Cmd+click to toggle individual tasks. Selected tasks can be moved, archived, or deleted together.' },
      { label: 'Reference URL', description: 'Attach a reference link to any task via the detail panel or smart input (r:https://...). Click the link icon on the task row to open it in your browser.' },
      { label: 'Copy to clipboard', description: 'Press Cmd+C to copy selected task titles. Single task copies as plain text, multiple tasks as a bulleted markdown list. Also available in the context menu.' }
    ]
  },
  {
    title: 'My Day',
    items: [
      { label: 'What appears in My Day', description: "Tasks you've explicitly pinned to My Day, plus any tasks with a due date of today (if auto-add is enabled). Grouped by project." },
      { label: 'Adding to My Day', description: 'Right-click any task → Pin to My Day. Or open the task detail panel and toggle the My Day switch. Use the quick-add window (Cmd+Shift+Space) to add directly.' },
      { label: 'Quick-add from anywhere', description: 'Press Cmd+Shift+Space (configurable in Settings → General) to open the quick-add window without switching to ToDoozy. The task goes into My Day.' },
      { label: 'Auto-add setting', description: 'In Settings → General, enable "Auto-add tasks due today to My Day" to have tasks with today\'s due date appear in My Day automatically on launch. You can also control whether dismissed tasks re-appear the next day.' }
    ]
  },
  {
    title: 'Calendar View',
    items: [
      { label: 'Opening the calendar', description: 'Click the Calendar icon in the sidebar to see all tasks with due dates across every project. Toggle between month and week view using the header controls.' },
      { label: 'Navigating dates', description: 'Use the arrow buttons to move between months or weeks. Click "Today" to jump back to the current date. Click any day to see its tasks.' },
      { label: 'Managing tasks from the calendar', description: 'Click a task on the calendar to open its detail panel. Drag tasks between days to change their due date. Tasks without due dates do not appear in the calendar. Overdue tasks appear in red, today is highlighted.' }
    ]
  },
  {
    title: 'Projects',
    items: [
      { label: 'Creating projects', description: "Click the + button next to 'Projects' in the sidebar. Choose a name and color. Default statuses (Not Started, In Progress, Done) are created automatically." },
      { label: 'Project settings', description: 'Open Settings → Projects to rename, recolor, reorder, and configure statuses for each project. You can also set per-project auto-archive timeframes here.' },
      { label: 'Sharing projects', description: 'Open project settings → Share to invite other users by email. Shared projects sync in real-time — all members see task changes, status updates, and member avatars instantly.' },
      { label: 'Project areas (folders)', description: 'Group projects into collapsible folders in the sidebar. Hover over the Projects header → click Folder, or go to Settings → Projects → Sidebar & Folders. Drag projects into folders to organize them.' },
      { label: 'Templates', description: 'Save any project as a template via the template icon in the header. When saving, you can include due dates as relative offsets. Deploy templates from the Templates view — a wizard lets you pick a deploy date and previews the computed due dates.' }
    ]
  },
  {
    title: 'Labels',
    items: [
      { label: 'Global labels', description: 'Labels are shared across all projects. Create a label once and use it anywhere. Renaming or recoloring a label updates it everywhere.' },
      { label: 'Assigning labels', description: 'Click the label icon on a task row, or use the detail panel. Smart input: type @labelname while adding a task to assign on creation.' },
      { label: 'Filtering by label', description: 'Click any label chip in the filter bar to filter. Use the three-way toggle to switch between "is any of" (OR), "is all of" (AND), or "is not" (exclusion) mode.' },
      { label: 'Managing labels', description: 'Go to Settings → Labels to create, rename, recolor, and delete labels. You can see usage counts for each label across projects and tasks.' }
    ]
  },
  {
    title: 'Filters',
    items: [
      { label: 'Filter bar', description: 'A filter bar appears at the top of every task view. Label and project scope filters are always visible. Click "+ Filter" to add priority, due date, status, assignee, or keyword filters.' },
      { label: 'Priority filter', description: 'Multi-select from None, Low, Normal, High, Urgent. Both include ("is") and exclude ("is not") modes are available.' },
      { label: 'Due date filter', description: 'Quick presets: Today, This Week, Overdue, No Date. Or pick a custom date range with start and end dates.' },
      { label: 'Status filter', description: "Multi-select from the current project's statuses. Supports include and exclude modes." },
      { label: 'Assignee filter', description: 'Multi-select from project members. Available in shared projects. Supports include and exclude modes.' },
      { label: 'Keyword filter', description: 'Free text search that matches against task titles and descriptions.' },
      { label: 'Exclusion filters', description: 'Every filter type supports "is not" (exclusion) mode. Exclusion filters appear with muted-red styling to distinguish them from inclusion filters.' },
      { label: 'Combining filters', description: 'All active filters combine with AND logic. Each active filter shows as a removable chip. Click "Clear all" to reset every filter.' }
    ]
  },
  {
    title: 'Saved Views (Smart Lists)',
    items: [
      { label: 'Creating a view', description: 'Set up filters in the filter bar, then click "Save as View." Give it a name — it appears in the sidebar immediately with a live task count badge and a colored dot.' },
      { label: 'Using a view', description: 'Click a saved view in the sidebar to load its filters. Tweak filters as needed — changes are not auto-saved. Click "Update View" when filters differ from the stored config.' },
      { label: 'Sorting', description: 'Saved views (and project views) support multi-sort. Click the sort dropdown to add stackable sort rules — due date, priority, title, created date, etc. Choose "Custom" to enable drag-and-drop reordering. Sort preferences persist per view.' },
      { label: 'Managing views', description: 'Right-click a view → Rename, Duplicate, or Delete. Drag views to reorder in the sidebar. If a label or status referenced by a view is deleted, a warning icon appears.' }
    ]
  },
  {
    title: 'Command Palette',
    items: [
      { label: 'Opening', description: 'Press Cmd+K to open the command palette. Type to search tasks by title. Click any result (or press Enter) to open the task in its project with the detail panel.' },
      { label: 'Search operators', description: 'Narrow results with operators: p:high (priority), l:work (label), s:done (status contains), due:today (due date), has:subtasks (has subtasks). Operators can be combined: "p:high due:today" finds high-priority tasks due today.' },
      { label: 'Navigation', description: 'Selecting a result navigates to the task\'s project, clears any active filters, and scrolls the task into view. Up to 12 results are shown at once.' }
    ]
  },
  {
    title: 'Kanban View',
    items: [
      { label: 'Toggling kanban', description: 'Press Cmd+L or click the Kanban button in the header. Available in My Day and project views. Each project remembers your last view mode.' },
      { label: 'Moving cards', description: 'Drag cards between columns to change status. Drag within a column to reorder. Cards show priority, labels, due date, and assignee avatar.' }
    ]
  },
  {
    title: 'Drag & Drop',
    items: [
      { label: 'Reordering tasks', description: 'Drag a task up or down to reorder within the same status group. A drop indicator line shows where the task will land.' },
      { label: 'Nesting (subtasks)', description: 'Drag a task onto the middle of another task to make it a subtask. The target row highlights when you\'re in the nesting zone (middle 60% of the row).' },
      { label: 'Moving to projects', description: 'Drag a task onto a project name in the sidebar to move it to that project. Works with multi-selected tasks too.' },
      { label: 'Quick actions', description: 'Drag tasks onto sidebar items for quick actions: My Day to pin, Archive to archive, Calendar to set a due date.' }
    ]
  },
  {
    title: 'Context Menu',
    items: [
      { label: 'Opening', description: 'Right-click any task to open the context menu. It provides quick access to all task actions without opening the detail panel.' },
      { label: 'Actions available', description: 'Status (with dynamic project statuses), Priority submenu, Recurrence submenu, Labels flyout, Snooze submenu, Pin/Unpin My Day, Add Subtask, Duplicate, Copy, Save as Template, Archive, and Delete.' },
      { label: 'Flyout submenus', description: 'Submenus open on hover after a brief delay. They automatically open left or right based on available screen space.' }
    ]
  },
  {
    title: 'Rich Text Editor',
    items: [
      { label: 'Description editor', description: 'The task description uses a full rich text editor with a fixed toolbar at the top and a floating bubble toolbar when you select text.' },
      { label: 'Formatting', description: 'Bold (Cmd+B), Italic (Cmd+I), Strikethrough, Inline code, Links (Cmd+K to add/edit), Headings, Bullet/Numbered lists, Interactive checklists, and Code blocks.' },
      { label: 'Slash commands', description: 'Type / to see all formatting options: /h1, /h2, /h3 for headings, /bullet for bullet list, /numbered for numbered list, /checklist for interactive checklist, /code for code block.' },
      { label: 'Image paste', description: 'Paste an image directly into the description to embed it inline. Images are stored locally.' }
    ]
  },
  {
    title: 'Recurrence',
    items: [
      { label: 'Setting recurrence', description: 'Open the detail panel → click the Recurrence field. Choose from Daily, Weekly, Monthly, Yearly, or Custom. The Smart Recurrence Picker shows a live preview of upcoming dates.' },
      { label: 'Custom schedules', description: "Create advanced patterns: every 2 weeks on Monday, specific weekdays, every 3rd of the month, etc. Set an end date or 'after N occurrences' limit." },
      { label: 'After-completion mode', description: "Choose 'after completion' to count from when you actually finish the task, rather than the original due date. Useful for tasks that slip." },
      { label: 'How it works', description: 'When you complete a recurring task, a new occurrence is created automatically with the next due date. A toast appears with a link to the new task. The completed task stays in your history.' }
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
      { label: 'Auto-archive (global)', description: 'Enable in Settings → General. Completed tasks are automatically archived after a configurable delay (e.g., 3 days). This setting applies to all local projects unless overridden per-project.' },
      { label: 'Per-project auto-archive', description: 'Override the global auto-archive setting for individual projects in Settings → Projects. Each project can have its own timeframe (e.g., 1 day, 7 days, 30 days) or disable auto-archive entirely.' },
      { label: 'Manual archive', description: 'Right-click a task → Archive, or toggle archive in the detail panel. In shared projects, manually archiving a task moves it to the archive for all members. Archiving a parent task also archives its subtasks.' },
      { label: 'Restoring tasks', description: 'Go to the Archive view in the sidebar. Click the restore button on any task to unarchive it. In shared projects, restoring a task makes it visible to all members again.' },
      { label: 'Shared projects', description: 'Tasks in shared projects can only be archived manually, never automatically. Archived shared tasks appear in every member\'s archive and can be restored by any member.' }
    ]
  },
  {
    title: 'Due Date Notifications',
    items: [
      { label: 'How they work', description: 'When a task has a due date with a time component, ToDoozy sends a native macOS notification before the deadline. A second 1-minute warning fires just before the due time.' },
      { label: 'Configuring', description: 'Go to Settings → General → Notifications. Toggle notifications on or off. Choose a lead time (5, 10, 15, 30, or 60 minutes before) from the dropdown.' },
      { label: 'Click to navigate', description: 'Clicking a notification focuses the ToDoozy window and navigates to the task. Notifications are not sent for completed, archived, or template tasks.' }
    ]
  },
  {
    title: 'Productivity Stats',
    items: [
      { label: 'Opening stats', description: 'Click Stats in the sidebar footer (or press the assigned shortcut) to view your productivity dashboard.' },
      { label: 'Overview cards', description: 'See tasks completed today, this week, and this month, along with focus time (from Pomodoro sessions) for today and this week.' },
      { label: 'Charts', description: 'Completion chart shows daily task completions as a bar chart. Focus time chart shows daily focus minutes. Switch between 7, 30, or 90 day ranges.' },
      { label: 'Streaks', description: 'Track your current streak (consecutive days with at least 1 completion) and your all-time best streak. A fire icon highlights active streaks.' },
      { label: 'Activity heatmap', description: 'A 90-day GitHub-style contribution heatmap shows your completion density over time. Darker squares mean more tasks completed that day.' },
      { label: 'Team stats', description: 'When filtering by a shared project, see per-member completion counts and focus time with a leaderboard-style ranking.' },
      { label: 'Filters', description: 'Use the project dropdown (All Projects or a specific one) and time range selector (7 / 30 / 90 days) to focus your stats.' }
    ]
  },
  {
    title: 'Pomodoro Timer',
    items: [
      { label: 'Starting a timer', description: 'Hover over any task and click the play button. A small picker opens — pick Flowtime (counts up, stop when done) or Timer (counts down). For Timer, pick Limited (fixed reps) or Infinite. Hit Enter or click Start.' },
      { label: 'Timer controls', description: 'Click the menu bar timer to pause, resume, or stop from anywhere on your Mac. When a work timer finishes, a break timer starts automatically.' },
      { label: 'Default mode and skipping the popup', description: 'Settings → Timer has a Default mode picker (Flowtime / Timer) and a Default duration picker (Limited / Infinite) so the popup opens pre-selected. Turn on Skip start dialog under Behavior to start instantly with your defaults instead of opening the popup.' },
      { label: 'Sessions and repetitions', description: 'With Timer + Limited, set the number of work-break reps. After a configurable number of work sessions, a long break kicks in.' },
      { label: 'Timer settings', description: 'Go to Settings → Timer to configure presets, work duration, short break, long break, default mode, default duration, and auto-start behavior. Flowtime users can also set cookie-break minutes per hour. Timer activity is logged in Productivity Stats.' }
    ]
  },
  {
    title: 'Themes & Appearance',
    items: [
      { label: 'Dark and light mode', description: 'Toggle between dark and light mode using the sun/moon icon at the bottom of the sidebar.' },
      { label: 'Built-in themes', description: 'Go to Settings → Appearance → Theme. Choose from 12 built-in themes (6 dark, 6 light). Each theme defines an 8-color palette.' },
      { label: 'Custom themes', description: 'Customize any of the 8 color slots using the color pickers. Click "Apply" to save. Use "Save as new theme" to keep your customization as a reusable preset.' },
      { label: 'Priority display', description: 'Go to Settings → Appearance → Priority Display. Toggle visual indicators: color bar (left border), badges (icon + label), background tint (subtle color on higher-priority rows), font weight, and auto-sort (sorts tasks by priority within each status group). Each toggle has a live preview.' }
    ]
  },
  {
    title: 'Menu Bar (Tray)',
    items: [
      { label: 'Menu bar icon', description: 'ToDoozy shows a monochrome icon in the macOS menu bar with a badge count of your My Day tasks.' },
      { label: 'Left-click menu', description: 'Left-click the menu bar icon to see your My Day tasks. Click any task to open or complete it.' },
      { label: 'Right-click menu', description: 'Right-click for quick access to: Quick Add, Open ToDoozy, Settings, and Quit.' },
      { label: 'Close-to-tray', description: 'Closing the main window does not quit the app — it minimizes to the menu bar. Click the dock icon or menu bar icon to reopen.' }
    ]
  },
  {
    title: 'Sidebar Customization',
    items: [
      { label: 'Show and hide items', description: 'Go to Settings → General → Sidebar Items. Toggle visibility of Calendar, Stats, Views, Archive, and Templates. My Day is always visible.' },
      { label: 'Reorder items', description: 'Drag sidebar items to reorder them. Keyboard shortcuts (Cmd+1, Cmd+2, etc.) update dynamically based on your ordering.' }
    ]
  },
  {
    title: 'Sync & Multi-Device',
    items: [
      { label: 'How sync works', description: 'All data (tasks, projects, settings, themes, saved views, areas) syncs automatically to Supabase. SQLite is the local source of truth — changes push in the background and pull via real-time subscriptions.' },
      { label: 'New device setup', description: 'Log in on a new device and all your data pulls down automatically. No manual import needed.' },
      { label: 'Offline support', description: 'Personal projects are fully usable offline — create, edit, and complete tasks without internet. Shared projects become read-only when offline. Changes sync when you reconnect.' },
      { label: 'Sync status', description: 'A sync status icon in the sidebar shows your current connection state — green for synced, orange for syncing, red for offline.' }
    ]
  },
  {
    title: 'File Attachments',
    items: [
      { label: 'Attaching files', description: 'Enable iCloud Drive in Settings → About → Integrations. Then use the attachment icon in the task description toolbar to attach files. Files sync to iCloud Drive for access from other devices.' },
      { label: 'Viewing attachments', description: 'Attachment cards appear below the description. Click to open in the default macOS app. Hover to see the remove button.' },
      { label: 'Limits', description: 'Maximum 10 MB per file, 10 attachments per task.' }
    ]
  },
  {
    title: 'Smart Input',
    items: [
      { label: 'Labels', description: "Type @labelname to assign a label. A popup shows matching suggestions as you type. If the label doesn't exist, it's created automatically." },
      { label: 'Priority', description: 'Type p:low, p:normal, p:high, or p:urgent to set priority.' },
      { label: 'Due date', description: 'Type d:today, d:tomorrow, d:monday, d:jan15, etc. to set a due date. Natural language parsing is supported.' },
      { label: 'Reference URL', description: 'Type r:https://example.com to attach a reference link to the task.' }
    ]
  },
  {
    title: 'Templates',
    items: [
      { label: 'Task templates', description: 'Right-click any task → Save as Template. Templates are global across all projects. Use a template from the Templates view or via right-click → Use Template with a project picker.' },
      { label: 'Project templates', description: 'Save an entire project as a template via the template icon in the project header. Deploy from the Templates view using a multi-step wizard.' },
      { label: 'Relative due dates', description: 'When saving a project template, choose whether to include due dates as relative offsets (e.g., "+3 days from deploy date"). When deploying, pick a start date and the wizard previews computed due dates for each task.' },
      { label: 'Managing templates', description: 'The Templates view shows all templates with search. Edit or delete templates from there.' }
    ]
  },
  {
    title: 'Auto-Update',
    items: [
      { label: 'Checking for updates', description: 'ToDoozy checks for updates automatically every 4 hours and on launch. You can also check manually in Settings → About → Updates.' },
      { label: 'Installing updates', description: 'When an update is available, a dialog shows the version and release notes. Click Download to start, then Install & Restart to apply. Updates install on quit if not applied immediately.' },
      { label: "What's New", description: 'Go to Settings → About → What\'s New to see release notes for all versions. A notification dot appears when new content is available since you last checked.' }
    ]
  },
  {
    title: 'Integrations',
    items: [
      { label: 'MCP — AI Integration', description: 'The Model Context Protocol lets Claude (or any MCP-compatible AI) manage your tasks directly. Go to Settings → About → Integrations to enable the MCP server and copy the config JSON for your AI client.' },
      { label: 'MCP capabilities', description: 'Full CRUD for tasks, subtasks, projects, labels, and statuses. Search with filters, manage My Day, deploy templates, reorder tasks, and create saved views — all through natural language.' },
      { label: 'Telegram Bot', description: 'Add tasks from Telegram using smart input syntax. Commands: send a message to create a task, /project to list projects and complete tasks, /myday to see today\'s tasks, /done to complete by keyword, /default to set default project.' },
      { label: 'Default project per integration', description: 'In Settings → About → Integrations, set a default project separately for Telegram and iOS Shortcuts. New tasks from each integration go to their respective default project.' },
      { label: 'iCloud Drive', description: 'Link iCloud Drive in Settings → About → Integrations to enable file attachments on tasks. Files sync across your devices via iCloud.' }
    ]
  }
]

const NAV_ITEM_NAMES: Record<string, string> = {
  'my-day': 'My Day',
  'calendar': 'Calendar',
  'views': 'Views (first saved view)',
  'projects': 'Projects (first project)',
  'archive': 'Archive',
  'templates': 'Templates'
}

function getShortcuts(appToggleShortcut: string, sidebarItems: Array<{ id: string; shortcut: string }>): { category: string; entries: ShortcutEntry[] }[] {
  const navEntries: ShortcutEntry[] = sidebarItems.map((item) => ({
    keys: item.shortcut,
    description: NAV_ITEM_NAMES[item.id] ?? item.id,
    category: 'Navigation'
  }))
  navEntries.push(
    { keys: '⌘L', description: 'Toggle kanban / list view', category: 'Navigation' },
    { keys: 'Tab / Shift+Tab', description: 'Cycle projects (no task selected)', category: 'Navigation' }
  )

  return [
    {
      category: 'Navigation',
      entries: navEntries
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

  const sidebarItems = useSidebarItems()
  const shortcuts = useMemo(() => getShortcuts(appToggleShortcut, sidebarItems), [appToggleShortcut, sidebarItems])

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
