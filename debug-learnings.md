# Debug Learnings

Patterns and pitfalls discovered during debugging. Read this at the start of every debug session.

---

### Don't kill MCP server when restarting dev
- **Symptoms**: MCP tools become unavailable after restarting the dev server
- **Root cause**: `pkill -9 -f "Electron.app"` kills the MCP server process too, since it runs as a Node subprocess
- **Fix**: Kill by exact process pattern using `kill $(...)` — `pkill -f` is unreliable on macOS. Reliable kill:
  ```
  kill $(ps aux | grep "electron-vite dev" | grep -v grep | awk '{print $2}') 2>/dev/null
  kill $(ps aux | grep "todoozy/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \." | grep -v grep | awk '{print $2}') 2>/dev/null
  ```
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
