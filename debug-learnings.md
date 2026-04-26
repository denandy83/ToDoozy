# Debug Learnings

Patterns and pitfalls discovered during debugging. Read this at the start of every debug session.

---

### Don't kill MCP server when restarting dev
- **Symptoms**: MCP tools become unavailable after restarting the dev server
- **Root cause**: `pkill -9 -f "Electron.app"` kills the MCP server process too, since it runs as a Node subprocess
- **Fix**: Kill electron-vite, the port, AND the dev Electron app (identified by `"Electron \."`) — but NOT the MCP server (identified by `"mcp-server.js"`). Full reliable restart:
  ```
  kill $(ps aux | grep "electron-vite dev" | grep -v grep | awk '{print $2}') 2>/dev/null
  kill $(ps aux | grep "Electron \." | grep -v grep | awk '{print $2}') 2>/dev/null
  lsof -ti:5200 | xargs kill -9 2>/dev/null
  ```
- **Dev app vs MCP server**: dev Electron runs as `Electron .` (dot = project dir); MCP server runs as `Electron out/main/mcp-server.js`. Kill the dot, not the js file.
- **Never use**: `pkill -f "todoozy"` or `pkill -f "Electron"` — too broad, kills the MCP server subprocess
- **`pkill -f "electron-vite"` is unreliable on macOS** — use the `kill $(ps aux | grep ...)` pattern instead
- **Check first**: If MCP tools stop working, the server process was likely killed during a restart

### SQLite WAL restore
- **Symptoms**: After `cp backup.db live.db`, the restored DB still shows stale/missing data
- **Root cause**: SQLite WAL mode keeps a `.db-shm` (shared memory index) alongside the main file. Copying just the DB file leaves a stale SHM that overrides the restore.
- **Fix**: Delete the SHM and WAL files before restoring: `rm todoozy.db-shm todoozy.db-wal && cp backup.db todoozy.db`
- **Check first**: Are there `.db-shm` / `.db-wal` files next to the DB?

---

### Zustand selector re-renders
- **Symptoms**: Infinite re-render loop, black screen after state change, app freezes
- **Root cause**: Zustand 5's `create()` uses `useSyncExternalStore` without selector caching. Any selector returning a new reference (object/array) causes infinite re-renders.
- **Fix**: Use `createWithEqualityFn` with `shallow` equality on all stores.
- **Check first**: Is the affected component using a Zustand selector that returns an object or array? Does it use `shallow`?

### Missing membership rows
- **Symptoms**: Data exists in the database but doesn't appear in the UI. Queries return empty.
- **Root cause**: Queries JOIN on `project_members` but the membership row was never created.
- **Fix**: Ensure every code path that creates a project/resource also adds the corresponding `project_members` row.
- **Check first**: Does the query JOIN on a membership/association table? Is the row being created?

### Hydration calls never made
- **Symptoms**: Data exists in the store definition but is always empty at runtime. No errors.
- **Root cause**: The store's hydrate function was defined but never called during app initialization.
- **Fix**: Add the hydrate call to `App.tsx` in the project hydration sequence.
- **Check first**: Is the store's hydrate/fetch function actually being called? Grep for it in `App.tsx`.

### CSS positioning (relative/absolute)
- **Symptoms**: Badges, tooltips, or overlays appear in wrong position or float off-screen.
- **Root cause**: Absolutely positioned child without a `relative` positioned parent.
- **Fix**: Add `relative` to the correct parent container.
- **Check first**: Does the mispositioned element use `absolute`? Does its parent have `relative`?

### IPC serialization
- **Symptoms**: Data exists in main process but arrives as undefined/empty in renderer.
- **Root cause**: IPC can only serialize plain objects. Class instances, functions, or circular references get dropped.
- **Fix**: Return plain objects from IPC handlers. Use `.toJSON()` or spread into plain objects.
- **Check first**: Is the IPC handler returning a class instance or complex object?

### react-datepicker locale / manual input parsing
- **Symptoms**: App crashes with `RangeError: Invalid time value` when opening a component that renders a date. Stored value is `NaN-NaN-NaN` or similar garbage.
- **Root cause**: react-datepicker's `dateFormat` prop only controls display, not parsing. Without the correct locale registered, manual input in dd/MM/yyyy is parsed as MM/dd/yyyy (en-US default), creating Invalid Date objects that get stored as garbage.
- **Fix**: Register the correct date-fns locale (`registerLocale('en-GB', enGB)`) and pass `locale="en-GB"` to ReactDatePicker. Add `isValidDate` guards on `toDate` and `formatIso` so invalid dates never crash or store garbage. Use `onChangeRaw` with `InputEvent` detection for input masking without interfering with calendar picks.
- **Check first**: Is a locale registered for react-datepicker? Does the `dateFormat` match what the locale expects? Is `toDate` defensive against invalid stored values?

---

### Supabase Sync Performance (2026-04-14 audit)
- **Symptoms**: Supabase free-tier Disk IO Budget depleted with only 1-2 users. App becomes slow/unresponsive.
- **Root causes found**:
  1. **Unfiltered Realtime subscriptions** — subscribing to `task_labels` without a filter caused WAL decoding for ALL users' label changes (2.1M calls)
  2. **share_project RPC on read paths** — `pullProjectMetadata` called `pushProject` (which uses `share_project` RPC) on every 30s poll cycle when local timestamp was newer, even if metadata was identical. Generated 10K+ phantom writes.
  3. **10-second member polling** — `setInterval(() => loadMembers(), 10_000)` caused 2M sequential scans on a 13-row table. Realtime already handled this.
  4. **N+1 queries** — per-label `findById` loops in `pushTask`, per-member `user_profiles` queries in `getSharedProjectMembers`
  5. **Missing compound indexes** — `tasks(project_id, updated_at)` and `statuses(project_id, updated_at)` missing
  6. **No adaptive polling** — 30s poll ran alongside Realtime, doubling IO
- **Fix**: See CLAUDE.md "Supabase Performance Rules". Key changes: adaptive polling via `syncStore.realtimeConnected`, removed unfiltered RT subs, batch `.in()` queries, debounced settings writes, compound indexes added.
- **Check first**: When adding any Supabase query or subscription, verify: Is it filtered? Is it batched? Is it on a read path (no writes allowed)? Does the table have indexes for the query pattern?

### Sort applied at parent but child re-sorts internally
- **Symptoms**: A view passes a pre-sorted task array to `StatusSection`, but the rendered order is whatever the child decides — sort menu picks have no visible effect.
- **Root cause**: `StatusSection.tsx` does `[...topLevel].sort(...)` internally using its own `autoSort` + `order_index` rules, and only trusts the parent's pre-sorted order when `disableDrag={true}` is passed (the flag does double duty: turns off drag-and-drop AND skips the internal sort). `TaskListView` passes `disableDrag={!isCustomSort || isOfflineShared}`; any new view that wants explicit sort to apply must follow the same pattern.
- **Fix**: When an explicit sort is active in the parent, pass `disableDrag={!isCustomSort}` to StatusSection. Drag-reorder doesn't make sense when an explicit sort is in effect anyway, so the dual meaning is correct.
- **Check first**: When wiring a new sort source into a view that uses StatusSection, grep for `disableDrag` and confirm it's plumbed. Compare against `TaskListView.tsx` as the reference implementation.

### My Day uses store sortRules, not its own setting
- **Symptoms**: My Day's local sort logic only honors the legacy `priority_auto_sort` setting; the cross-cutting Sort menu in FilterBar does nothing.
- **Root cause**: The shared FilterBar writes to `labelStore.sortRules`. Project views (`TaskListView`) read `selectSortRules` and feed `createSortComparator(sortRules, statusOrderMap)`. My Day had its own `prioritySortFn` and never consulted the store.
- **Fix**: Read `sortRules` from labelStore and use `createSortComparator`. For My Day, build a cross-project `statusOrderMap` (default=−1000, done=1000, else `order_index`) since tasks come from many projects.
- **Check first**: When a "shared" filter/sort UI doesn't apply in a view, confirm the view actually reads the store the UI writes to. The FilterBar's sort lives in `labelStore.sortRules`.

### Document-level outside-click handler closes a popover that the trigger button is supposed to toggle
- **Symptoms**: A popover/flyout (notification panel, dropdown, etc.) opens when you click its trigger button, but clicking the trigger again to close it does nothing — the popover stays open.
- **Root cause**: The popover registers a `mousedown` handler on `document` that closes the popover when the click target is outside `panelRef`. The trigger button is *outside* the panel, so clicking it: (1) the document handler fires first → calls `closePanel()`, then (2) the trigger's `onClick` fires `togglePanel()` → re-opens. State ends up flipped twice — back where it started, looking like the click did nothing.
- **Fix**: Treat the trigger as "inside" for the outside-click check. Easiest plumbing: render the trigger and the popover inside the same wrapper element (e.g. `<div className="relative">{trigger}{popover}</div>`) and have the handler test against `panelRef.current?.parentElement` instead of `panelRef.current`. No coupling to a sibling ref needed — uses the DOM containment that's already there.
- **Check first**: Whenever a popover has both an outside-click handler AND a separate trigger button that calls `toggle`, verify the trigger is excluded from the outside-click region. The bell + NotificationPanel in `AppLayout` is the canonical example (`src/renderer/src/features/collaboration/NotificationPanel.tsx`).

### Realtime subscription churn (2026-04-16 audit)
- **Symptoms**: Post-optimization check shows RT `list_changes` at 7,068/hr (4.8x worse than pre-opt) and subscription INSERTs at 464/hr (30x worse). Write rates were down, but Realtime load spiked.
- **Root causes found**:
  1. **PersonalSyncService had no dedup Map** — `subscribeToPersonalProject()` created a new channel every call without checking if one already existed. SyncService had `channels.has(projectId)` guard; PersonalSyncService didn't.
  2. **App.tsx effect re-ran on every project switch** — The useEffect that set up RT subscriptions depended on `currentProjectId`. Switching projects tore down ALL subscriptions then recreated them for ALL projects. 10 projects x 5 switches = 50 subscribe/unsubscribe cycles.
  3. **Invite channel used `Date.now()` in name** — `subscribeToInvites()` created channels named `invites:email:${Date.now()}`, always unique, so Supabase never reused the channel.
- **Fix**: Added `personalChannels: Map<string, RealtimeChannel>` with has-check in PersonalSyncService. Split App.tsx effect: hydration depends on `currentProjectId`, RT subscriptions depend only on `currentUser` (run once at login). Removed `Date.now()` from invite channel name.
- **Check first**: When adding a Realtime subscription, verify: (1) Is there a Map/Set guarding against duplicates? (2) Is the useEffect dependency array minimal — does it include anything that changes frequently? (3) Is the channel name stable (no timestamps, no random suffixes)?
