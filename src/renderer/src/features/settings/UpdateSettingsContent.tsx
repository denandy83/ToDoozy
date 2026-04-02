import { useCallback } from 'react'
import { RefreshCw, CheckCircle, Download, AlertCircle } from 'lucide-react'
import { useUpdateStore } from '../../shared/stores/updateStore'

export function UpdateSettingsContent(): React.JSX.Element {
  const status = useUpdateStore((s) => s.status)
  const appVersion = useUpdateStore((s) => s.appVersion)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const openDialog = useUpdateStore((s) => s.openDialog)

  const handleCheck = useCallback(() => {
    checkForUpdates()
  }, [checkForUpdates])

  const handleViewUpdate = useCallback(() => {
    openDialog()
  }, [openDialog])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Updates
      </p>

      {/* Current version */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Current version</p>
          <p className="text-[10px] text-muted">ToDoozy v{appVersion}</p>
        </div>
      </div>

      {/* Check for updates */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Software updates</p>
          <p className="text-[10px] text-muted">
            <StatusMessage status={status} />
          </p>
        </div>
        <div>
          {status.state === 'available' || status.state === 'downloaded' ? (
            <button
              onClick={handleViewUpdate}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
            >
              <Download size={12} />
              View Update
            </button>
          ) : (
            <button
              onClick={handleCheck}
              disabled={status.state === 'checking' || status.state === 'downloading'}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6 disabled:opacity-50"
            >
              {status.state === 'checking' ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  Checking...
                </>
              ) : (
                'Check for Updates'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusMessage({ status }: { status: import('../../shared/stores/updateStore').UpdateStatus }): React.JSX.Element {
  switch (status.state) {
    case 'idle':
      return <span>Checks automatically every 4 hours</span>
    case 'checking':
      return <span>Checking for updates...</span>
    case 'available':
      return (
        <span className="flex items-center gap-1 text-accent">
          <Download size={10} />
          Version {status.version} available
        </span>
      )
    case 'not-available':
      return (
        <span className="flex items-center gap-1 text-green-500">
          <CheckCircle size={10} />
          {"You're up to date!"}
        </span>
      )
    case 'downloading':
      return <span>Downloading update... {status.percent}%</span>
    case 'downloaded':
      return (
        <span className="flex items-center gap-1 text-green-500">
          <CheckCircle size={10} />
          Update v{status.version} ready to install
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-danger">
          <AlertCircle size={10} />
          Update check failed
        </span>
      )
  }
}
