import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'

const LEAD_TIME_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' }
]

export function NotificationsSettingsContent(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const enabled = useSetting('notifications_enabled') ?? 'true'
  const leadTime = useSetting('notifications_lead_time') ?? '15'

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Notifications
      </p>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Enable notifications</p>
          <p className="text-[10px] text-muted">
            Get notified when tasks with a due time are approaching
          </p>
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
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">
              How it works
            </p>
            <ul className="flex flex-col gap-1.5 text-sm font-light text-fg-secondary">
              <li>First notification fires {LEAD_TIME_OPTIONS.find((o) => o.value === leadTime)?.label ?? leadTime + ' minutes'} before due</li>
              <li>Second notification fires 1 minute before due</li>
              <li>Only tasks with a specific time (not date-only) trigger notifications</li>
              <li>Completed tasks are skipped</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
