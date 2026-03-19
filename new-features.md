# New Features Backlog

Feature requests and improvements to be implemented after bugs are resolved.

---

### Configurable date locale in settings
- Add a locale/date format setting to Settings (e.g., dd/MM/yyyy, MM/dd/yyyy, yyyy-MM-dd)
- Dynamically update the DatePicker placeholder text to match the selected format
- Register the corresponding date-fns locale with react-datepicker
- Persist the setting in the database
- **Context:** Currently hardcoded to en-GB (dd/MM/yyyy). User is in Europe and expects dd/MM/yyyy. Should be configurable for all users.
