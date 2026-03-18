import type { ThemeConfig } from '../../../../shared/types'

interface ThemePreviewProps {
  config: ThemeConfig
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function ThemePreview({ config }: ThemePreviewProps): React.JSX.Element {
  const bgBrightness =
    parseInt(config.bg.replace('#', '').slice(0, 2), 16) +
    parseInt(config.bg.replace('#', '').slice(2, 4), 16) +
    parseInt(config.bg.replace('#', '').slice(4, 6), 16)
  const isDark = bgBrightness < 384
  const surface = adjustColor(config.bg, isDark ? 12 : -8)

  return (
    <div
      className="flex overflow-hidden rounded-lg border text-sm"
      style={{ borderColor: config.border, backgroundColor: config.bg }}
    >
      {/* Mock sidebar */}
      <div
        className="flex w-28 flex-col gap-1.5 p-2"
        style={{ backgroundColor: surface, borderRight: `1px solid ${config.border}` }}
      >
        <div className="flex items-center gap-1.5 px-1.5 py-1">
          <div
            className="h-4 w-4 rounded"
            style={{ backgroundColor: config.accent + '26' }}
          >
            <div className="flex h-full items-center justify-center">
              <span style={{ color: config.accent, fontSize: '8px', fontWeight: 700 }}>TD</span>
            </div>
          </div>
          <span style={{ color: config.fg, fontSize: '9px', fontWeight: 700 }}>ToDoozy</span>
        </div>
        <div className="mt-1 px-1">
          <span style={{ color: config.muted, fontSize: '7px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' as const }}>
            Views
          </span>
        </div>
        {['My Day', 'Backlog', 'Archive'].map((item, i) => (
          <div
            key={item}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5"
            style={
              i === 0
                ? { backgroundColor: config.accent + '1f', borderLeft: `2px solid ${config.accent}` }
                : undefined
            }
          >
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: i === 0 ? config.accent : config.muted + '40' }}
            />
            <span style={{ color: i === 0 ? config.fg : config.fgSecondary, fontSize: '8px' }}>
              {item}
            </span>
          </div>
        ))}
      </div>

      {/* Mock main area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div
          className="px-3 py-1.5"
          style={{ borderBottom: `1px solid ${config.border}` }}
        >
          <span
            style={{
              color: config.fg,
              fontSize: '11px',
              fontWeight: 300,
              letterSpacing: '0.15em',
              textTransform: 'uppercase' as const
            }}
          >
            My Day
          </span>
        </div>

        {/* Mock task list */}
        <div className="flex flex-col gap-1 p-2">
          {[
            { title: 'Design system review', priority: config.accent, done: false },
            { title: 'Update documentation', priority: config.muted, done: false },
            { title: 'Fix login bug', priority: '#ef4444', done: true }
          ].map((task) => (
            <div
              key={task.title}
              className="flex items-center gap-1.5 rounded px-2 py-1"
              style={{ backgroundColor: surface }}
            >
              <div
                className="h-2.5 w-2.5 rounded-full border"
                style={{
                  borderColor: task.done ? config.accent : config.border,
                  backgroundColor: task.done ? config.accent : 'transparent'
                }}
              />
              <div
                className="h-[2px] w-0.5 rounded-full"
                style={{ backgroundColor: task.priority }}
              />
              <span
                style={{
                  color: task.done ? config.fgMuted : config.fg,
                  fontSize: '8px',
                  fontWeight: 300,
                  textDecoration: task.done ? 'line-through' : 'none'
                }}
              >
                {task.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
