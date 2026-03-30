# Release Notes

User-facing changes by date. Most recent first.

---

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
