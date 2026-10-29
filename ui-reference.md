# ToDoozy UI Reference

This reference covers shared components and layout patterns. [Interface and motion conventions](docs/design-system.md) owns the current motion, color and typography rules. Read both before making a visual change.

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

See [Color and typography](docs/design-system.md#color-and-typography) for token owners, derived foregrounds and contrast rules. Use theme roles rather than hardcoded text colors.

### Priority Colors

[`taskPriorities.ts`](src/shared/taskPriorities.ts) owns priority labels, values and fill colors. Readable semantic text and indicator colors follow [Color and typography](docs/design-system.md#color-and-typography).

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
| 80% | `/80` | — | Button hover |

---

## Typography Scale

See [Color and typography](docs/design-system.md#color-and-typography) for the current workspace scale and the preserved sidebar treatment.

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
The shared focus treatment follows [Color and typography](docs/design-system.md#color-and-typography). Keep a visible keyboard focus indicator on interactive elements.

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
**Active:** Readable foreground derived for the priority fill. **Inactive:** `text-muted hover:bg-foreground/6`

### PriorityBadge
**File:** `shared/components/PriorityBadge.tsx`
**Props:** `priority: number`
**Behavior:** Compact display. Hidden for None (0) and Normal (2). Shows icon + label for High/Urgent.
**Style:** Compact inline badge using the shared metadata typography.
**Background:** Priority color at 15% opacity.

### LabelChip
**File:** `shared/components/LabelChip.tsx`
**Props:** `name`, `color`, `onRemove?()`, `onClick?()`
**Style:** Rounded inline chip using the shared metadata typography.
**Colors:** Preserve the stored hue for fill/border and derive readable text with `useSemanticColor`; see [Color and typography](docs/design-system.md#color-and-typography).
**Keyboard:** Enter/Space to click, Backspace/Delete to remove.

### LabelPicker
**File:** `shared/components/LabelPicker.tsx`
**Props:** `allLabels[]`, `assignedLabelIds: Set`, `onToggleLabel()`, `onCreateLabel()`, `onClose()`
**Size:** w-56, rounded-lg, border.
**Animation:** Shared menu presence; see [Surfaces](docs/design-system.md#surfaces).
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
**Animation:** Shared dialog presence; see [Surfaces](docs/design-system.md#surfaces).
**Close:** X button (top-right) + Escape key + click outside.

### Toast
**File:** `shared/components/Toast.tsx`
**Hook:** `useToast()` returns `{ addToast() }`
**Position:** Fixed bottom-center stack.
**Style:** `rounded-lg border border-border bg-surface px-4 py-3 shadow-xl`
**Animation:** Shared toast presence; see [Surfaces](docs/design-system.md#surfaces).
**Auto-dismiss:** 5000ms. Variants: `default` | `danger`.
**Optional action:** Button with `text-accent hover:underline`.

### ContextMenu
**File:** `shared/components/ContextMenu.tsx`
**Position:** Portal to body, `fixed z-[10000]`, viewport-clamped.
**Size:** w-52, rounded-lg, `py-1 shadow-xl`.
**Menu item:** `px-3 py-1.5 text-sm font-light`
**Submenus:** Hover to open (150ms delay), flyout right (or left near edge).
**Delete:** Always red, always last.

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

See [Surfaces](docs/design-system.md#surfaces) for presence, timing owners, keyboard/reduced-motion behavior and pointer-drop settlement.

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
- Ghost overlay and drop settlement follow [Surfaces](docs/design-system.md#surfaces).
- Cursor zones: top 20% = above, middle 60% = inside, bottom 20% = below
- **No grip/drag handles.** Items are dragged by clicking and holding anywhere on the row. No visible drag icons or grip dots.
- **Activation distance:** PointerSensor requires 8px of movement before drag starts, preventing accidental drags from clicks.

### Form Inputs
- Text: `bg-transparent text-sm font-light text-foreground focus:outline-none`
- Border: `border border-border focus:border-accent`
- Color picker: shared `ColorSwatches` / `ColorPicker`; see [Color and typography](docs/design-system.md#color-and-typography).

---

## Spacing Reference

| Context | Padding | Gap |
|---------|---------|-----|
| Task row | Shared `.ui-task-row` metrics; see [Color and typography](docs/design-system.md#color-and-typography) | — |
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
