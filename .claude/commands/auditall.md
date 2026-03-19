---
name: auditall
description: Full visual audit of the entire ToDoozy app — cycles through all views, panels, menus, and states. Use when the user wants a comprehensive UI review across the whole app, not just the current screen. Triggers on "audit everything", "full audit", "check the whole app", "review all views".
---

# ToDoozy Full UI Audit

You are performing a comprehensive visual audit of the entire ToDoozy app. This means cycling through every view, panel position, menu, and interactive state to find visual inconsistencies.

## Step 1: Load the Design Spec

Read these files:
- `ui-reference.md` — the design spec
- `ui-learnings.md` — known visual patterns (if it exists)

## Step 2: Systematic Walkthrough

Work through the app view by view. For each, ask the user to navigate there (or tell them what to click), then use `/screenshot` to capture it.

### Views to Check
1. **My Day** — with tasks and without (empty state)
2. **Backlog** — with tasks in multiple status sections
3. **Archive** — with archived tasks
4. **Templates** — with and without templates

### Panel States to Check
5. **Detail Panel (side mode)** — with a task selected, check all sections
6. **Detail Panel (bottom mode)** — same task, check multi-column layout
7. **No detail panel** — verify main area uses full width

### Interactive States to Check
8. **Context menu** — ask user to right-click a task, screenshot
9. **Context menu submenus** — ask user to hover over Priority, Labels, Snooze flyouts
10. **Label picker** — ask user to open it from a task row
11. **Command palette** — ask user to open with Cmd+K
12. **Settings modal** — ask user to open settings
13. **Sidebar collapsed** — ask user to collapse it
14. **Sidebar expanded** — ask user to expand it

### Component Consistency Checks
15. **LabelChip** — compare appearance in TaskRow vs KanbanCard vs DetailPanel
16. **PriorityBadge** — compare across views
17. **StatusButton** — compare across views
18. **DatePicker** — check in detail panel and snooze

### Theme Check
19. **Current theme** — verify all elements use theme tokens
20. **Switch to a light theme** — ask user to switch, screenshot, check for hardcoded dark colors

For each screenshot, analyze against `ui-reference.md` the same way `/audit` does (typography, colors, spacing, components, interaction states, layout, icons, animations).

## Step 3: Compile Report

After checking everything, compile a single comprehensive report:

```
## Full UI Audit Report

### Summary
- X large issues found
- Y medium issues found
- Z small issues found

### 🔴 Large Issues
1. [View/Component] — [Description] — [What spec says]
2. ...

### 🟡 Medium Issues
1. [View/Component] — [Description] — [What spec says]
2. ...

### 🟢 Small Issues
1. [View/Component] — [Description] — [What spec says]
2. ...

### ✅ Looks Good
- [List of things that correctly follow the spec — so the user knows what's solid]
```

## Step 4: Ask the User

Present the full report and ask:

> "Here's the full audit. Which issues would you like me to tackle? For small ones I can fix them directly. For medium and large ones I'll run `/fix` for each."

Same rules as `/audit`:
- **Small + user approves:** fix directly, typecheck, screenshot, commit
- **Medium/large:** invoke `/fix --skip-interview` per issue
- **Skipped:** leave them

---

## Rules

- **Be patient.** This is a long process. Take it one view at a time.
- **Ask the user to navigate.** Don't try to automate clicks — ask them to open menus, switch views, etc.
- **One screenshot per state.** Don't combine multiple states in one analysis.
- **Compile, don't drip-feed.** Collect all findings first, then present the full report. Don't report issues one by one as you find them.
- **Reference the spec.** Every issue must point to a specific rule in `ui-reference.md`.
- **Note what's good too.** The report should include what's working well, not just problems.
