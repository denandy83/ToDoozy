import { useState } from 'react'
import { UpdateSettingsContent } from './UpdateSettingsContent'
import { WhatsNewSettingsContent, WhatsNewDot } from './WhatsNewSettingsContent'
import { HelpSettingsContent } from '../help/HelpSettingsContent'

type AboutSubtab = 'updates' | 'whatsnew' | 'help'

export function AboutSettingsContent(): React.JSX.Element {
  const [subtab, setSubtab] = useState<AboutSubtab>('updates')

  return (
    <div className="flex flex-col gap-6">
      <div className="flex rounded-lg border border-border overflow-hidden self-start">
        <button
          onClick={() => setSubtab('updates')}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            subtab === 'updates' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          Updates
        </button>
        <button
          onClick={() => setSubtab('whatsnew')}
          className={`relative px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            subtab === 'whatsnew' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          {"What's New"}
          {subtab !== 'whatsnew' && <WhatsNewDot />}
        </button>
        <button
          onClick={() => setSubtab('help')}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            subtab === 'help' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          Help
        </button>
      </div>

      {subtab === 'updates' && <UpdateSettingsContent />}
      {subtab === 'whatsnew' && <WhatsNewSettingsContent />}
      {subtab === 'help' && <HelpSettingsContent />}
    </div>
  )
}
