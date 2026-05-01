# Release Notes

User-facing changes by date. Most recent first.

---

## v1.5.5

- **Sidebar color** — Settings → Theme now has a dedicated "Sidebar" color field so you can set the left panel background independently from the rest of the app. All 12 built-in themes have been updated with sidebar values, and custom themes can set their own.
- **Profile settings** — A new Profile tab in Settings lets you manage your account: change your password, update your display name, and view account info.
- **Structural borders always visible** — The header line and sidebar borders now use a foreground-relative color so they're always visible regardless of which theme you're using.
- **Fix: Duplicate labels from shared projects no longer appear in the picker** — If a member of a shared project had a same-named label (e.g. "Bug"), it would show up as a second "Bug" in your label picker and filter bar. Selecting it would link the wrong label to your personal project. The picker now only shows your own labels.
- **Fix: Session expired banner now tells you to sign in again** — If your session becomes permanently invalid (e.g., due to a connectivity issue at startup), the app now shows a red "Session expired" banner with a single "Sign in again" button. Previously it showed a generic "Sync paused / Retry now" prompt which was misleading since retrying wouldn't help.

## v1.5.4

- **Fix: Sync no longer pushes already-synced rows on every cycle** — A logic gap in the reconcile diff meant rows that were already in sync were classified as "local only" and pushed repeatedly. This produced redundant Supabase writes every reconcile cycle. The diff now correctly identifies in-sync rows and skips them.
- **Fix: Label assignments now sync to all devices in shared projects** — Labels added to tasks in a shared project were missing from the reconcile scope, so they'd appear on the device that created them but not on others. Labels are now included in the cross-device reconcile.

## v1.5.3

- **Fix: Bell icon now closes the notification panel** — Clicking the bell while the notification panel is open now closes it (it used to silently stay open). The panel still closes on Escape, on clicking outside it, or on opening a notification.
- **Notifications: Trash icon replaces the redundant close X** — The header of the notification panel now has a trash icon instead of an X. Click it and a confirm toast appears at the bottom with **Delete** and **Cancel** buttons; **Delete** clears every notification at once. The icon is dimmed when there's nothing to delete.

## v1.5.2

- **Fix: Sort menu in My Day now works** — Picking Priority, Due Date, Title, etc. from the Sort menu in My Day used to do nothing. Sorting now applies within each bucket (Not Started / In Progress / Done), and the active sort shows as `Priority - DESC` (literal ASC/DESC text) instead of a small arrow.
- **Timer modes redone — pick Flowtime or Timer when you press play** — Previously, enabling Flowtime in settings while Perpetual was also on would silently start a non-Flowtime perpetual countdown. Pressing play now opens a small picker pre-selected to your default, where you can pick Flowtime or Timer, and within Timer pick Limited (with reps) or Infinite. Settings now has a single "Default mode" segmented control instead of three competing on/off toggles. Hit Enter or click Start to launch — your existing settings carry over. Prefer the old one-click flow? Settings → Behavior → "Skip start dialog" turns the picker off.

## v1.5.1

- **Project templates now sync across devices** — Templates you create on one device now show up on every other device, and deletions propagate cleanly. Previously they only existed on the device they were created on.
- **Fix: Adding or removing a label on a project now syncs across devices** — Previously the project↔label association only synced on initial setup, so a label you added to a project on one device wouldn't appear on the next. Adding or removing a label from a project now propagates to every device immediately, and is preserved when reconnecting after offline.
- **Fix: Project ordering, default-project flag, and area assignments now sync across devices** — These previously only existed on the device you set them on, and reconcile was failing silently every cycle. Now they're proper synced fields like everything else.
- **Fix: Sync no longer silently breaks when the session expires** — On cold start with a flaky network or an expired refresh token, the app used to fall into a zombie state where everything you did was rejected by the cloud and your changes never went up. The app now retries the session restore three times before falling back, then keeps trying every 30 seconds in the background. As soon as the session comes back, every queued change is pushed automatically — no more logging out and back in.
- **Fix: "Sync paused" banner when offline** — If the app does fall back to offline mode, you'll now see an amber banner at the top with "Retry now" and "Sign in again" actions. No more silent failures.

## v1.5.0

- **Reliable cross-device sync** — Tasks, projects, labels, themes, settings, saved views, and areas now sync the same way: anything you change on one device shows up on every device, and deletes propagate cleanly without zombies coming back.
- **Local and cloud always converge** — On reconnect after going offline (or after a sleep/wake), the app reconciles every change in both directions in a single pass. No more lost edits, no more "why is this still here" stale rows.
- **Custom themes sync everywhere** — Custom themes you create on one device now appear on every other device automatically, the same as everything else.
- **No more wake-from-sleep storm** — Closing the laptop lid no longer makes the app spend the next minute reconnecting Realtime channels in a loop.
- **Faster, quieter idle sync** — When nothing has changed, reconcile finishes near-instantly instead of scanning every table. Boots are quicker and the sync log is much less noisy.
- **Storage stays bounded** — Soft-deleted rows are now hard-deleted automatically after 30 days, both in the cloud and locally.

## v1.4.5

- **Fix: Several sync failures that were silently swallowed** — Sync paths that hit errors were completing without logging or retrying. These now surface errors and re-queue failed writes for retry.
- **Fix: Duplicate labels created during sync are now consolidated** — If a sync produced two label rows with the same name but different IDs, all task references are remapped to the canonical label and the duplicate is removed.

## v1.4.4

- **Fix: New labels no longer always start with the same color** — New labels now default to the least-used color in your palette. Previously they always started as the first color regardless of what colors you already had.
- **What's New syncs on app launch** — The What's New tab now silently refreshes release notes on launch and logs a confirmation when sync completes, so you don't have to open Settings to get the latest notes.

## v1.4.3

- **Fix: Shared projects now sync fully when you join** — Several edge cases in the initial shared-project sync (missing tasks from other members, assigned-to FK failures, incorrect auto-archive on your device) have been resolved. Joining a shared project and seeing all its tasks the first time should now work reliably.

## v1.4.2

- **Fix: Supabase connection recovers automatically after a network drop** — Previously, if Realtime disconnected (e.g., laptop lid closed, network switch), the channel would stay dead until you restarted the app. The app now automatically reconnects with a backoff schedule.
- **In-app connection log** — Settings now has a connection log showing Realtime connect/disconnect/reconnect events — useful for diagnosing intermittent sync issues without digging into terminal logs.

## v1.4.1

- **Fix: Update modal shows notes for every version you skipped** — If you skipped multiple versions, the update modal used to only show release notes for the latest. It now shows notes for every version between your current version and the update.

## v1.4.0

- **Theme import and export** — Export any theme as a JSON file and import it on another device or share it with others. Custom color palettes are no longer device-local.
- **Command palette searches by task ID** — Paste a task UUID into Cmd+K and the palette will find it directly. Useful for navigating to tasks from external links or logs.
- **Fix: Pressing play with Flowtime mode active now actually starts Flowtime** — When Flowtime and Perpetual were both enabled in settings, Perpetual silently won and pressing play started a non-Flowtime countdown regardless of the Flowtime setting. The timer settings have been redesigned with a single "Default mode" picker (Flowtime / Timer) replacing the three competing toggles. Pressing play opens a small mode picker pre-selected to your default, and a "Skip start dialog" toggle in Settings → Behavior turns the picker off for one-click starts.
- **Fix: Save icon in theme settings only shows when there are unsaved changes** — The save icon was appearing even when no color values had been changed from the saved state.
- **Fix: Notification panel bell now toggles closed** — Clicking the bell while the panel was open did nothing (it opened and closed in the same click). The panel now correctly closes when you click the bell again.
- **Notification panel: trash icon replaces redundant close button** — The X in the notification panel header has been replaced with a trash icon. Click it to bulk-delete all notifications after a confirmation prompt.

## v1.3.3

- **Fix: Due date calendar only highlights the real date** — The date picker no longer shows today (or the matching day-of-month) filled in every month you navigate to. Only the actual due date is filled; today shows a subtle border when it isn't the selected date

## v1.3.2

- **Fix: Quick-add sees all your labels** — The quick-add popup's `@` picker now shows every label across your projects, and picking one that lives in a different project links it to the active project instead of creating a duplicate
- **Fix: Sync status reflects reality** — The sync dot no longer turns red just because you haven't edited anything for a while. It only goes red when you're actually offline, Supabase is unreachable, or your local changes aren't uploading — and the tooltip tells you which
- **Fix: Invited collaborators join cleanly** — Accepting an invite to a shared project no longer fails with a scary FOREIGN KEY error on the first try. New collaborators land in the project immediately, no log-out/log-in dance required
- **Fix: Friendly email confirmation page** — After confirming your email on signup, you now land on a proper "Email confirmed — open ToDoozy to sign in" page instead of a localhost connection error

## v1.3.1

- **Update restart banner** — When a new version finishes downloading, a banner appears at the top of the app with a Restart button — no more hunting through Settings to apply updates
- **Supabase performance optimization** — Background sync is now lighter on disk and network: adaptive polling, smarter indexes, and batch queries reduce IO significantly
- **Reference URL fix** — URLs entered alongside task titles in the main input now attach correctly to the new task

## v1.3.0

- **Cookie break gamification** — The flow timer now rewards you with animated cookie treats when you take breaks. Collect cookies in a jar, track your streak, and build healthy break habits while staying productive
- **Fix: cookie stats precision** — Cookie stats now display with seconds precision instead of rounding
- **Fix: cookie labels** — Stats labels corrected to plural "Cookies"

## v1.2.1

- **Claude Desktop MCP setup** — The MCP settings page now includes a ready-to-paste JSON config for Claude Desktop users
- **Fix: update modal headers** — Section headers in the update available modal and release notes now render properly

## v1.2.0

- **Enhanced focus timer** — Long breaks, flowtime (open-ended focus) mode, and session stats summary after each work cycle
- **Interactive stats dashboard** — Click any KPI card to drill down into the matching task list. New charts: priority breakdown, project breakdown, and day-of-week activity. Streaks displayed prominently at the top
- **Fix: session refresh on auth errors** — RLS violations now trigger automatic session refresh instead of silent failures

## v1.1.6

- **My Day auto-add based on due date** — Tasks due today are now automatically included in your My Day view, so you never miss a deadline
- **Per-integration default projects** — Telegram Bot and iOS Shortcut each get their own default project setting, so tasks land in the right place regardless of how you create them
- **AND/OR label filter toggle** — The label filter bar now has a three-way toggle to switch between AND (all labels must match) and OR (any label matches) logic
- **Per-project auto-archive** — Projects can automatically archive completed tasks after a configurable number of days. My Day also shows a "Done today" section for tasks completed during the current day
- **Remote MCP server** — Connect AI assistants to your ToDoozy tasks from anywhere, not just your local machine. A Supabase Edge Function proxies MCP tool calls so Claude and other AI clients can manage your tasks remotely
- **Natural language dates** — Type dates the way you think: "tomorrow", "next Monday", "in 3 days", "every 2 weeks". ToDoozy parses natural language into structured dates and recurrence rules automatically — no more fiddling with date pickers for simple dates
- **Update available modal** — When an app update is available, a modal now shows formatted release notes so you can see what's new before installing
- **Fix: updater restart on macOS** — Installing an update now properly restarts the app instead of just hiding the window
- **Fix: bidirectional sync** — Tasks and statuses that are newer locally now push to Supabase during sync, keeping both sides in sync
- **Fix: deleted tasks reappearing** — Fixed an issue where deleted tasks could reappear after a sync cycle
- **Fix: release notes loading** — Release notes now load correctly from Supabase in the What's New tab
- **Fix: sync foreign key failures** — Resolved foreign key constraint errors during background sync
- **Fix: iOS Shortcut setup** — Updated setup instructions to include the project name in notifications
- **Fix: various UX improvements** — Cleaned up redundant section titles in Settings, fixed notification bell display, and improved calendar and verification flows
- **Notarization re-enabled** — macOS builds are now notarized via Apple's built-in notarization service

## v1.1.0

- **Settings reorganization** — The Settings modal is now cleaner with 7 tabs instead of 11. Themes and Priority Display are grouped under Appearance. Updates, What's New, Integrations, and Help are grouped under About. Section labels make each tab easier to scan.
- **MCP activity logging** — Changes made by AI assistants via MCP (creating tasks, updating statuses, assigning labels, etc.) now appear in the activity timeline, so you can see exactly what your AI did.
- **iOS Shortcut integration** — Connect ToDoozy to iOS Shortcuts for hands-free task capture from your iPhone or iPad. Find the setup instructions and API endpoint in Settings > Integrations > iOS Shortcut.
- **Telegram Bot — In-App Settings** — Configure your Telegram Bot connection directly in Settings > Integrations > Telegram Bot. Connect your Telegram ID, choose a default project, and manage bot settings without editing any config files.
- **Telegram /done and /recent** — Use `/done` to see your recently completed tasks, and `/recent` to see tasks you added recently. When you complete a task from the list, a checkmark replaces it inline so you can keep going.
- **Telegram command menu** — The bot now registers commands with Telegram, so you get an autocomplete suggestion menu when you type `/` or `.`. New commands: `.list` to see all projects, `.default` to set your default project, `.prefix` to set a command prefix.
- **Force Full Sync** — A new button in Settings > General lets you trigger a full Supabase sync on demand, useful if you suspect data is out of date.
- **Smarter database naming** — Your local database file is now named after your account email, making it easy to identify when working with multiple accounts. No stale database files created before login.
- **Real-time sync improvements** — ToDoozy now polls Supabase every 10 seconds for changes made from other devices or integrations. Project metadata (name, color, icon) also syncs down. Offline detection is more reliable — sync operations skip gracefully when there's no connection.
- **Fix: accidental text selection** — Mouse navigation no longer highlights text across the app. Text selection only works where you'd expect it: in inputs and the task description editor.
- **Fix: offline banner** — The offline notification banner now displays with the correct layout (no stray borders).
- **Fix: tray badge** — The menu bar task count updates instantly when you toggle My Day or change a task status.

## v1.0.7

- **Full Task Rows in Saved Views + Multi-Sort** — Saved views now display complete task information including status, labels, priority, due date, recurrence, timer, and subtask count. You can stack multiple sort rules (e.g., Priority then Due date) in both saved views and project views. Saved view items in the sidebar show colored dots. Custom (drag) sort in project views, with drag disabled when using other sort modes.
- **Sidebar Customization** — The sidebar is now always expanded for a cleaner layout. A light/dark theme toggle replaces the old collapse button. Stats moved to the sidebar footer. You can show/hide and reorder nav items in Settings, and keyboard shortcuts update dynamically to match your layout.
- **Supabase Full Sync Engine** — Every change you make now syncs to Supabase in the background automatically. A sync status indicator shows connection state, offline changes are queued and flushed when you reconnect, and all stores (tasks, labels, projects, settings) have write-through sync hooks.
- **Exclusion Filters** — All filter types (labels, status, priority, assignee, projects) now support "is not" exclusion mode, letting you filter out tasks that match specific criteria. Works in both the filter bar and saved views.
- **Saved Views / Smart Lists** — Create and save custom filtered views that persist across sessions. Define filter criteria (labels, priorities, statuses, due dates, keywords) and access them from the sidebar for quick one-click filtering.
- **Stats Dashboard** — A new productivity stats view powered by Recharts showing visual analytics for your tasks: completion trends, priority distributions, and productivity insights.
- **Project Areas & Folders** — Organize projects in the sidebar using areas/folders. Group related projects together for a cleaner, more structured workspace.
- **Expanded Filter System** — The filter bar now supports priority, status, due date, and keyword filters in addition to labels. Combine multiple filter types for precise task views.
- **MCP Task Reorder** — AI assistants can now reorder tasks via the new `reorder_tasks` MCP tool, enabling automated task prioritization and sorting.
- **Improved Drag & Drop** — Drag-and-drop has been overhauled with horizontal intent detection and full-row ghost rendering for a smoother, more intuitive experience.
- **Fix: Command palette filters** — Label and assignee filters now clear properly when navigating to a task from the command palette.

## v1.0.6

- **Timer improvements** — Better timer UX and reliability improvements
- **Label search** — Search through your labels for faster filtering
- **Member display reliability** — More reliable member avatar display in shared projects

## v1.0.5

- **What's New from GitHub** — The What's New tab now pulls release notes directly from GitHub, so you always see the latest changes. Works offline too with bundled fallback.
- **Help search** — Search through the help documentation to find what you need faster
- **Shared project fixes** — Fixed several issues with shared project syncing including stale sessions, invite reliability, and member display

## v1.0.4

- **Member display fix** — Fixed an issue where member avatars wouldn't update after collaborator changes

## v1.0.2

- **Assignee filter** — Click member avatars to filter tasks by assignee. Multi-select supported with hover highlights.
- **Member display sync** — Member display customizations (color, initials) now sync across devices via Supabase
- **Shared project reliability** — Fixed realtime invite subscriptions, stale sessions, duplicate labels on sync, and post-reinstall state recovery

## v1.0.0

- **Auto-Update Mechanism** — The app now checks for updates automatically on launch and every 4 hours. When an update is available, a dialog shows the new version and release notes with options to Install & Restart or dismiss. A download progress bar tracks the update. You can also manually check for updates in Settings.

## 2026-04-01 (cont.)

- **Collaboration UX polish** — Consistent avatars across all views, inline task assignment in shared projects, and improved real-time sync so collaborator changes appear instantly.
- **Remote membership discovery** — The app now discovers shared project memberships on startup and shows clear error messages if invite acceptance fails.
- **Full real-time task sync** — Changes by collaborators in shared projects now sync immediately across all connected clients.

## 2026-04-01

- **Launch at login** — Toggle in Settings > General to start ToDoozy automatically when you log into your Mac.
- **Command palette smart filters** — The search palette (CMD+K) now supports inline shortcuts: type `p:` for priority, `@` for labels, `/` for projects, `d:` for dates, or `s:` for statuses. Selections appear as filter chips that combine with text search. Press Backspace on empty input to remove the last chip.
- **Gemini MCP setup** — MCP settings now include Google AI Studio (Gemini) instructions alongside Claude Code and Claude Desktop.
- **Tray icon fix** — The system tray icon now appears correctly in the installed/packaged app.
- **MCP server fix** — The MCP server now works correctly in the built app for Claude Desktop and other MCP clients.

## 2026-03-31

- **Smart Recurrence Picker** — The recurrence input is now a structured picker instead of a free-text field. Choose interval, unit (days/weeks/months/years), specific days, Fixed or After-completion mode, and an optional end date. A live preview shows the human-readable rule and next occurrence. Completing a recurring task now automatically creates a clone with the next due date. Task rows show a repeat icon with tooltip.
- **Reference URL in quick-add** — Use the `r:` operator in quick-add or any task input to attach a reference URL inline. The quick-add window also now has a description toggle for adding notes.
- **Cmd+K archive search** — The command palette now includes an "include archived" checkbox so you can search across archived tasks. Results show project names and archive indicators for clarity.
- **Distribution-ready build** — ToDoozy can now be built as a standalone macOS app (DMG + ZIP) for distribution. See the README for build and code-signing instructions.
- **Multi-user data isolation** — All tasks, projects, labels, and settings are now scoped per user. Multiple users can safely share the same database without seeing each other's data.
- **Fix: Autocomplete ranking** — Exact and prefix matches now appear above substring matches in label and project autocomplete dropdowns.
- **Fix: Status cycling** — Fixed focus loss and scroll jumping when cycling task status via keyboard. Also fixed the click-opens-detail setting and My Day default project assignment.
- **Fix: Label color defaults** — New labels now default to the least-used color from the palette.
- **Fix: In-progress status** — Removed the mandatory in-progress status requirement and fixed done task positioning in My Day.

## 2026-03-30

- **Due date notifications** — Tasks with a due date and time now trigger native macOS notifications 15 minutes before the due time. Click the notification to jump straight to the task.
- **Fix: Notification timezone handling** — Notifications now fire at the correct local time regardless of timezone.
- **Fix: Calendar view polish** — Improved tooltips, week numbers, My Day task display, status sorting, and drag-and-drop in the calendar view.
- **Task reference URL** — Add a reference URL to any task. The URL appears as a clickable link icon on task rows and as an editable field in the detail panel. URLs without a protocol automatically get `https://` prepended. The field autosaves after 1 second, and you can clear it with the X button.
- **Calendar View** — A new Calendar view in the sidebar (⌘2) shows all tasks organized by their due date. Toggle between monthly grid and weekly layout. Navigate with arrow buttons. Today is highlighted, overdue tasks show in red. Click a task to open the detail panel, or drag it to a different day to update the due date.
- **Template Wizard — Relative Due Date Offsets** — When saving a project as a template, the wizard now offers to preserve due dates as relative offsets (e.g., "5 days after deploy"). When you deploy the template, pick a start date and all task due dates are computed automatically.

## 2026-03-29

- **Fix: Quick-add follows theme** — The quick-add popup (Cmd+Shift+Space) now opens with the correct theme instantly, no more dark flash when using a light theme.
- **Fix: Status changes respect position setting** — Changing a task's status now places it according to your default task position preference.
- **Fix: Context menu and label fixes in My Day** — Labels now display correctly in My Day context menus, labels transfer properly when moving tasks between projects, and Shift+Delete works on labels.
- **Fix: Consistent ESC/Tab behavior** — Escape and Tab now work uniformly across My Day and project views.
- **Improved date picker keyboard navigation** — Tab cycles through all date picker fields including the clear button and time picker. The clock icon auto-sets time to 3 hours from now.
- **Global Escape popup system** — A centralized stack manages Escape key dismissal, ensuring the topmost overlay always closes first.
- **Due dates visible in task rows** — Due dates now show inline on task rows with red overdue styling for past-due tasks.
- **Subtask keyboard navigation** — Arrow keys now navigate through subtasks; My Day auto-selects the first task on view entry.
- **Migrated to node:sqlite** — Replaced better-sqlite3 with Node.js built-in sqlite module for simpler builds and no native compilation.

## 2026-03-25

- **Keyboard shortcuts modal** — Press `?` anywhere (or click the `?` button in the sidebar) to open a modal listing every keyboard shortcut, grouped by category. Configurable shortcuts always show their current binding.
- **Help tab in Settings** — A new Help tab in Settings contains full documentation for every ToDoozy feature, plus a complete shortcuts reference table.

## 2026-03-22

- **Multi-select drag to project** — Select multiple tasks, then drag any of them onto a project in the sidebar to move them all at once. An undo option appears for 5 seconds.
- **Undo on bulk moves** — All bulk task moves now show an undo toast so you can reverse accidental drops.
- **Global labels** — Labels are now shared across all your projects. Create a label once and add it to any project. Renaming or recoloring a label updates it everywhere.
- **Rich text editor** — Task descriptions now use a full WYSIWYG editor with slash commands, a bubble toolbar, interactive checklists, and Cmd+K for links.
- **App toggle shortcut** — Press Cmd+Shift+B (configurable) to show or hide ToDoozy from anywhere.
- **Pomodoro timer** — Each task now has a built-in timer. Hover a task and click the play button to start. The countdown appears in the menu bar.
- **MCP integration** — Connect Claude or any MCP-compatible AI to your task list. Enable in Settings → MCP.
- **Task and project templates** — Save any task or project as a template. Deploy project templates via a step-by-step wizard.
- **macOS menu bar** — ToDoozy lives in your menu bar. Close the window and it stays accessible; your task count shows as a badge.
- **iCloud file attachments** — Attach files to any task. Files sync to iCloud Drive for access from other devices. Enable in Settings → iCloud.
- **Tab keyboard navigation** — Full keyboard navigation through the detail panel. Tab cycles through all fields; Escape closes and returns focus to the task list.

## 2026-03-21

- **Smart input** — Use `@label`, `p:priority`, and `d:date` shortcuts directly in the task input to set labels, priority, and due date as you type.
- **Quick-add from anywhere** — Press Cmd+Shift+Space to add a task to My Day without switching to ToDoozy.
- **Copy task titles** — Press Cmd+C to copy selected task titles to your clipboard. Multiple tasks copy as a markdown list.

## 2026-03-20

- Initial release: task management, subtasks, drag & drop, kanban, themes, labels, priorities, context menus, command palette, and Supabase authentication.

---

*This file is updated automatically at the end of each development session.*
