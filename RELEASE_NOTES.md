# Release Notes

User-facing changes by date. Most recent first.

---

## v1.1.0

- **Settings reorganization** — The Settings modal is now cleaner with 7 tabs instead of 11. Themes and Priority Display are grouped under Appearance. Updates, What's New, Integrations, and Help are grouped under About. Section labels make each tab easier to scan.

## v1.0.6

- **Timer improvements** — Better timer UX and reliability improvements
- **Label search** — Search through your labels for faster filtering
- **Member display reliability** — More reliable member avatar display in shared projects

## v1.0.5

- **What's New from GitHub** — The What's New tab now pulls release notes directly from GitHub, so you always see the latest changes. Works offline too with bundled fallback.
- **Help search** — Search through the help documentation to find what you need faster
- **Shared project fixes** — Fixed several issues with shared project syncing including stale sessions, invite reliability, and member display

## v1.0.4

- **Member display fix** — Fixed an issue where member avatars wouldn't update after collaborator changes

## v1.0.2

- **Assignee filter** — Click member avatars to filter tasks by assignee. Multi-select supported with hover highlights.
- **Member display sync** — Member display customizations (color, initials) now sync across devices via Supabase
- **Shared project reliability** — Fixed realtime invite subscriptions, stale sessions, duplicate labels on sync, and post-reinstall state recovery

## v1.0.0

- **Auto-Update Mechanism** — The app now checks for updates automatically on launch and every 4 hours. When an update is available, a dialog shows the new version and release notes with options to Install & Restart or dismiss. A download progress bar tracks the update. You can also manually check for updates in Settings.

## 2026-04-01 (cont.)

- **Collaboration UX polish** — Consistent avatars across all views, inline task assignment in shared projects, and improved real-time sync so collaborator changes appear instantly.
- **Remote membership discovery** — The app now discovers shared project memberships on startup and shows clear error messages if invite acceptance fails.
- **Full real-time task sync** — Changes by collaborators in shared projects now sync immediately across all connected clients.

## 2026-04-01

- **Launch at login** — Toggle in Settings > General to start ToDoozy automatically when you log into your Mac.
- **Command palette smart filters** — The search palette (CMD+K) now supports inline shortcuts: type `p:` for priority, `@` for labels, `/` for projects, `d:` for dates, or `s:` for statuses. Selections appear as filter chips that combine with text search. Press Backspace on empty input to remove the last chip.
- **Gemini MCP setup** — MCP settings now include Google AI Studio (Gemini) instructions alongside Claude Code and Claude Desktop.
- **Tray icon fix** — The system tray icon now appears correctly in the installed/packaged app.
- **MCP server fix** — The MCP server now works correctly in the built app for Claude Desktop and other MCP clients.

## 2026-03-31

- **Smart Recurrence Picker** — The recurrence input is now a structured picker instead of a free-text field. Choose interval, unit (days/weeks/months/years), specific days, Fixed or After-completion mode, and an optional end date. A live preview shows the human-readable rule and next occurrence. Completing a recurring task now automatically creates a clone with the next due date. Task rows show a repeat icon with tooltip.
- **Reference URL in quick-add** — Use the `r:` operator in quick-add or any task input to attach a reference URL inline. The quick-add window also now has a description toggle for adding notes.
- **Cmd+K archive search** — The command palette now includes an "include archived" checkbox so you can search across archived tasks. Results show project names and archive indicators for clarity.
- **Distribution-ready build** — ToDoozy can now be built as a standalone macOS app (DMG + ZIP) for distribution. See the README for build and code-signing instructions.
- **Multi-user data isolation** — All tasks, projects, labels, and settings are now scoped per user. Multiple users can safely share the same database without seeing each other's data.
- **Fix: Autocomplete ranking** — Exact and prefix matches now appear above substring matches in label and project autocomplete dropdowns.
- **Fix: Status cycling** — Fixed focus loss and scroll jumping when cycling task status via keyboard. Also fixed the click-opens-detail setting and My Day default project assignment.
- **Fix: Label color defaults** — New labels now default to the least-used color from the palette.
- **Fix: In-progress status** — Removed the mandatory in-progress status requirement and fixed done task positioning in My Day.

## 2026-03-30

- **Due date notifications** — Tasks with a due date and time now trigger native macOS notifications 15 minutes before the due time. Click the notification to jump straight to the task.
- **Fix: Notification timezone handling** — Notifications now fire at the correct local time regardless of timezone.
- **Fix: Calendar view polish** — Improved tooltips, week numbers, My Day task display, status sorting, and drag-and-drop in the calendar view.
- **Task reference URL** — Add a reference URL to any task. The URL appears as a clickable link icon on task rows and as an editable field in the detail panel. URLs without a protocol automatically get `https://` prepended. The field autosaves after 1 second, and you can clear it with the X button.
- **Calendar View** — A new Calendar view in the sidebar (⌘2) shows all tasks organized by their due date. Toggle between monthly grid and weekly layout. Navigate with arrow buttons. Today is highlighted, overdue tasks show in red. Click a task to open the detail panel, or drag it to a different day to update the due date.
- **Template Wizard — Relative Due Date Offsets** — When saving a project as a template, the wizard now offers to preserve due dates as relative offsets (e.g., "5 days after deploy"). When you deploy the template, pick a start date and all task due dates are computed automatically.

## 2026-03-29

- **Fix: Quick-add follows theme** — The quick-add popup (Cmd+Shift+Space) now opens with the correct theme instantly, no more dark flash when using a light theme.
- **Fix: Status changes respect position setting** — Changing a task's status now places it according to your default task position preference.
- **Fix: Context menu and label fixes in My Day** — Labels now display correctly in My Day context menus, labels transfer properly when moving tasks between projects, and Shift+Delete works on labels.
- **Fix: Consistent ESC/Tab behavior** — Escape and Tab now work uniformly across My Day and project views.
- **Improved date picker keyboard navigation** — Tab cycles through all date picker fields including the clear button and time picker. The clock icon auto-sets time to 3 hours from now.
- **Global Escape popup system** — A centralized stack manages Escape key dismissal, ensuring the topmost overlay always closes first.
- **Due dates visible in task rows** — Due dates now show inline on task rows with red overdue styling for past-due tasks.
- **Subtask keyboard navigation** — Arrow keys now navigate through subtasks; My Day auto-selects the first task on view entry.
- **Migrated to node:sqlite** — Replaced better-sqlite3 with Node.js built-in sqlite module for simpler builds and no native compilation.

## 2026-03-25

- **Keyboard shortcuts modal** — Press `?` anywhere (or click the `?` button in the sidebar) to open a modal listing every keyboard shortcut, grouped by category. Configurable shortcuts always show their current binding.
- **Help tab in Settings** — A new Help tab in Settings contains full documentation for every ToDoozy feature, plus a complete shortcuts reference table.

## 2026-03-22

- **Multi-select drag to project** — Select multiple tasks, then drag any of them onto a project in the sidebar to move them all at once. An undo option appears for 5 seconds.
- **Undo on bulk moves** — All bulk task moves now show an undo toast so you can reverse accidental drops.
- **Global labels** — Labels are now shared across all your projects. Create a label once and add it to any project. Renaming or recoloring a label updates it everywhere.
- **Rich text editor** — Task descriptions now use a full WYSIWYG editor with slash commands, a bubble toolbar, interactive checklists, and Cmd+K for links.
- **App toggle shortcut** — Press Cmd+Shift+B (configurable) to show or hide ToDoozy from anywhere.
- **Pomodoro timer** — Each task now has a built-in timer. Hover a task and click the play button to start. The countdown appears in the menu bar.
- **MCP integration** — Connect Claude or any MCP-compatible AI to your task list. Enable in Settings → MCP.
- **Task and project templates** — Save any task or project as a template. Deploy project templates via a step-by-step wizard.
- **macOS menu bar** — ToDoozy lives in your menu bar. Close the window and it stays accessible; your task count shows as a badge.
- **iCloud file attachments** — Attach files to any task. Files sync to iCloud Drive for access from other devices. Enable in Settings → iCloud.
- **Tab keyboard navigation** — Full keyboard navigation through the detail panel. Tab cycles through all fields; Escape closes and returns focus to the task list.

## 2026-03-21

- **Smart input** — Use `@label`, `p:priority`, and `d:date` shortcuts directly in the task input to set labels, priority, and due date as you type.
- **Quick-add from anywhere** — Press Cmd+Shift+Space to add a task to My Day without switching to ToDoozy.
- **Copy task titles** — Press Cmd+C to copy selected task titles to your clipboard. Multiple tasks copy as a markdown list.

## 2026-03-20

- Initial release: task management, subtasks, drag & drop, kanban, themes, labels, priorities, context menus, command palette, and Supabase authentication.

---

*This file is updated automatically at the end of each development session.*
