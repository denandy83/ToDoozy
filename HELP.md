# ToDoozy — User Guide

Everything you need to know to use ToDoozy effectively.

---

## Getting Started

When you first open ToDoozy, you'll be asked to log in with your email and password or Google account. After logging in, a **Personal** project is created for you automatically.

The app has three areas:
- **Sidebar** (left) — navigate between views and projects
- **Task list** (center) — your tasks
- **Detail panel** (right or bottom) — edit a task's details

---

## Adding Tasks

**From any view:**
1. Click the "Add task" input at the top of the task list
2. Type your task title and press Enter

**Smart shortcuts while typing:**
- `@work` — assigns the label "work" (creates it if it doesn't exist)
- `p:high` — sets priority to High (options: low, normal, high, urgent)
- `d:today` — sets due date to today (also: tomorrow, monday, Jan 15, etc.)
- `r:https://...` — attaches a reference URL to the task

**From anywhere on your Mac:**
- Press **Cmd+Shift+Space** to open the quick-add window (works even when ToDoozy is hidden)
- Type your task and press Enter — it goes straight into My Day

---

## My Day

My Day shows all tasks you've flagged for today plus any tasks due today (if auto-add is enabled), grouped by project.

**To add a task to My Day:**
- Right-click any task → Pin to My Day
- Or open the task detail panel and toggle "My Day"

**To remove from My Day:**
- Right-click → Unpin from My Day

### Auto-add tasks due today
In **Settings → General**, enable **"Auto-add tasks due today to My Day"** to have tasks with today's due date appear in My Day automatically on launch. You can also control whether dismissed tasks re-appear the next day with the **"Re-add dismissed tasks"** setting.

---

## Projects

### Creating a project
1. Click **+ New Project** in the sidebar
2. Choose a name, color, and emoji icon

### Switching between projects
Click the project name in the sidebar. Each project keeps its own task list and remembers whether you were in list or kanban view.

### Project settings
Click the gear icon next to a project name (hover to reveal) to open project settings:
- Rename, change color, change icon
- Add, rename, reorder, or delete statuses
- Sidebar & Folders — reorder projects, create/manage folders, drag projects into folders

---

## Task Status

Each project has configurable statuses (default: Not Started, In Progress, Done).

**To change a task's status:**
- Click the status circle/button on the task row
- Or right-click the task for a full status submenu
- Or open the detail panel and click any status button

---

## Organizing Tasks

### Subtasks
1. Right-click a task → Add Subtask
2. Or open the task and use the Subtasks section in the detail panel

To make an existing task a subtask, drag it on top of another task (aim for the middle of the row).

### Drag and drop
- Drag a task up or down to reorder it within the same status group
- A full-width ghost row follows your cursor vertically while the original fades in place
- Drop indicator lines show where the task will land (above or below the target)
- Drag onto the middle of a task → make it a subtask (the target highlights)
- Drag a task onto a project in the sidebar → move it to that project
- Drag onto My Day, Calendar, or Archive in the sidebar for quick actions

### Moving multiple tasks
1. Click to select a task; Shift+click to add a range; Cmd+click to add individual tasks
2. Drag any selected task onto a project in the sidebar to move all of them at once

---

## Task Details

Click any task to open the detail panel on the right (or bottom — configurable in Settings).

### What you can edit:
- **Title** — type and it saves automatically after 1 second
- **Status** — click any status button
- **Priority** — click None/Low/Normal/High/Urgent
- **Labels** — click "+ Add" to pick or create labels
- **Due date** — click the date field; optionally set a time
- **Recurrence** — repeat daily, weekly, monthly, or custom schedule (see Recurrence section below)
- **Snooze** — hide the task until later (see Snooze section below)
- **Reference URL** — attach a link to a related webpage, ticket, or document
- **Description** — full rich text editor (see below)
- **Attachments** — attach files from your Mac (requires iCloud setup)
- **Subtasks** — add, check off, and reorder subtasks
- **Activity** — see a history of all changes to this task

Press **Escape** to close the detail panel.

---

## Rich Text Description

The description field is a full rich text editor.

**Formatting shortcuts:**
- `**text**` or Cmd+B — Bold
- `*text*` or Cmd+I — Italic
- `~~text~~` — Strikethrough
- `` `code` `` — Inline code
- Cmd+K — Add or edit a link

**Slash commands** — type `/` to see all options:
- `/h1`, `/h2`, `/h3` — Headings
- `/bullet` — Bullet list
- `/numbered` — Numbered list
- `/checklist` — Interactive checklist (click items to check them off)
- `/code` — Code block

**Pasting:** paste an image directly into the description and it appears inline.

---

## Labels

Labels help you group tasks across projects. Labels are global — create once, use anywhere.

### Creating labels
- Type `@labelname` when adding a task
- Or open a task's detail panel → click "+ Add" in Labels
- Or go to Settings → Labels

### Filtering by label
Use the filter bar at the top of any view to filter by label. See the **Filters** section above for all available filter types.

### Managing labels (Settings → Labels)
- Rename or change a label's color — applies everywhere
- Remove a label from a specific project without deleting it
- Delete a label everywhere

---

## Search (Command Palette)

Press **Cmd+K** to open the command palette.

Type to search by task title. Use operators to narrow results:
- `p:high` — priority is High (options: low, normal, high, urgent)
- `l:work` — has the "work" label
- `s:done` — status contains "done"
- `due:today` — due today
- `has:subtasks` — has at least one subtask

Operators can be combined: `p:high due:today` finds high-priority tasks due today.

Click any result to open the task in the detail panel.

---

## Views (Smart Lists)

Save any filter combination as a reusable view. Views appear in the sidebar between Calendar and Projects with live task count badges and colored dots.

### Creating a view
1. Set up filters in the filter bar (labels, priority, status, due date, keyword)
2. Click **Save as View** in the filter bar
3. Give it a name — it appears in the sidebar immediately with an auto-assigned color dot

### Using a view
- Click a saved view in the sidebar to load its filters
- Tweak filters as needed — changes are not auto-saved
- Click **Update View** when filters differ from the stored config to save changes

### Sorting
Views (and project views) support multi-sort. Click the sort dropdown to add stackable sort rules — due date, priority, title, created date, etc. Choose "Custom" to enable drag-and-drop reordering. Sort preferences persist per view.

### Managing views
- Right-click a view → Rename, Duplicate, or Delete
- Drag views to reorder them in the sidebar
- If a label or status referenced by a view is deleted, a warning icon appears with a tooltip explaining what's missing

---

## Stats Dashboard

Click **Stats** in the sidebar (or press **⌘3**) to see your productivity metrics.

### Overview cards
- Tasks completed today, this week, and this month
- Focus time today and this week

### Charts
- **Completion chart** — daily task completions as a bar chart
- **Focus time chart** — daily focus minutes as a bar chart
- **Time range** — switch between 7, 30, or 90 days

### Streaks & gamification
- Current streak (consecutive days with at least 1 completion)
- Best streak badge
- 90-day activity heatmap (GitHub contribution style) showing completion density

### Team stats
- When viewing a shared project, see per-member completion counts and focus time
- Leaderboard-style ranking by completions for the selected time period

### Filters
- Project dropdown: All Projects or a specific project
- Time range: 7 / 30 / 90 days

---

## Project Folders

Group projects into collapsible folders in the sidebar for better organization.

### Creating a folder
- Hover over the Projects header in the sidebar → click **Folder**
- Or go to Settings → Projects → Sidebar & Folders → **New Folder**

### Assigning projects to folders
- In Settings → Projects → Sidebar & Folders: drag a project onto a folder header
- Drag cursor to the right (past the indent line) to assign, or to the left to keep ungrouped

### Managing folders
- **Collapse/expand** — click the chevron on any folder header
- **Rename** — double-click the folder name in Settings, or click the pencil icon
- **Delete** — click the trash icon (shows confirmation toast). Deleting a folder ungroups its projects without deleting them
- **Reorder** — drag folders and ungrouped projects to reorder in Settings

### Per-user scoping
Each user's folder assignments are independent — they are not synced to other members of shared projects.

---

## Filters

A filter bar appears at the top of every task view. Filters combine with AND logic.

### Always visible
- **Labels** — click to toggle label filters. Use the three-way toggle to switch between "is any of" (OR), "is all of" (AND), or "is not" (exclusion) mode
- **Project scope** — narrow to a specific project or view all

### Additional filters (via + Filter button)
- **Priority** — multi-select: None, Low, Normal, High, Urgent
- **Due date** — presets (Today, This Week, Overdue, No Date) or custom date range
- **Status** — multi-select from the current project's statuses
- **Assignee** — multi-select from project members
- **Keyword** — text search matching task title and description

### Exclusion filters ("is not")
Every filter type supports exclusion mode. When set to "is not," tasks matching the filter are hidden instead of shown. Exclusion filters appear with muted-red styling to distinguish them from inclusion filters. If both "is" and "is not" are set for the same filter type, the last action wins.

### Managing filters
- Each active filter shows as a removable chip
- Click the **X** on any chip to remove that filter
- **Clear all** resets every filter type

---

## Calendar View

Click the **Calendar** icon in the sidebar to see all tasks with due dates across every project.

- Toggle between **month** and **week** view using the header controls
- Use the arrow buttons to navigate between months or weeks; click **Today** to jump back
- Click any day to see its tasks
- Drag tasks between days to change their due date
- Tasks without due dates do not appear in the calendar

---

## Kanban View

Press **Cmd+L** to switch between list and kanban view in any project.

In kanban view, each status is a column. Drag tasks between columns to change their status. All other interactions (click to edit, right-click for context menu, etc.) work the same as in list view.

---

## Priority

Tasks have 5 priority levels: None, Low, Normal, High, Urgent.

In **Settings → Appearance → Priority Display**, you can toggle visual indicators:
- **Color bar** — a colored left border on the task row
- **Badges** — priority icon + label shown on the row
- **Background tint** — subtle color tint on higher-priority rows
- **Auto-sort** — automatically sort tasks within a status group by priority

---

## Themes

Go to **Settings → Appearance → Theme** to change the app's appearance.

- Toggle between **dark** and **light** mode
- Choose from 12 built-in themes
- Customize any of the 8 color slots with the color pickers
- Click **Apply** to save your changes
- Use **Save as new theme** to keep a custom theme

---

## Templates

### Task templates
1. Right-click any task → Save as Template
2. To use a template: right-click where you want to add a task → Use Template, or go to the Templates view
3. Task templates are global — they can be used in any project

### Project templates
1. Open project settings → Save as Template
2. To deploy: Templates view → choose a project template → Deploy → follow the wizard

### Relative due dates
When saving a project template, you can choose to include due dates as relative offsets (e.g., "+3 days from deploy date"). When deploying:
- A wizard step lets you pick a deploy date (defaults to today)
- A preview shows the computed due dates for each task
- Subtasks carry their offsets too
- Tasks without due dates are skipped

---

## Archiving

### Auto-archive (global)
Enable in **Settings → General**. Completed tasks are automatically archived after a configurable delay (e.g., 3 days). This global setting applies to all local projects unless overridden per-project.

### Per-project auto-archive
Override the global auto-archive setting for individual projects in **Settings → Projects**. Each project can have its own timeframe (e.g., 1 day, 7 days, 30 days) or disable auto-archive entirely. Shared projects always require manual archiving.

### Manual archive
Right-click a task → **Archive**, or toggle archive in the detail panel. In shared projects, manually archiving a task moves it to the archive for **all members**. Archiving a parent task also archives its subtasks.

### Restoring tasks
Go to the **Archive** view in the sidebar. Click the restore button on any task to unarchive it. In shared projects, restoring a task makes it visible to all members again.

### Shared projects and archiving
Tasks in shared projects can only be archived manually, never automatically. Archived shared tasks appear in every member's archive and can be restored by any member.

When a project is **deleted**, all its tasks — including archived ones — are permanently removed. When a shared project is **unshared** and kept locally, all archived tasks are preserved in the local copy with their archive status intact.

---

## Recurrence

Open the task detail panel → click the **Recurrence** field to set a repeating schedule.

**Built-in frequencies:** Daily, Weekly, Monthly, Yearly.

**Custom schedules:** Create advanced patterns like "every 2 weeks on Monday" or "every 3rd of the month." You can set an end date or an "after N occurrences" limit.

**After-completion mode:** Choose "after completion" to count from when you actually finish the task rather than the original due date. Useful for tasks that slip.

When you complete a recurring task, a new occurrence is created automatically with the next due date. The completed task stays in your history.

---

## Snooze

Right-click a task → **Snooze**, or use the snooze button in the detail panel. The task disappears from your list until the snooze time arrives.

**Preset options:**
- **Later Today** — 3 hours from now
- **Tomorrow** — 9 AM tomorrow
- **Next Week** — Monday at 9 AM
- **Custom** — pick any date and time

When a snoozed task wakes up, it reappears in your task list and shows a notification. If it was pinned to My Day, it returns there too.

---

## Sharing Projects

Open project settings → **Share** to invite other users by email.

Shared projects sync in real-time — all members see task changes, status updates, and member avatars instantly. Each member can customize their avatar color and initials in project settings.

---

## Pomodoro Timer

To start a timer on a task:
1. Hover over any task row
2. Click the play button (appears on hover)
3. In the popup, pick **Flowtime** (counts up — stop when done) or **Timer** (counts down). For Timer, choose **Limited** (a fixed number of work-break reps) or **Infinite** (runs until you stop it). Hit Enter or click **Start**.

The timer runs in the menu bar. You can pause, resume, or stop it at any time. When a work session finishes, a break timer starts automatically.

### Default mode and skipping the popup
**Settings → Timer** has a **Default mode** picker (Flowtime / Timer) so the popup opens pre-selected to your preferred mode. Inside Timer, **Default duration** picks Limited or Infinite by default. If you always want the same configuration and prefer one-click start, turn on **Skip start dialog** under Behavior — pressing play will start instantly with your defaults.

### Sessions and repetitions
With Timer + Limited, you set the number of work-break reps. After a configurable number of work sessions, a long break kicks in. Timer activity is logged and appears in the Productivity Stats dashboard.

### Timer settings
Go to **Settings → Timer** to configure presets, work duration, short break, long break, default mode, default duration, and auto-start behavior. Flowtime users can also configure the cookie-break minutes per hour earned and whether unused cookie time transfers across same-day sessions.

---

## File Attachments

To attach files to a task:
1. Go to **Settings → About → Integrations** and enable iCloud Drive sync
2. Open the task detail panel
3. Click the paperclip icon in the editor toolbar
4. Select one or more files (max 10 MB each, max 10 attachments per task)

Files appear as cards below the description. Click to open in the default app. Hover to reveal a remove button.

Files are stored locally and synced to iCloud Drive for access from other devices.

---

## Auto-Update

ToDoozy checks for updates automatically every 4 hours and on launch.

- Go to **Settings → About → Updates** to check manually
- When an update is available, a banner shows the version and release notes
- Click **Download** to start downloading, then **Install & Restart** to apply
- If you don't install immediately, the update installs automatically when you quit the app

---

## Keyboard Navigation

ToDoozy is designed to be fully usable without a mouse.

| Key | Action |
|-----|--------|
| Cmd+1 | Go to My Day |
| Cmd+2 | Go to Calendar |
| Cmd+3 | Go to Stats |
| Cmd+5 | Go to Archive |
| Cmd+6 | Go to Templates |
| Cmd+K | Open command palette / search |
| Cmd+L | Toggle list / kanban |
| Cmd+C | Copy selected task titles |
| Cmd+Shift+Space | Quick-add window (from anywhere on Mac) |
| Cmd+Shift+B | Show/hide ToDoozy window (configurable) |
| Arrow Up/Down | Navigate tasks in list |
| Enter or Space | Open detail panel for focused task |
| Tab | Cycle through fields in detail panel |
| Shift+Tab | Cycle fields in reverse |
| Escape | Close panel / menu / overlay |
| Shift+Delete | Delete task without confirmation prompt |

---

## Menu Bar (Tray)

ToDoozy lives in your menu bar even when the main window is closed.

- **Left-click** the menu bar icon — see your My Day tasks; click any to open or complete it
- **Right-click** — quick access to: Quick Add, Open ToDoozy, Settings, Quit

Closing the main window does not quit the app — it stays in the menu bar.

---

## Due Date Notifications

When a task has a due date with a time component, ToDoozy sends native macOS notifications before the deadline.

- **Lead time** — a notification fires at a configurable lead time before the due time (5, 10, 15, 30, or 60 minutes)
- **1-minute warning** — a second notification fires 1 minute before the due time
- **Click to navigate** — clicking a notification focuses the ToDoozy window and navigates directly to the task
- **Smart filtering** — notifications are not sent for completed, archived, or template tasks; no duplicates

### Settings
Go to **Settings → General → Notifications** to toggle notifications on/off and choose the lead time from the dropdown.

---

## Context Menu

Right-click any task to open the context menu. It provides quick access to all task actions without opening the detail panel.

**Available actions:**
- Status (with dynamic project statuses)
- Priority submenu
- Recurrence submenu
- Labels flyout (with all project labels)
- Snooze submenu (presets + custom)
- Focus (start Pomodoro timer)
- Pin/Unpin My Day
- Add Subtask
- Duplicate
- Copy title
- Save as Template
- Archive
- Delete (red, at bottom)

Flyout submenus open on hover after a brief delay and automatically open left or right based on available screen space.

---

## Sidebar Customization

### Show and hide items
Go to **Settings → General → Sidebar Items**. Toggle visibility of Calendar, Stats, Views, Archive, and Templates. My Day is always visible and cannot be hidden.

### Reorder items
Drag sidebar items to reorder them. Keyboard shortcuts (Cmd+1, Cmd+2, etc.) update dynamically based on your ordering.

### Dark/light mode toggle
A sun/moon icon at the bottom of the sidebar lets you toggle between dark and light mode without opening Settings.

---

## Sync & Multi-Device

All data syncs automatically to Supabase in the background. SQLite is the local source of truth.

### How it works
- Changes push to Supabase in the background after each edit
- Real-time subscriptions pull changes from other devices and shared project members
- A sync status icon in the sidebar shows connection state (green = synced, orange = syncing, red = offline)

### New device setup
Log in on a new device and all your data — tasks, projects, settings, themes, saved views, and areas — pulls down automatically. No manual import needed.

### Offline support
- **Personal projects** — fully usable offline. Create, edit, and complete tasks without internet. Changes sync when you reconnect.
- **Shared projects** — become read-only when offline to prevent conflicts. Full functionality resumes when connected.

---

## Integrations

### MCP — AI Integration
The Model Context Protocol lets Claude (or any MCP-compatible AI) manage your tasks directly through natural language.

**Setup:** Go to **Settings → About → Integrations**. Enable the MCP server and copy the config JSON — paste it into your AI client's MCP configuration.

**Capabilities:** Full CRUD for tasks, subtasks, projects, labels, and statuses. Search with filters, manage My Day, deploy templates, reorder tasks, and create saved views. AI-made changes appear in the activity timeline alongside user actions.

### Telegram Bot
Add tasks from Telegram using smart input syntax:
- Send a message to create a task (supports @label, p:priority, d:date syntax)
- `/project` — list projects and complete tasks with inline buttons
- `/myday` — see today's tasks
- `/done` — complete a task by keyword
- `/default` — set default project for new tasks

### Default project per integration
In **Settings → About → Integrations**, set a default project separately for Telegram and iOS Shortcuts. New tasks from each integration go to their respective default project. iOS Shortcuts can optionally follow the Telegram default.

### iCloud Drive
Link iCloud Drive in **Settings → About → Integrations** to enable file attachments on tasks. Files sync across your devices via iCloud.

---

## Frequently Asked Questions

**How do I make a task repeat?**
Open the task detail panel → click the Recurrence field → choose Daily, Weekly, Monthly, or Custom. When you complete the task, the next occurrence is created automatically.

**How do I hide a task I don't want to think about yet?**
Right-click the task → Snooze → choose a time (Later today, Tomorrow, Next week, or a custom date). The task disappears until that time.

**Can I use ToDoozy offline?**
Yes. All tasks are stored locally in SQLite. You can create, edit, and complete tasks without an internet connection. Changes sync to Supabase when you reconnect.

**How do I move a task to a different project?**
Drag it onto the project name in the sidebar. Or open the detail panel — the project field is coming soon.

**How do I delete a project?**
Open project settings (hover the project name in the sidebar → gear icon) → scroll to the bottom → Delete Project.

**How do I connect an AI assistant (Claude, etc.)?**
Go to Settings → About → Integrations. Enable the MCP server and copy the config — it gives you the exact JSON to paste into your AI client's MCP configuration.

**How do I change the keyboard shortcut for Quick Add or App Toggle?**
Go to Settings → General. Click the shortcut field and press your desired key combination.

**What happens if I accidentally delete a task?**
An undo toast appears for 5 seconds after deletion. Click Undo to restore the task.

**How do I get notifications for due tasks?**
Go to Settings → General → Notifications. Enable notifications and choose a lead time. Only tasks with a due date *and* a time component trigger notifications.

**How do I customize what shows in the sidebar?**
Go to Settings → General → Sidebar Items. Toggle visibility and drag to reorder. Keyboard shortcuts update dynamically.

**How do I use ToDoozy on multiple devices?**
Just log in on the new device — all your data syncs automatically. No export/import needed. Changes sync in real-time when online.
