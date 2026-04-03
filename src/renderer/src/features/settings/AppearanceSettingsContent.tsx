import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ThemeSettingsContent, type ThemeSettingsHandle } from './ThemeSettingsContent'
import { PrioritySettingsContent } from './PrioritySettingsContent'

type AppearanceSubtab = 'theme' | 'priority'

export interface AppearanceSettingsHandle {
  themeRef: React.RefObject<ThemeSettingsHandle | null>
  themeDirty: boolean
}

interface AppearanceSettingsContentProps {
  onDirtyChange?: (dirty: boolean) => void
  onBlockingChange?: (blocked: boolean) => void
  onThemeSubtabLeave?: (onDone: () => void) => void
}

export const AppearanceSettingsContent = forwardRef<AppearanceSettingsHandle, AppearanceSettingsContentProps>(
  function AppearanceSettingsContent({ onDirtyChange, onBlockingChange, onThemeSubtabLeave }, ref) {
    const [subtab, setSubtab] = useState<AppearanceSubtab>('theme')
    const themeRef = useRef<ThemeSettingsHandle>(null)
    const [themeDirty, setThemeDirty] = useState(false)

    useImperativeHandle(ref, () => ({ themeRef, themeDirty }), [themeDirty])

    const handleDirtyChange = useCallback((dirty: boolean) => {
      setThemeDirty(dirty)
      onDirtyChange?.(dirty)
    }, [onDirtyChange])

    const handleSubtabChange = useCallback((tab: AppearanceSubtab) => {
      if (subtab === 'theme' && tab !== 'theme') {
        if (themeDirty && onThemeSubtabLeave) {
          onThemeSubtabLeave(() => setSubtab(tab))
          return
        }
        themeRef.current?.revert()
      }
      setSubtab(tab)
    }, [subtab, themeDirty, onThemeSubtabLeave])

    return (
      <div className="flex flex-col gap-6">
        <div className="flex rounded-lg border border-border overflow-hidden self-start">
          <button
            onClick={() => handleSubtabChange('theme')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              subtab === 'theme' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Theme
          </button>
          <button
            onClick={() => handleSubtabChange('priority')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              subtab === 'priority' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Priority Display
          </button>
        </div>

        {subtab === 'theme' && (
          <ThemeSettingsContent ref={themeRef} onDirtyChange={handleDirtyChange} onBlockingChange={onBlockingChange} />
        )}
        {subtab === 'priority' && (
          <PrioritySettingsContent />
        )}
      </div>
    )
  }
)
