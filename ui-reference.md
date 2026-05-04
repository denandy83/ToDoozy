# ToDoozy UI Reference

This is the single source of truth for UI patterns in ToDoozy. Every UI change must be consistent with this document. Read it before making any visual change.

---

## Design Principles

1. **Minimal, monochrome-first** — Color comes only from themes, priority accents, and label colors.
2. **Keyboard-first** — Every feature must be usable without a mouse.
3. **One component, one implementation** — Never build a second version of a shared component.
4. **Respect `prefers-reduced-motion`** — All animations disabled when the user prefers reduced motion.
5. **Autosave everything** — 1s debounce on all text inputs. No save buttons for text.
6. **Escape closes the topmost thing** — Always. Modals, panels, menus, pickers.

---

## Color System

### Theme Tokens (CSS Custom Properties)

Every color in the app comes from these 8 tokens. Never hardcode colors outside of priority/label accents.

| Token | Purpose | Default (Standard Dark) |
|-------|---------|------------------------|
| `--color-background` | Page background | `#1a1a2e` |
| `--color-foreground` | Primary text | `#e0e0e0` |
| `--color-fg-secondary` | Secondary text | `#b0b0b0` |
| `--color-fg-muted` | Muted/disabled text | `#666666` |
| `--color-accent` | Interactive elements, selection | `#6366f1` |
| `--color-accent-fg` | Text on accent backgrounds | `#ffffff` |
| `--color-surface` | Cards, panels, menus | Derived from bg (+12 dark, -8 light) |
| `--color-border` | Borders, dividers | `#2a2a4a` |
| `--color-muted` | Muted backgrounds | `#888888` |
| `--color-danger` | Destructive actions | `#ef4444` |
| `--color-success` | Positive states | `#22c55e` |

Theme changes apply via `useThemeApplicator.ts` which sets these on `document.documentElement`. Global transition: `background-color 300ms, color 300ms, border-color 300ms`.

### Priority Colors

| Level | Value | Color | Weight Modifier |
|-------|-------|-------|-----------------|
| None | 0 | `#888888` | `font-light` |
| Low | 1 | `#22c55e` | `font-light` |
| Normal | 2 | `#3b82f6` | `font-light` |
| High | 3 | `#f59e0b` | `font-normal` |
| Urgent | 4 | `#ef4444` | `font-medium` |

### Opacity Scale

Standard opacity modifiers used throughout the app:

| Opacity | Tailwind | Hex suffix | Use |
|---------|----------|------------|-----|
| 6% | `/6` | — | Light hover background |
| 10% | `/10` | — | Subtle borders |
| 12% | `/12` | — | Selection background |
| 15% | `/15` | `15` | Selection border, label borders |
| 20% | `/20` | `20` | Label chip background |
| 30% | `/30` | `30` | Active filter border, archive |
| 40% | `/40` | `40` | Filter glow shadow |
| 50% | `/50` | — | Drag overlay |
| 80% | `/80` | — | Button hover |

---

## Typography Scale

Every text element must use one of these. No exceptions.

| Use | Classes | Example |
|-----|---------|---------|
| View title | `text-3xl font-light tracking-[0.15em] uppercase` | MY DAY, BACKLOG |
| Section label | `text-[10px] font-bold uppercase tracking-[0.3em]` | NOT STARTED, LABELS |
| Task title | `text-[15px] font-light tracking-tight` | Buy groceries |
| Detail title | `text-xl font-light tracking-tight` | (task title in detail panel) |
| Metadata | `text-[10px] font-bold uppercase tracking-widest` | 2026-03-18, 3/5 |
| Badge/chip | `text-[9px] font-bold uppercase tracking-wider` | URGENT, TODOOZY |
| Button label | `text-[11px] font-bold uppercase tracking-widest` | APPLY, CREATE |
| Body text | `text-sm font-light` | Description content |
| Hint text | `text-[10px] opacity-40` | Cmd+V to paste |

---

## Interaction States

### Selection
```
bg-accent/12 border-l-2 border-accent/15
```
Used on: TaskRow, KanbanCard, filter buttons. Same pattern everywhere.

### Hover
```
hover:bg-foreground/6
```
Optional faint border. Used on: menu items, buttons, task rows, nav items, label chips.

### Focus
```
focus:outline-none focus-visible:ring-1 focus-visible:ring-accent
```
Used on: all interactive elements. Visible keyboard focus indicator.

### Destructive
- Always `text-danger` or `hover:bg-danger/10`
- Always at bottom of menus/lists
- Always with undo toast
- **Shift+click skips the confirmation toast** when `shift_delete_enabled` is on. Every destructive button (trash icons, "Delete X" buttons, archive-then-delete actions) must accept the click event and call `shouldForceDelete(e)` from `src/renderer/src/shared/utils/shiftDelete.ts` — if it returns true, perform the action immediately without the confirm toast. Update the button's `title` to include "(Shift+click to skip confirmation)".

---

## Shared Components

These 11 components are the building blocks of the UI. Use them everywhere — never rebuild.

### StatusButton
**File:** `shared/components/StatusButton.tsx`
**Props:** `currentStatusId`, `statuses[]`, `onStatusChange()`, `size?=16`
**Behavior:** Cycles through statuses on click/Enter/Space.
**Icons:** Circle → CircleDot → CheckCircle2. Color from `status.color`.
**Style:** `flex-shrink-0 rounded p-0.5 transition-colors hover:bg-foreground/6 focus-visible:ring-1 focus-visible:ring-accent`

### PriorityIndicator
**File:** `shared/components/PriorityIndicator.tsx`
**Props:** `currentPriority`, `onPriorityChange()`
**Behavior:** 5 inline buttons. Click to select.
**Active:** White text + colored background. **Inactive:** `text-muted hover:bg-foreground/6`

### PriorityBadge
**File:** `shared/components/PriorityBadge.tsx`
**Props:** `priority: number`
**Behavior:** Compact display. Hidden for None (0) and Normal (2). Shows icon + label for High/Urgent.
**Style:** `inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider`
**Background:** Priority color at 15% opacity.

### LabelChip
**File:** `shared/components/LabelChip.tsx`
**Props:** `name`, `color`, `onRemove?()`, `onClick?()`
**Style:** `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider`
**Colors (inline):** `backgroundColor: ${color}20`, `color: color`, `border: 1px solid ${color}30`
**Keyboard:** Enter/Space to click, Backspace/Delete to remove.

### LabelPicker
**File:** `shared/components/LabelPicker.tsx`
**Props:** `allLabels[]`, `assignedLabelIds: Set`, `onToggleLabel()`, `onCreateLabel()`, `onClose()`
**Size:** w-56, rounded-lg, border.
**Animation:** `motion-safe:animate-in fade-in zoom-in duration-100`
**Modes:** Label list (toggle with checkmarks) or new-label mode (name + color picker).

### DatePicker
**File:** `shared/components/DatePicker.tsx`
**Library:** `react-datepicker`
**Props:** `value: string | null` (ISO 8601), `onChange()`
**Structure:** Date input (w-10rem) + Time input (w-5rem, conditional) + Clock toggle + Clear button.
**Date format:** `dd/MM/yyyy` display, ISO 8601 output.
**Time:** 15-min intervals. Shown when value includes `T`.

### Modal
**File:** `shared/components/Modal.tsx`
**Props:** `open`, `onClose()`, `children`, `title?`
**Backdrop:** `fixed inset-0 z-50 bg-black/50 backdrop-blur-sm`
**Card:** `max-w-lg rounded-xl border border-border bg-surface p-10 shadow-2xl`
**Animation:** `motion-safe:animate-in fade-in zoom-in-95 duration-200`
**Close:** X button (top-right) + Escape key + click outside.

### Toast
**File:** `shared/components/Toast.tsx`
**Hook:** `useToast()` returns `{ addToast() }`
**Position:** Fixed bottom-center stack.
**Style:** `rounded-lg border border-border bg-surface px-4 py-3 shadow-xl`
**Animation:** `motion-safe:animate-in slide-in-from-bottom duration-200`
**Auto-dismiss:** 5000ms. Variants: `default` | `danger`.
**Optional action:** Button with `text-accent hover:underline`.

### ContextMenu
**File:** `shared/components/ContextMenu.tsx`
**Position:** Portal to body, `fixed z-[10000]`, viewport-clamped.
**Size:** w-52, rounded-lg, `py-1 shadow-xl`.
**Menu item:** `px-3 py-1.5 text-sm font-light`
**Submenus:** Hover to open (150ms delay), flyout right (or left near edge).
**Delete:** Always red, always last.

### LabelFilterBar
**File:** `shared/components/LabelFilterBar.tsx`
**Render:** Only if labels exist. `flex items-center gap-2 border-b border-border px-4 py-2`.
**Filter modes:** "Hide" (removes non-matching) or "Blur" (fades to 20% opacity).
**Active filter:** Ring highlight with box-shadow glow.

### Avatar
**Shows:** Initials if no `avatar_url`.
**Sizes:** 16px in rows, 24px in detail, 32px in member list.

---

## Text Selection

Global `user-select: none` applied on `body` in `main.css`. No text is selectable anywhere in the app except in explicitly editable areas:
- `input`, `textarea`
- `[contenteditable="true"]`
- `.tiptap-editor-content`
- `.select-text` (utility class for opt-in selection)
- `pre`, `code`

Never add `select-text` or `user-select: text` to labels, buttons, headings, or metadata.

---

## Scrollbars

Global scrollbar style applied via `::-webkit-scrollbar` in `main.css`:
- **Width:** 6px
- **Track:** transparent
- **Thumb (idle):** `color-mix(in srgb, var(--color-foreground) 20%, transparent)` — always visible at 20% opacity
- **Thumb (hover):** `color-mix(in srgb, var(--color-foreground) 50%, transparent)` — 50% on hover
- **Border radius:** 3px

Applied globally — no class needed. All scrollable areas use this consistently.

---

## Layout

### Sidebar
- **Expanded:** w-56 | **Collapsed:** w-14
- **Transition:** `transition-[width] duration-200 ease-out`
- **Sections:** Views (My Day, Backlog, Templates) with count badges → Archive → Smart Lists
- **Bottom:** Settings, Search, Theme toggle
- **Active nav item:** Accent background + border. Collapsed: accent bar on right edge.

### Main Content Area
- Tasks grouped by project statuses in sections
- Add-task input always visible at top
- Label filter bar below header

### Detail Panel
- **Side mode:** Fixed width (200–800px), left border
- **Bottom mode:** Fixed height (200–800px), top border, auto multi-column layout (min 280px per column)
- **Resize:** Drag handle, `hover:bg-accent/30`
- **Toggle:** Side ↔ Bottom, persisted

### Z-Index Hierarchy
| Layer | Z-Index |
|-------|---------|
| Modals, Command Palette | `z-50` |
| DatePicker portal | `z-[9999]` |
| Context Menu | `z-[10000]` |
| Context Menu Submenus | `z-[10001]` |

---

## Animations

| Element | Animation | Duration |
|---------|-----------|----------|
| Modal open | `animate-in fade-in zoom-in-95` | 200ms |
| Context menu | `animate-in fade-in zoom-in` | 100ms |
| Label picker | `animate-in fade-in zoom-in` | 100ms |
| Toast | `animate-in slide-in-from-bottom` | 200ms |
| Sidebar | `transition-[width] ease-out` | 200ms |
| Theme change | `transition-colors` (global) | 300ms |
| Drag & drop | No animation on drop (instant snap) | — |
| Kanban card | `animate-in fade-in` | 150ms |

All wrapped in `motion-safe:` prefix. Reduced motion: `animation-duration: 0.01ms`.

---

## Icons

**Library:** `lucide-react`
**Default size:** 14px
**Stroke width:** 1.5 (standard), 2.5 (done status)

Common icons:
- Status: `Circle`, `CircleDot`, `CheckCircle2`
- Actions: `Plus`, `X`, `Trash2`, `Copy`
- Navigation: `ChevronRight`, `Sun`, `Archive`, `Inbox`, `LayoutTemplate`
- Metadata: `Calendar`, `Clock`, `Bell`, `Signal`, `Repeat`, `Tag`
- Layout: `PanelLeft`, `PanelBottom`, `Columns3`, `LayoutList`

---

## Feature-Specific Patterns

### TaskRow
- Depth indentation: `paddingLeft: 16 + depth * 24`
- Priority color bar: 1.5px left edge, rounded
- Priority tint: 3% (High), 6% (Urgent)
- Label chips: max 3, "+N" overflow with portal tooltip
- Title edit: inline input, double-click to focus, 1s autosave
- Hover-reveal: delete button, add-label button

### KanbanCard
- Size: `rounded-lg p-3.5 border`
- Content: title + metadata row (priority, labels×3, date)
- Date format: `Mon, 1` (short month + day)
- Priority color bar: left side, 1.5px
- Draggable via @dnd-kit sortable

### Drag & Drop
- Library: `@dnd-kit`
- Activation: PointerSensor (8px) + KeyboardSensor
- Drop indicators: horizontal line (above/below), `bg-accent/8 scale-[1.01]` (inside)
- Ghost overlay: same as card at 50% opacity
- Cursor zones: top 20% = above, middle 60% = inside, bottom 20% = below
- **No grip/drag handles.** Items are dragged by clicking and holding anywhere on the row. No visible drag icons or grip dots.
- **Activation distance:** PointerSensor requires 8px of movement before drag starts, preventing accidental drags from clicks.

### Form Inputs
- Text: `bg-transparent text-sm font-light text-foreground focus:outline-none`
- Border: `border border-border focus:border-accent`
- Color picker: native HTML5, `h-6 w-6 rounded border-0 bg-transparent p-0`

---

## Spacing Reference

| Context | Padding | Gap |
|---------|---------|-----|
| Task row | `py-3.5 px-4` | — |
| Kanban card | `p-3.5` | — |
| Modal | `p-10` | — |
| Panel | `p-6` | `gap-5` |
| Menu item | `px-3 py-1.5` | `gap-2.5` |
| Button (standard) | `px-4 py-2` | — |
| Button (compact) | `px-3 py-1.5` | — |
| Button (icon-only) | `p-0.5` to `p-2` | — |
| Section gap | — | `mb-6` |
| Task gap | — | `mb-1` |

---

## Tooltips

Native `title` attribute tooltips do NOT work reliably in Electron on macOS. Always use the CSS tooltip pattern instead.

### Pattern
Wrap the trigger element in a `group relative` div, then add a sibling tooltip div:

```jsx
<div className="group relative">
  <button ...>...</button>
  <div className="pointer-events-none absolute left-1/2 top-full mt-1.5 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted opacity-0 shadow-md ring-1 ring-border transition-opacity group-hover:opacity-100">
    Tooltip text
  </div>
</div>
```

### Positioning
- Below the element: `top-full mt-1.5` (use in headers where above would be clipped)
- Above the element: `bottom-full mb-1.5` (use in footers or body content)
- Always: `left-1/2 -translate-x-1/2` for horizontal centering, `z-50` to avoid clipping, `whitespace-nowrap` to prevent wrapping
