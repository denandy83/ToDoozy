import { useState, useCallback, useMemo } from 'react'
import { Minus, ArrowUp, AlertTriangle } from 'lucide-react'
import { Modal } from '../../shared/components/Modal'
import { useSettingsStore, selectSetting } from '../../shared/stores/settingsStore'
import { PRIORITY_LEVELS } from '../../shared/components/PriorityIndicator'

interface PrioritySettingsModalProps {
  open: boolean
  onClose: () => void
}

const TOGGLE_KEYS = [
  { key: 'priority_color_bar', label: 'Color Bar', description: '1.5px colored stripe on left edge' },
  { key: 'priority_badges', label: 'Badges', description: 'Icon + label chip by priority' },
  { key: 'priority_background_tint', label: 'Background Tint', description: '3% for High, 6% for Urgent' },
  { key: 'priority_font_weight', label: 'Font Weight', description: 'Heavier text for higher priority' },
  { key: 'priority_auto_sort', label: 'Auto-Sort', description: 'Sort by priority descending within sections' }
] as const

const PREVIEW_TASKS = [
  { priority: 4, title: 'Fix critical production bug' },
  { priority: 3, title: 'Review pull request' },
  { priority: 2, title: 'Update documentation' },
  { priority: 1, title: 'Clean up test files' },
  { priority: 0, title: 'Organize bookmarks' }
]

export function PrioritySettingsModal({ open, onClose }: PrioritySettingsModalProps): React.JSX.Element | null {
  const getSetting = useSettingsStore((s) => s.getSetting)
  const setSetting = useSettingsStore((s) => s.setSetting)

  // Local toggle state for immediate feedback
  const [localToggles, setLocalToggles] = useState<Record<string, boolean>>(() => {
    const result: Record<string, boolean> = {}
    for (const t of TOGGLE_KEYS) {
      result[t.key] = getSetting(t.key) === 'true'
    }
    return result
  })

  // Sync from store when modal opens
  const colorBar = useSettingsStore(selectSetting('priority_color_bar'))
  const badges = useSettingsStore(selectSetting('priority_badges'))
  const backgroundTint = useSettingsStore(selectSetting('priority_background_tint'))
  const fontWeight = useSettingsStore(selectSetting('priority_font_weight'))
  const autoSort = useSettingsStore(selectSetting('priority_auto_sort'))

  // Re-sync local state when store values change (modal reopen)
  useMemo(() => {
    setLocalToggles({
      priority_color_bar: colorBar === 'true',
      priority_badges: badges === 'true',
      priority_background_tint: backgroundTint === 'true',
      priority_font_weight: fontWeight === 'true',
      priority_auto_sort: autoSort === 'true'
    })
  }, [colorBar, badges, backgroundTint, fontWeight, autoSort])

  const handleToggle = useCallback(
    async (key: string) => {
      const newValue = !localToggles[key]
      setLocalToggles((prev) => ({ ...prev, [key]: newValue }))
      await setSetting(key, newValue ? 'true' : 'false')
    },
    [localToggles, setSetting]
  )

  const previewTasks = useMemo(() => {
    if (localToggles.priority_auto_sort) {
      return [...PREVIEW_TASKS].sort((a, b) => b.priority - a.priority)
    }
    return PREVIEW_TASKS
  }, [localToggles.priority_auto_sort])

  return (
    <Modal open={open} onClose={onClose} title="Priority Display">
      {/* Toggles */}
      <div className="space-y-3">
        {TOGGLE_KEYS.map((toggle) => (
          <ToggleRow
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={localToggles[toggle.key] ?? false}
            onChange={() => handleToggle(toggle.key)}
          />
        ))}
      </div>

      {/* Live Preview */}
      <div className="mt-8">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Preview
        </p>
        <div className="rounded-lg border border-border bg-background p-2">
          {previewTasks.map((task) => (
            <PreviewRow
              key={task.title}
              priority={task.priority}
              title={task.title}
              showColorBar={localToggles.priority_color_bar ?? false}
              showBadge={localToggles.priority_badges ?? false}
              showTint={localToggles.priority_background_tint ?? false}
              showFontWeight={localToggles.priority_font_weight ?? false}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  onChange: () => void
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-foreground/6">
      <div>
        <p className="text-sm font-light text-foreground">{label}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-foreground/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform motion-safe:duration-150 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

interface PreviewRowProps {
  priority: number
  title: string
  showColorBar: boolean
  showBadge: boolean
  showTint: boolean
  showFontWeight: boolean
}

function PreviewRow({
  priority,
  title,
  showColorBar,
  showBadge,
  showTint,
  showFontWeight
}: PreviewRowProps): React.JSX.Element {
  const level = PRIORITY_LEVELS[priority] ?? PRIORITY_LEVELS[0]
  const tintOpacity = priority === 4 ? 0.06 : priority === 3 ? 0.03 : 0
  const hasTint = showTint && priority >= 3
  const fontWeightClass = showFontWeight
    ? priority >= 4
      ? 'font-medium'
      : priority >= 3
        ? 'font-normal'
        : 'font-light'
    : 'font-light'

  const Icon = priority === 1 ? Minus : priority === 3 ? ArrowUp : priority === 4 ? AlertTriangle : null
  const showLabel = priority >= 3

  const tintStyle = hasTint
    ? { backgroundColor: `${level.color}${Math.round(tintOpacity * 255).toString(16).padStart(2, '0')}` }
    : undefined

  return (
    <div
      className="relative flex items-center gap-2 rounded px-3 py-1.5"
      style={tintStyle}
    >
      {showColorBar && priority > 0 && (
        <div
          className="absolute left-0 top-1 bottom-1 w-[1.5px] rounded-full"
          style={{ backgroundColor: level.color }}
        />
      )}
      <span className={`flex-1 truncate text-[15px] ${fontWeightClass} tracking-tight text-foreground`}>
        {title}
      </span>
      {showBadge && priority > 0 && priority !== 2 && Icon && (
        <span
          className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{ color: level.color, backgroundColor: `${level.color}15` }}
        >
          <Icon size={10} />
          {showLabel && <span>{level.label}</span>}
        </span>
      )}
    </div>
  )
}
