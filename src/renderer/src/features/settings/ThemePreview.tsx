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
        style={{ backgroundColor: surface, borderRight: `1px solid ${config.border}` }}
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

        {/* Status section header */}
        <div className="px-3 pt-2 pb-1">
          <span style={{ color: '#888888', fontSize: '7px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
            Not Started
          </span>
        </div>

        {/* Mock task list */}
        <div className="flex flex-col gap-1 px-3">
          {[
            { title: 'Design system review', priority: config.accent, done: false, project: config.accent },
            { title: 'Update documentation', priority: config.muted, done: false, project: '#f59e0b' },
            { title: 'Prepare presentation', priority: '#f59e0b', done: false, project: config.accent }
          ].map((task) => (
            <div
              key={task.title}
              className="flex items-center gap-1.5 rounded px-2 py-1"
              style={{ backgroundColor: surface }}
            >
              <div
                className="h-2.5 w-2.5 rounded-full border"
                style={{ borderColor: config.border, backgroundColor: 'transparent' }}
              />
              <div className="flex h-3 w-3 items-center justify-center rounded-full" style={{ backgroundColor: task.project }}>
                <span style={{ color: '#fff', fontSize: '5px', fontWeight: 700 }}>P</span>
              </div>
              <span style={{ color: config.fg, fontSize: '8px', fontWeight: 300 }}>{task.title}</span>
            </div>
          ))}
        </div>

        {/* Done section */}
        <div className="px-3 pt-2 pb-1">
          <span style={{ color: '#22c55e', fontSize: '7px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
            Done
          </span>
        </div>
        <div className="flex flex-col gap-1 px-3">
          <div className="flex items-center gap-1.5 rounded px-2 py-1" style={{ backgroundColor: surface }}>
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />
            <div className="flex h-3 w-3 items-center justify-center rounded-full" style={{ backgroundColor: config.accent }}>
              <span style={{ color: '#fff', fontSize: '5px', fontWeight: 700 }}>P</span>
            </div>
            <span style={{ color: config.fgMuted, fontSize: '8px', fontWeight: 300, textDecoration: 'line-through' }}>Fix login bug</span>
          </div>
        </div>
      </div>
    </div>
  )
}
