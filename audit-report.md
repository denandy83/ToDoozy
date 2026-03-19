# UI Audit Report — Partial (2026-03-19)

**Views audited:** Backlog (list), My Day (list), Archive (empty), Templates (empty), Detail Panel (side)
**Not yet audited:** Kanban view, context menu, command palette, settings modal, collapsed sidebar, bottom detail panel, cross-view component consistency, theme switching

---

## Summary
- 3 large issues
- 5 medium issues
- 4 small issues

---

## Large Issues

### 1. Horizontal structure lines don't flow across panels
The app has three vertical sections (sidebar, main content, detail panel) that each draw their own horizontal borders independently. These lines should be continuous across the full app width at each "level":
- **Header level:** Line under "ToDoozy" (sidebar) should continue as line under "BACKLOG" header (main content) and line under "TASK DETAILS" (detail panel)
- **Input/action level:** Below nav area should align with line under "Add to Personal" input and task title area in detail panel
- **Filter/section level:** Label filter bar bottom border should continue into the detail panel

Currently they're disconnected, creating a fragmented look. The vertical panel borders are continuous, but the horizontal ones are not. Affects every view + detail panel combination.

### 2. Empty states lack illustrations (Archive, Templates)
Both show only centered text ("No archived tasks." / "No templates yet.") with a subtitle. Spec says: "Consistent illustration style + message + optional CTA button. Never a blank void." No illustration and no CTA button (e.g., "Archive a task" or "Create a template").
*Ref: ui-reference.md → Shared Components → EmptyState*

### 3. Sidebar bottom bar doesn't match spec
Bottom of sidebar shows "SETTINGS" text + 4 icons (gear, GitHub?, chain link?, logout arrow?). Spec says bottom bar should have: Settings, Search (with Cmd+K hint), and Theme toggle (sun/moon icon). Search and theme toggle appear missing or replaced with unspecified icons.
*Ref: ui-reference.md → Layout → Sidebar*

---

## Medium Issues

### 4. Kanban/List toggle doesn't indicate current mode
The "KANBAN" button in top-right of Backlog and My Day doesn't clearly indicate current mode. Should it toggle to "LIST" when in kanban mode?
*Ref: ui-reference.md → Typography → Button label*

### 5. Detail panel — no close (X) or position toggle visible
The detail panel shows "TASK DETAILS" header but no close button or panel position toggle visible in the screenshot. Spec says there should be both.
*Ref: ui-reference.md → Layout → Detail Panel*

### 6. Label filter bar — inactive chip contrast
Inactive label chips (ONE MORE, TEMP) have very low contrast on dark theme. May be hard to read.
*Ref: ui-reference.md → Shared Components → LabelFilterBar*

### 7. Priority buttons wrap to two lines in detail panel
NONE, LOW, NORMAL, HIGH, URGENT — URGENT drops to a second row. Looks cramped. Should fit on one line or panel needs to be wider.
*Ref: ui-reference.md → Spacing Reference → Button (compact)*

### 8. Section divider style inconsistency
Status section headers (~ NOT STARTED 7 ~) use decorative dashes/tildes flanking the label. This is a different pattern from the `border-border` dividers used elsewhere (sidebar, label filter bar). Should be consistent.

---

## Small Issues

### 9. Section count badge styling
Status section counts ("7", "2", "1") use the same style as section label text. Could benefit from `text-muted` to visually separate label from count.
*Ref: ui-reference.md → Typography → Section label / Metadata*

### 10. "PICK DATE..." styling in snooze
Appears styled differently from the preset buttons (LATER TODAY, TOMORROW, etc.). Should match button label style.
*Ref: ui-reference.md → Typography → Button label*

### 11. Add-task input placeholder too faint
"+ Add to Personal" and "+ Add to My Day" are very faint at ~opacity-40. Could be bumped slightly for discoverability.
*Ref: ui-reference.md → Typography → Hint text*

### 12. Sidebar badge style
Count badges ("4", "10") are plain numbers without background/pill. Consistent but could be more polished.
*Ref: ui-reference.md → Layout → Sidebar*

---

## Looks Good
- View titles (BACKLOG, MY DAY, ARCHIVE, TEMPLATES) — correct typography
- Section labels (NOT STARTED, IN PROGRESS, DONE, VIEWS, LABELS) — correct styling
- Task title sizing and font weight
- Selection state — accent bg + left border on selected task and nav item
- Label chips — consistent colored bg, correct badge/chip typography
- Priority badge (URGENT) — red, correct size, correct positioning
- Detail panel sections — all present, correctly labeled
- Status buttons in detail panel — correct active/inactive states
- Recurrence buttons — consistent with other button rows
- Label chip in detail panel (TODOOZY) with X remove and "+ ADD"
- Sidebar nav items — correct hover highlight, active accent state
- Done task strikethrough
- "+N" overflow on label chips ("+1" visible on done task)
- Vertical panel borders (sidebar, detail panel) — continuous and consistent
