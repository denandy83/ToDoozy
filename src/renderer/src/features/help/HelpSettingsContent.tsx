import { useSetting } from '../../shared/stores/settingsStore'

interface HelpSectionProps {
  title: string
  children: React.ReactNode
}

function HelpSection({ title, children }: HelpSectionProps): React.JSX.Element {
  return (
    <div>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

interface HelpItemProps {
  label: string
  description: string
}

function HelpItem({ label, description }: HelpItemProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-sm font-light text-muted">{description}</p>
    </div>
  )
}

function ShortcutTableRow({ keys, description }: { keys: string; description: string }): React.JSX.Element {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 pr-4">
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
          {keys}
        </kbd>
      </td>
      <td className="py-2 text-sm font-light text-foreground">{description}</td>
    </tr>
  )
}

export function HelpSettingsContent(): React.JSX.Element {
  const appToggleShortcut = useSetting('app_toggle_shortcut') ?? 'Cmd+Shift+B'

  return (
    <div className="flex flex-col gap-8">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Help & Documentation</p>

      {/* Tasks */}
      <HelpSection title="Tasks">
        <HelpItem
          label="Creating tasks"
          description="Click the 'Add task' input at the top of any project list and press Enter. Use smart shortcuts while typing: @label assigns a label, p:high sets priority, d:today sets due date."
        />
        <HelpItem
          label="Subtasks"
          description="Right-click a task → Add Subtask, or open the detail panel and use the Subtasks section. Drag a task onto the middle of another task to nest it."
        />
        <HelpItem
          label="Status"
          description="Click the status circle on a task row to cycle through statuses. Right-click for a full status submenu. Each project has configurable statuses (default: Not Started, In Progress, Done)."
        />
        <HelpItem
          label="Priorities"
          description="Set priority via right-click menu, the detail panel, or smart input (p:low / p:normal / p:high / p:urgent). Priority is shown as a colored indicator on the task row."
        />
        <HelpItem
          label="Due dates"
          description="Set due dates in the detail panel or via smart input (d:today, d:tomorrow, d:monday, d:jan15). Tasks due today automatically appear in My Day."
        />
        <HelpItem
          label="Multi-select"
          description="Click to select one task. Shift+click to select a range. Cmd+click to toggle individual tasks. Selected tasks can be moved, archived, or deleted together."
        />
      </HelpSection>

      {/* My Day */}
      <HelpSection title="My Day">
        <HelpItem
          label="What appears in My Day"
          description="Tasks you've explicitly pinned to My Day, plus any tasks with a due date of today. Grouped by project."
        />
        <HelpItem
          label="Adding to My Day"
          description="Right-click any task → Pin to My Day. Or open the task detail panel and toggle the My Day switch. Use the quick-add window (Cmd+Shift+Space) to add directly."
        />
        <HelpItem
          label="Quick-add from anywhere"
          description="Press Cmd+Shift+Space (configurable in Settings → General) to open the quick-add window without switching to ToDoozy. The task goes into My Day."
        />
      </HelpSection>

      {/* Projects */}
      <HelpSection title="Projects">
        <HelpItem
          label="Creating projects"
          description="Click the + button next to 'Projects' in the sidebar. Choose a name and color. Default statuses (Not Started, In Progress, Done) are created automatically."
        />
        <HelpItem
          label="Project settings"
          description="Open Settings → Projects to rename, recolor, reorder, and configure statuses for each project."
        />
        <HelpItem
          label="Templates"
          description="Save any project as a template via the template icon in the header. Deploy templates from the Templates view in the sidebar."
        />
      </HelpSection>

      {/* Labels */}
      <HelpSection title="Labels">
        <HelpItem
          label="Global labels"
          description="Labels are shared across all projects. Create a label once and use it anywhere. Renaming or recoloring a label updates it everywhere."
        />
        <HelpItem
          label="Assigning labels"
          description="Click the label icon on a task row, or use the detail panel. Smart input: type @labelname while adding a task to assign on creation."
        />
        <HelpItem
          label="Filtering by label"
          description="Click any label chip in the task list to filter. Multiple labels filter with AND logic. Click again to clear."
        />
        <HelpItem
          label="Managing labels"
          description="Go to Settings → Labels to create, rename, recolor, and delete labels."
        />
      </HelpSection>

      {/* Kanban */}
      <HelpSection title="Kanban View">
        <HelpItem
          label="Toggling kanban"
          description="Press Cmd+L or click the Kanban button in the header. Available in My Day and project views. Each project remembers your last view mode."
        />
        <HelpItem
          label="Moving cards"
          description="Drag cards between columns to change status. Drag within a column to reorder."
        />
      </HelpSection>

      {/* Pomodoro */}
      <HelpSection title="Pomodoro Timer">
        <HelpItem
          label="Starting a timer"
          description="Hover over any task and click the play button that appears. The countdown appears in the macOS menu bar."
        />
        <HelpItem
          label="Timer settings"
          description="Go to Settings → Timer to configure work duration, short break, long break intervals, and auto-start behavior."
        />
        <HelpItem
          label="Menu bar controls"
          description="Click the menu bar icon to pause, resume, or stop the timer from anywhere on your Mac."
        />
      </HelpSection>

      {/* Attachments */}
      <HelpSection title="File Attachments">
        <HelpItem
          label="Attaching files"
          description="Enable iCloud Drive in Settings → iCloud. Then use the attachment icon in the task description toolbar to attach files. Files sync to iCloud Drive for access from other devices."
        />
        <HelpItem
          label="Viewing attachments"
          description="Attachment cards appear below the description. Click to open in the default macOS app. Hover to see the remove button."
        />
        <HelpItem
          label="Limits"
          description="Maximum 10 MB per file, 10 attachments per task."
        />
      </HelpSection>

      {/* Smart Input */}
      <HelpSection title="Smart Input">
        <HelpItem
          label="Labels"
          description="Type @labelname to assign a label. If the label doesn't exist, it's created automatically."
        />
        <HelpItem
          label="Priority"
          description="Type p:low, p:normal, p:high, or p:urgent to set priority."
        />
        <HelpItem
          label="Due date"
          description="Type d:today, d:tomorrow, d:monday, d:jan15, etc. to set a due date. Natural language parsing is supported."
        />
      </HelpSection>

      {/* MCP */}
      <HelpSection title="MCP — AI Integration">
        <HelpItem
          label="What is MCP?"
          description="The Model Context Protocol lets Claude (or any MCP-compatible AI) read and manage your task list directly — without copy-pasting. Enable in Settings → MCP."
        />
        <HelpItem
          label="Setting up"
          description="Go to Settings → MCP to get your connection config. Paste it into Claude's MCP settings. Claude can then create, update, and complete tasks on your behalf."
        />
        <HelpItem
          label="Available operations"
          description="List tasks, create tasks, update tasks, complete tasks, and create projects — all through natural language instructions to Claude."
        />
      </HelpSection>

      {/* Keyboard Shortcuts Reference */}
      <HelpSection title="Keyboard Shortcuts">
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <tbody className="divide-y divide-border/30">
              <tr className="bg-foreground/3">
                <td colSpan={2} className="px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted">Navigation</span>
                </td>
              </tr>
              <ShortcutTableRow keys="⌘1" description="My Day" />
              <ShortcutTableRow keys="⌘2" description="Project view (first project)" />
              <ShortcutTableRow keys="⌘3" description="Archive" />
              <ShortcutTableRow keys="⌘4" description="Templates" />
              <ShortcutTableRow keys="⌘L" description="Toggle kanban / list view" />
              <ShortcutTableRow keys="Tab / Shift+Tab" description="Cycle projects (no task selected)" />
              <tr className="bg-foreground/3">
                <td colSpan={2} className="px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted">Tasks</span>
                </td>
              </tr>
              <ShortcutTableRow keys="Enter" description="Open task detail panel" />
              <ShortcutTableRow keys="Space" description="Toggle task status" />
              <ShortcutTableRow keys="⌘C" description="Copy selected task title(s)" />
              <ShortcutTableRow keys="Delete / Backspace" description="Delete selected task(s)" />
              <ShortcutTableRow keys="Shift+Click" description="Select a range of tasks" />
              <ShortcutTableRow keys="⌘Click" description="Toggle individual selection" />
              <tr className="bg-foreground/3">
                <td colSpan={2} className="px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted">Detail Panel</span>
                </td>
              </tr>
              <ShortcutTableRow keys="Tab" description="Cycle fields (title → status → priority → labels → due date → description)" />
              <ShortcutTableRow keys="Shift+Tab" description="Reverse through fields" />
              <ShortcutTableRow keys="Escape" description="Close panel, return focus to task list" />
              <tr className="bg-foreground/3">
                <td colSpan={2} className="px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted">Global</span>
                </td>
              </tr>
              <ShortcutTableRow keys="⌘K" description="Open command palette" />
              <ShortcutTableRow keys="?" description="Show keyboard shortcuts" />
              <ShortcutTableRow keys={appToggleShortcut} description="Show / hide ToDoozy from anywhere" />
            </tbody>
          </table>
        </div>
      </HelpSection>
    </div>
  )
}
