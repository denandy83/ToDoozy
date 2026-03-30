# ToDoozy

A keyboard-driven, AI-native task manager built as a native macOS Electron app. ToDoozy combines local-first SQLite storage with Supabase cloud sync, a rich task editing experience, and deep keyboard navigation — designed for power users who live in their task list.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 41 (main + renderer + preload) |
| UI | React 19, TypeScript 5 (strict), Tailwind CSS 4 |
| State | Zustand 5 (zero prop-drilling) |
| Database | SQLite via node:sqlite (Node.js built-in), versioned migrations |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Editor | Tiptap 3 (WYSIWYG rich text) |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable |
| Build | electron-vite 5, Vite 7 |
| Tests | Vitest 4 |
| AI | MCP server (stdio transport, @modelcontextprotocol/sdk) |

### Architecture

```
Electron Main
  ├── ipc-handlers.ts    — typed IPC bridge
  ├── repositories/      — all DB access (TaskRepository, LabelRepository, etc.)
  ├── tray.ts            — macOS menu bar tray
  ├── quick-add.ts       — floating quick-add window
  └── mcp-server.ts      — AI integration server

Electron Preload
  └── index.ts           — contextBridge to renderer

React Renderer
  ├── features/          — feature-based components
  │   ├── auth/          — login screen
  │   ├── command-palette/
  │   ├── detail/        — task detail panel + Tiptap editor
  │   ├── projects/      — project settings + status management
  │   ├── settings/      — unified settings modal
  │   ├── sidebar/       — collapsible nav + project list
  │   ├── tasks/         — list view, kanban, task rows, drag overlay
  │   ├── templates/     — task + project templates
  │   └── views/         — My Day, Archive, Templates views
  └── shared/
      ├── components/    — StatusButton, PriorityIndicator, LabelChip, Toast, etc.
      ├── hooks/         — smartInputParser, useDragAndDrop, useThemeApplicator, etc.
      └── stores/        — Zustand stores (task, label, status, project, auth, etc.)
```

---

## Install & Run

```bash
# Install dependencies
npm install

# Development (port 5200)
npm run dev

# Development on a safe DB copy (recommended)
export TODOOZY_DEV_DB=$(./dev-db.sh create feature) && npm run dev

# Type check
npm run typecheck

# Tests
npm run test

# Production build
npm run build
```

**Requirements:** macOS, Node.js, a Supabase project (credentials in `.env`).

---

## Features

| Feature | Description |
|---------|-------------|
| **Task CRUD** | Create, edit, complete, archive, and delete tasks with full undo support |
| **Subtasks** | Nested hierarchy with progress bars, expand/collapse, drag to nest |
| **Detail Panel** | Resizable side/bottom panel with rich text, labels, due date, reference URL, recurrence, snooze |
| **Rich Text Editor** | Tiptap WYSIWYG with slash commands, bubble toolbar, Cmd+K links, image paste, checklists |
| **My Day view** | Cross-project view combining tasks flagged for today and tasks due today |
| **Per-project views** | Each project has its own task list with full CRUD and status sections |
| **Kanban toggle** | Cmd+L switches between list and kanban; columns from project statuses |
| **Drag & Drop** | Reorder tasks, create subtasks, drag between statuses and onto sidebar nav items |
| **Multi-select drag** | Select multiple tasks and drag them to a different project in one action |
| **Configurable statuses** | Per-project status CRUD; 3 defaults seeded; tasks reassigned before delete |
| **Priority system** | 5 levels with configurable color bar, badges, background tint, font weight, auto-sort |
| **Global labels** | Labels shared across all projects; per-project assignment; filter bar in every view |
| **Theme system** | 12 built-in themes (6 dark, 6 light), custom color pickers, live preview |
| **Context menu** | Right-click flyout with status, priority, recurrence, labels, snooze submenus |
| **Command palette** | Cmd+K full-text search with operators: `p:`, `l:`, `s:`, `due:`, `has:` |
| **Smart input** | `@label`, `p:priority`, `d:date` inline parsing in all task inputs |
| **Templates** | Task templates (global) and project templates (multi-step deploy wizard with relative due date offsets) |
| **Pomodoro timer** | Per-task timer with tray countdown, configurable presets, break timer, activity log |
| **Quick add** | Cmd+Shift+Space floating window to add tasks from anywhere on macOS |
| **Global app toggle** | Cmd+Shift+B (configurable) shows/hides the main window |
| **macOS tray** | Menu bar icon with badge count, My Day tasks, quick access menu |
| **MCP server** | AI integration via stdio — full CRUD tools for all entities |
| **iCloud attachments** | File attachments synced to iCloud Drive with local-first offline support |
| **Supabase auth** | Email/password + Google OAuth, encrypted session storage, auto-login |
| **Focus management** | Full keyboard navigation, focus traps in overlays, Tab cycles through detail fields |
| **Due dates in rows** | Due dates display inline on task rows with overdue styling |
| **Copy tasks** | Cmd+C copies selected task titles; multiple as bulleted markdown list |
| **Reference URLs** | Attach an external URL to any task; clickable icon in task rows, editable in detail panel |
