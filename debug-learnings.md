# Debug Learnings

Patterns and pitfalls discovered during debugging. Read this at the start of every debug session.

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
