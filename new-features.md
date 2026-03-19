# New Features Backlog

Feature requests and improvements to be implemented after bugs are resolved.

---

### Configurable date locale in settings
- Add a locale/date format setting to Settings (e.g., dd/MM/yyyy, MM/dd/yyyy, yyyy-MM-dd)
- Dynamically update the DatePicker placeholder text to match the selected format
- Register the corresponding date-fns locale with react-datepicker
- Persist the setting in the database
- **Context:** Currently hardcoded to en-GB (dd/MM/yyyy). User is in Europe and expects dd/MM/yyyy. Should be configurable for all users.

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
