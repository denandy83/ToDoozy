import { useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { useUpdateStore } from '../../shared/stores/updateStore'

export function UpdateReadyBanner(): React.JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const installUpdate = useUpdateStore((s) => s.installUpdate)

  const handleRestart = useCallback(() => {
    installUpdate()
  }, [installUpdate])

  if (status.state !== 'downloaded') return null

  return (
    <div className="flex items-center justify-between gap-3 border-b border-accent/20 bg-accent/8 px-4 py-2">
      <div className="flex items-center gap-2">
        <RotateCcw size={14} className="text-accent" />
        <span className="text-[12px] font-light text-foreground">
          Version {status.version} has been downloaded and is ready to install.
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={handleRestart}
          className="rounded-md bg-accent px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
        >
          Restart
        </button>
      </div>
    </div>
  )
}
