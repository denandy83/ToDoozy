# Story #46 — Expanded Filter System

## Plan

### 1. Backend: Enhance TaskRepository.search()
- Add array support: `label_ids`, `status_ids`, `priorities`, `assigned_to_ids`, `project_ids`
- Update SQL builder for IN clauses
- File: `src/main/repositories/TaskRepository.ts`

### 2. Frontend: Create filterStore.ts
- New Zustand store for all filter types
- State: labelIds, assigneeIds, priorities, statusIds, dueDatePreset, dueDateRange, keyword, filterMode
- File: `src/renderer/src/shared/stores/filterStore.ts`

### 3. Frontend: FilterBar component
- Replace LabelFilterBar
- Always shows: label chips, + Filter button
- Active additional filters show as removable chips
- File: `src/renderer/src/shared/components/FilterBar.tsx`

### 4. Frontend: Filter picker components in FilterBar
- PriorityFilterPicker, DueDateFilterPicker, StatusFilterPicker, KeywordFilterInput
- Inline within FilterBar or small sub-components

### 5. Update views
- TaskListView, MyDayView, CalendarView: use filterStore

### 6. Migrate labelStore
- Remove filter state, keep label CRUD
- Update all imports

## Files to change
- `src/main/repositories/TaskRepository.ts` — enhance search()
- `src/renderer/src/shared/stores/filterStore.ts` — NEW
- `src/renderer/src/shared/stores/labelStore.ts` — remove filter state
- `src/renderer/src/shared/stores/index.ts` — export filterStore
- `src/renderer/src/shared/components/FilterBar.tsx` — NEW (replaces LabelFilterBar)
- `src/renderer/src/shared/components/LabelFilterBar.tsx` — KEEP but update imports
- `src/renderer/src/features/tasks/TaskListView.tsx` — use filterStore
- `src/renderer/src/features/views/MyDayView.tsx` — use filterStore
- `src/renderer/src/features/views/CalendarView.tsx` — add filters
- `src/renderer/src/features/command-palette/CommandPalette.tsx` — update clearFilters call
- `src/renderer/src/features/sidebar/Sidebar.tsx` — update clearFilters call
