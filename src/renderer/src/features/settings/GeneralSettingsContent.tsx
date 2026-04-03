import { useState, useEffect } from 'react'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { ShortcutRecorder, AppToggleShortcutRecorder } from './ShortcutRecorder'

const LEAD_TIME_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' }
]

function SectionLabel({ children, first }: { children: string; first?: boolean }): React.JSX.Element {
  return (
    <p className={`text-[10px] font-bold uppercase tracking-[0.3em] text-muted ${first ? '' : 'mt-6'}`}>
      {children}
    </p>
  )
}

function ToggleSetting({
  settingKey,
  defaultValue,
  label,
  description
}: {
  settingKey: string
  defaultValue: string
  label: string
  description: string
}): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const value = useSetting(settingKey) ?? defaultValue

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-light text-foreground">{label}</p>
        <p className="text-[10px] text-muted">{description}</p>
      </div>
      <div className="flex rounded-lg border border-border overflow-hidden">
        <button
          onClick={() => setSetting(settingKey, 'true')}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            value === 'true' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          On
        </button>
        <button
          onClick={() => setSetting(settingKey, 'false')}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            value === 'false' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          Off
        </button>
      </div>
    </div>
  )
}

function TaskBehaviorSection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const addPosition = useSetting('new_task_position') ?? 'top'
  const dateFormat = useSetting('date_format') ?? 'dd/mm/yyyy'

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Default task position</p>
          <p className="text-[10px] text-muted">Where tasks appear when created or moved to a status group</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('new_task_position', 'top')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              addPosition === 'top' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Top
          </button>
          <button
            onClick={() => setSetting('new_task_position', 'bottom')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              addPosition === 'bottom' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Bottom
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Date format</p>
          <p className="text-[10px] text-muted">How dates are displayed throughout the app</p>
        </div>
        <select
          value={dateFormat}
          onChange={(e) => setSetting('date_format', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          <option value="dd/mm/yyyy">DD/MM/YYYY</option>
          <option value="mm/dd/yyyy">MM/DD/YYYY</option>
          <option value="yyyy/mm/dd">YYYY/MM/DD</option>
        </select>
      </div>
      <ToggleSetting
        settingKey="click_opens_detail"
        defaultValue="true"
        label="Click opens detail panel"
        description="Open the detail panel when clicking a task. When off, use double-click or Enter."
      />
      <ToggleSetting
        settingKey="shift_delete_enabled"
        defaultValue="false"
        label="Shift+click to delete"
        description="Hold Shift while clicking delete to skip confirmation"
      />
    </>
  )
}

function QuickAddSection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const projects = useProjectStore(selectAllProjects)
  const quickAddDefaultProject = useSetting('quickadd_default_project') ?? ''

  return (
    <>
      <ToggleSetting
        settingKey="quickadd_default_myday"
        defaultValue="true"
        label="Quick-add default My Day"
        description='Auto-check "My Day" when using the quick-add window'
      />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Quick-add default project</p>
          <p className="text-[10px] text-muted">Pre-selected project when opening quick-add</p>
        </div>
        <select
          value={quickAddDefaultProject || (projects.find((p) => p.is_default === 1)?.id ?? projects[0]?.id ?? '')}
          onChange={(e) => setSetting('quickadd_default_project', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
    </>
  )
}

function MyDaySection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const projects = useProjectStore(selectAllProjects)
  const myDayDefaultProject = useSetting('myday_default_project') ?? ''

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-light text-foreground">My Day default project</p>
        <p className="text-[10px] text-muted">Pre-selected project when adding tasks in My Day</p>
      </div>
      <select
        value={myDayDefaultProject || (projects.find((p) => p.is_default === 1)?.id ?? projects[0]?.id ?? '')}
        onChange={(e) => setSetting('myday_default_project', e.target.value)}
        className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  )
}

function NotificationsSection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const enabled = useSetting('notifications_enabled') ?? 'true'
  const leadTime = useSetting('notifications_lead_time') ?? '15'

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Enable notifications</p>
          <p className="text-[10px] text-muted">Get notified when tasks with a due time are approaching</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('notifications_enabled', 'true')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              enabled === 'true' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => setSetting('notifications_enabled', 'false')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              enabled === 'false' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>
      {enabled === 'true' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-foreground">Lead time</p>
              <p className="text-[10px] text-muted">How far in advance to send the first notification</p>
            </div>
            <select
              value={leadTime}
              onChange={(e) => setSetting('notifications_lead_time', e.target.value)}
              className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
            >
              {LEAD_TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">How it works</p>
            <ul className="flex flex-col gap-1.5 text-sm font-light text-fg-secondary">
              <li>First notification fires {LEAD_TIME_OPTIONS.find((o) => o.value === leadTime)?.label ?? leadTime + ' minutes'} before due</li>
              <li>Second notification fires 1 minute before due</li>
              <li>Only tasks with a specific time (not date-only) trigger notifications</li>
              <li>Completed tasks are skipped</li>
            </ul>
          </div>
        </>
      )}
    </>
  )
}

function SystemSection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const enabledSetting = useSetting('auto_archive_enabled') ?? 'false'
  const valueSetting = useSetting('auto_archive_value') ?? '3'
  const unitSetting = useSetting('auto_archive_unit') ?? 'days'
  const enabled = enabledSetting === 'true'

  useEffect(() => {
    window.api.app.getLoginItemSettings().then((settings) => {
      setOpenAtLogin(settings.openAtLogin)
    })
  }, [])

  const toggleLogin = (value: boolean): void => {
    setOpenAtLogin(value)
    window.api.app.setLoginItemSettings(value)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Launch at login</p>
          <p className="text-[10px] text-muted">Start ToDoozy automatically when you log into your Mac</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => toggleLogin(true)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              openAtLogin ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => toggleLogin(false)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              !openAtLogin ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Auto-archive after done</p>
          <p className="text-[10px] text-muted">Automatically archive tasks after being done for a set time</p>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <>
              <input
                type="number"
                min={1}
                max={999}
                value={valueSetting}
                onChange={(e) => setSetting('auto_archive_value', e.target.value)}
                className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <select
                value={unitSetting}
                onChange={(e) => setSetting('auto_archive_unit', e.target.value)}
                className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
              >
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setSetting('auto_archive_enabled', 'true')}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                enabled ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
              }`}
            >
              On
            </button>
            <button
              onClick={() => setSetting('auto_archive_enabled', 'false')}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                !enabled ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
              }`}
            >
              Off
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export function GeneralSettingsContent(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SectionLabel first>Task Behavior</SectionLabel>
      <TaskBehaviorSection />

      <SectionLabel>Quick Add</SectionLabel>
      <QuickAddSection />

      <SectionLabel>My Day</SectionLabel>
      <MyDaySection />

      <SectionLabel>Notifications</SectionLabel>
      <NotificationsSection />

      <SectionLabel>System</SectionLabel>
      <SystemSection />

      <SectionLabel>Keyboard Shortcuts</SectionLabel>
      <ShortcutRecorder />
      <AppToggleShortcutRecorder />
    </div>
  )
}
