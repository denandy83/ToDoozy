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
      style={{ borderColor: config.border, backgroundColor: config.bg, minHeight: '180px' }}
    >
      {/* Mock sidebar */}
      <div
        className="flex w-32 flex-col gap-0.5 p-3"
        style={{ backgroundColor: config.sidebar, borderRight: `1px solid rgba(255,255,255,0.1)` }}
      >
        {/* Logo */}
        <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1">
          <div
            className="h-4 w-4 rounded"
            style={{ backgroundColor: config.accent + '26' }}
          >
            <div className="flex h-full items-center justify-center">
              <span style={{ color: config.accent, fontSize: '9px', fontWeight: 700 }}>TD</span>
            </div>
          </div>
          <span style={{ color: config.fg, fontSize: '9px', fontWeight: 700 }}>ToDoozy</span>
        </div>

        {/* My Day - active */}
        <div
          className="flex items-center gap-1.5 rounded px-1.5 py-1"
          style={{ backgroundColor: config.accent + '1f', borderLeft: `2px solid ${config.accent}` }}
        >
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: config.accent }} />
          <span style={{ color: config.fg, fontSize: '9px' }}>My Day</span>
        </div>

        {/* Projects header */}
        <div className="flex items-center gap-1.5 px-1.5 py-1 mt-0.5">
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: config.muted + '40' }} />
          <span style={{ color: config.fgMuted, fontSize: '9px' }}>Projects</span>
        </div>

        {/* Project items - indented */}
        {['Personal', 'Work'].map((item) => (
          <div
            key={item}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 ml-3"
          >
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item === 'Personal' ? config.accent : '#f59e0b' }} />
            <span style={{ color: config.fgSecondary, fontSize: '8px' }}>{item}</span>
          </div>
        ))}

        {/* Archive */}
        <div className="flex items-center gap-1.5 rounded px-1.5 py-1 mt-0.5">
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: config.muted + '40' }} />
          <span style={{ color: config.fgSecondary, fontSize: '9px' }}>Archive</span>
        </div>
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

        {/* Not Started section */}
        <div className="px-3 pt-2 pb-1">
          <span style={{ color: '#888888', fontSize: '7px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
            Not Started
          </span>
        </div>

        <div className="flex flex-col gap-1 px-3">
          {[
            { title: 'Design system review', projectColor: config.accent, initials: 'PE', label: { name: 'UI', color: config.accent } },
            { title: 'Update documentation', projectColor: '#f59e0b', initials: 'WO', label: null }
          ].map((task) => (
            <div
              key={task.title}
              className="flex items-center gap-1.5 rounded px-2 py-1"
              style={{ backgroundColor: surface }}
            >
              {/* Project indicator → Status circle → Title → Labels */}
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ backgroundColor: task.projectColor }}>
                <span style={{ color: '#fff', fontSize: '5px', fontWeight: 700 }}>{task.initials}</span>
              </div>
              <div
                className="h-2.5 w-2.5 rounded-full border"
                style={{ borderColor: config.border, backgroundColor: 'transparent' }}
              />
              <span style={{ color: config.fg, fontSize: '8px', fontWeight: 300, flex: 1 }}>{task.title}</span>
              {task.label && (
                <span
                  className="rounded-full px-1 py-0"
                  style={{ backgroundColor: task.label.color + '20', color: task.label.color, fontSize: '5px', fontWeight: 700, border: `1px solid ${task.label.color}30` }}
                >
                  {task.label.name}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* In Progress section */}
        <div className="px-3 pt-2 pb-1">
          <span style={{ color: '#f59e0b', fontSize: '7px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
            In Progress
          </span>
        </div>

        <div className="flex flex-col gap-1 px-3">
          <div className="flex items-center gap-1.5 rounded px-2 py-1" style={{ backgroundColor: surface }}>
            <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ backgroundColor: config.accent }}>
              <span style={{ color: '#fff', fontSize: '5px', fontWeight: 700 }}>PE</span>
            </div>
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#f59e0b', border: `1px solid #f59e0b` }}>
              <div className="flex h-full items-center justify-center">
                <div className="h-1 w-1 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
              </div>
            </div>
            <span style={{ color: config.fg, fontSize: '8px', fontWeight: 300, flex: 1 }}>Prepare presentation</span>
            <span
              className="rounded-full px-1 py-0"
              style={{ backgroundColor: '#ef4444' + '20', color: '#ef4444', fontSize: '5px', fontWeight: 700, border: '1px solid #ef444430' }}
            >
              Urgent
            </span>
          </div>
        </div>

        {/* Done section */}
        <div className="px-3 pt-2 pb-1">
          <span style={{ color: '#22c55e', fontSize: '7px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
            Done
          </span>
        </div>
        <div className="flex flex-col gap-1 px-3">
          <div className="flex items-center gap-1.5 rounded px-2 py-1" style={{ backgroundColor: surface }}>
            <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ backgroundColor: '#f59e0b' }}>
              <span style={{ color: '#fff', fontSize: '5px', fontWeight: 700 }}>WO</span>
            </div>
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />
            <span style={{ color: config.fgMuted, fontSize: '8px', fontWeight: 300, textDecoration: 'line-through', flex: 1 }}>Fix login bug</span>
          </div>
        </div>
      </div>
    </div>
  )
}
