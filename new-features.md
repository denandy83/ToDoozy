# New Features Backlog

Feature requests and improvements to be implemented after bugs are resolved.

---

### Configurable date locale in settings
- Add a locale/date format setting to Settings (e.g., dd/MM/yyyy, MM/dd/yyyy, yyyy-MM-dd)
- Dynamically update the DatePicker placeholder text to match the selected format
- Register the corresponding date-fns locale with react-datepicker
- Persist the setting in the database
- **Context:** Currently hardcoded to en-GB (dd/MM/yyyy). User is in Europe and expects dd/MM/yyyy. Should be configurable for all users.

### Global quick-add window (Cmd+Shift+Space)
- Floating, always-on-top, frameless, transparent 600×120 window
- Auto-focus with retry (50/150/300ms)
- Creates task in My Day, closes on submit/Escape/blur
- Requires Electron `globalShortcut` API in main process + new BrowserWindow
- **Spec ref:** REBUILD_SPEC.md §22, §23

### Global show/minimize shortcut (Cmd+Shift+B)
- Shows or minimizes the app window
- Uses `minimize()` not `hide()` for Cmd+Tab visibility
- **Spec ref:** REBUILD_SPEC.md §23

### Menu bar tray icon
- Context menu: My Day, Backlog, Quick Add, Settings, Quit
- After tray creation, `app.dock.show()` ensures Cmd+Tab visibility
- **Spec ref:** REBUILD_SPEC.md §24

### Customizable priority colors and levels
- Allow users to change the color associated with each priority level
- Allow adding/removing/renaming priority levels beyond the default 5
- Settings > Priorities should have color pickers per level
- **Context:** Currently hardcoded 5 levels with fixed colors (None=#888, Low=#22c55e, Normal=#3b82f6, High=#f59e0b, Urgent=#ef4444)

### Per-view statuses
- Backlog and My Day should each have their own unique set of statuses
- Default statuses: Not Started, In Progress, Done (always present initially, can be edited/removed later)
- Statuses should be configurable per view, not per project
- Requires data model change: statuses linked to views instead of (or in addition to) projects
- Move status management from the Settings modal to within each view's context
