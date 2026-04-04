import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { ShortcutRecorder, AppToggleShortcutRecorder } from './ShortcutRecorder'
import { Eye, EyeOff } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
      <ToggleSetting
        settingKey="click_opens_detail"
        defaultValue="true"
        label="Click opens detail panel"
        description="Open the detail panel when clicking a task. When off, use double-click or Enter."
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

export function MyDaySection(): React.JSX.Element {
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

const COMMON_TIMEZONES = [
  { value: 'auto', label: 'Auto (system)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST)' },
  { value: 'America/Denver', label: 'Mountain (MST)' },
  { value: 'America/Chicago', label: 'Central (CST)' },
  { value: 'America/New_York', label: 'Eastern (EST)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'Atlantic/Reykjavik', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET)' },
  { value: 'Europe/Helsinki', label: 'Eastern Europe (EET)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Shanghai', label: 'China (CST)' },
  { value: 'Asia/Tokyo', label: 'Japan (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Pacific/Auckland', label: 'New Zealand (NZST)' }
]

function SystemSection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const enabledSetting = useSetting('auto_archive_enabled') ?? 'false'
  const valueSetting = useSetting('auto_archive_value') ?? '3'
  const unitSetting = useSetting('auto_archive_unit') ?? 'days'
  const dateFormat = useSetting('date_format') ?? 'dd/mm/yyyy'
  const weekStart = useSetting('week_start') ?? 'monday'
  const timezone = useSetting('timezone') ?? 'auto'
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
          <p className="text-sm font-light text-foreground">Timezone</p>
          <p className="text-[10px] text-muted">Used for activity log timestamps and time display</p>
        </div>
        <select
          value={timezone}
          onChange={(e) => setSetting('timezone', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Week starts on</p>
          <p className="text-[10px] text-muted">Affects calendar, stats, and weekly views</p>
        </div>
        <select
          value={weekStart}
          onChange={(e) => setSetting('week_start', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </select>
      </div>
      <ToggleSetting
        settingKey="shift_delete_enabled"
        defaultValue="false"
        label="Shift+click to delete"
        description="Hold Shift while clicking delete to skip confirmation"
      />
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

const DEFAULT_SIDEBAR_ORDER: string[] = ['my-day', 'calendar', 'views', 'projects', 'archive', 'templates']
const SIDEBAR_ITEM_LABELS: Record<string, string> = {
  'my-day': 'My Day',
  'calendar': 'Calendar',
  'views': 'Views',
  'projects': 'Projects',
  'archive': 'Archive',
  'templates': 'Templates'
}

function SidebarSection(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const orderJson = useSetting('sidebar_order')
  const hiddenJson = useSetting('sidebar_hidden')

  const order: string[] = (() => {
    let o: string[] = orderJson ? JSON.parse(orderJson) as string[] : DEFAULT_SIDEBAR_ORDER
    const s = new Set(o)
    for (const item of DEFAULT_SIDEBAR_ORDER) { if (!s.has(item)) o.push(item) }
    o = o.filter((id) => DEFAULT_SIDEBAR_ORDER.includes(id))
    return o
  })()
  const hidden = new Set<string>(hiddenJson ? JSON.parse(hiddenJson) as string[] : [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(active.id as string)
    const newIndex = order.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    setSetting('sidebar_order', JSON.stringify(arrayMove(order, oldIndex, newIndex)))
  }, [order, setSetting])

  const toggleHidden = useCallback((id: string) => {
    if (id === 'my-day') return
    const newHidden = new Set(hidden)
    if (newHidden.has(id)) {
      newHidden.delete(id)
    } else {
      newHidden.add(id)
    }
    setSetting('sidebar_hidden', JSON.stringify([...newHidden]))
  }, [hidden, setSetting])

  let shortcutIndex = 1

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] text-muted mb-1">Drag to reorder. Toggle visibility with the eye icon. My Day is always visible.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {order.map((id) => {
            const isHidden = hidden.has(id)
            const currentShortcut = !isHidden ? `⌘${shortcutIndex++}` : null
            return (
              <SortableSidebarItem
                key={id}
                id={id}
                label={SIDEBAR_ITEM_LABELS[id] ?? id}
                isHidden={isHidden}
                isMyDay={id === 'my-day'}
                shortcut={currentShortcut}
                onToggleHidden={() => toggleHidden(id)}
              />
            )
          })}
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface SortableSidebarItemProps {
  id: string
  label: string
  isHidden: boolean
  isMyDay: boolean
  shortcut: string | null
  onToggleHidden: () => void
}

function SortableSidebarItem({ id, label, isHidden, isMyDay, shortcut, onToggleHidden }: SortableSidebarItemProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 rounded-lg border border-border px-2 py-2 transition-colors touch-none ${
        isDragging ? 'bg-accent/8 border-accent/30 cursor-grabbing' : 'bg-surface hover:bg-foreground/4 cursor-grab'
      }`}
    >
      <span className={`flex-1 text-sm font-light ${isHidden ? 'text-muted/40 line-through' : 'text-foreground'}`}>
        {label}
      </span>
      {shortcut && (
        <span className="text-[10px] text-muted/50 font-light tabular-nums">{shortcut}</span>
      )}
      {!isMyDay && (
        <button
          onClick={onToggleHidden}
          className="rounded p-1 text-muted transition-colors hover:bg-foreground/6"
          title={isHidden ? 'Show in sidebar' : 'Hide from sidebar'}
        >
          {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
    </div>
  )
}

export function GeneralSettingsContent(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SectionLabel first>Sidebar</SectionLabel>
      <SidebarSection />

      <SectionLabel>Task Behavior</SectionLabel>
      <TaskBehaviorSection />

      <SectionLabel>Quick Add</SectionLabel>
      <QuickAddSection />

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
