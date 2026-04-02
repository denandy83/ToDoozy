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

My Day shows all tasks you've flagged for today plus any tasks due today, grouped by project.

**To add a task to My Day:**
- Right-click any task → Pin to My Day
- Or open the task detail panel and toggle "My Day"

**To remove from My Day:**
- Right-click → Unpin from My Day

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
- Reorder projects in the sidebar

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
- Drag onto the top of a task → reorder above
- Drag onto the middle of a task → make it a subtask
- Drag onto the bottom of a task → reorder below
- Drag a task onto a project in the sidebar → move it to that project

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
A label filter bar appears at the top of every view. Click a label to show only tasks with that label. Click again to clear.

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

In **Settings → Priorities**, you can toggle visual indicators:
- **Color bar** — a colored left border on the task row
- **Badges** — priority icon + label shown on the row
- **Background tint** — subtle color tint on higher-priority rows
- **Auto-sort** — automatically sort tasks within a status group by priority

---

## Themes

Go to **Settings → Themes** to change the app's appearance.

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

### Project templates
1. Open project settings → Save as Template
2. To deploy: Templates view → choose a project template → Deploy → follow the wizard

---

## Archiving

### Auto-archive
Enable in **Settings → General**. Completed tasks are automatically archived after a configurable delay (e.g., 3 days). Auto-archive only applies to **local projects** — shared projects are excluded to avoid conflicts between users with different settings.

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

The timer counts down in the menu bar. You can pause, resume, or stop it at any time. When it finishes, a break timer starts automatically.

Configure timer duration in **Settings → Timer**.

---

## File Attachments

To attach files to a task:
1. Go to **Settings → iCloud** and enable iCloud Drive sync
2. Open the task detail panel
3. Click the paperclip icon in the editor toolbar
4. Select one or more files (max 10 MB each, max 10 attachments per task)

Files appear as cards below the description. Click to open in the default app. Hover to reveal a remove button.

Files are stored locally and synced to iCloud Drive for access from other devices.

---

## Auto-Update

ToDoozy checks for updates automatically every 4 hours and on launch.

- Go to **Settings → Updates** to check manually
- When an update is available, a banner shows the version and release notes
- Click **Download** to start downloading, then **Install & Restart** to apply
- If you don't install immediately, the update installs automatically when you quit the app

---

## Keyboard Navigation

ToDoozy is designed to be fully usable without a mouse.

| Key | Action |
|-----|--------|
| Cmd+1 | Go to My Day |
| Cmd+2 | Go to Archive |
| Cmd+3 | Go to Templates |
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
Go to Settings → MCP. Enable the MCP server and copy the config — it gives you the exact JSON to paste into your AI client's MCP configuration.

**How do I change the keyboard shortcut for Quick Add or App Toggle?**
Go to Settings → General. Click the shortcut field and press your desired key combination.

**What happens if I accidentally delete a task?**
An undo toast appears for 5 seconds after deletion. Click Undo to restore the task.
