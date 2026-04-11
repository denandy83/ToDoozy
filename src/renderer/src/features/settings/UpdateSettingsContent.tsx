import { useCallback, useMemo } from 'react'
import { RefreshCw, CheckCircle, Download, AlertCircle } from 'lucide-react'
import { useUpdateStore, type UpdateStatus } from '../../shared/stores/updateStore'

export function UpdateSettingsContent(): React.JSX.Element {
  const status = useUpdateStore((s) => s.status)
  const appVersion = useUpdateStore((s) => s.appVersion)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const downloadUpdate = useUpdateStore((s) => s.downloadUpdate)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate)

  const handleCheck = useCallback(() => {
    checkForUpdates()
  }, [checkForUpdates])

  const handleDownload = useCallback(() => {
    downloadUpdate()
  }, [downloadUpdate])

  const handleInstall = useCallback(() => {
    installUpdate()
  }, [installUpdate])

  const handleDismiss = useCallback(() => {
    if (status.state === 'available') {
      dismissUpdate(status.version)
    }
  }, [status, dismissUpdate])

  return (
    <div className="flex flex-col gap-6">
      {/* Current version */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Current version</p>
          <p className="text-[10px] text-muted">ToDoozy v{appVersion}</p>
        </div>
      </div>

      {/* TEMP: test quit button */}
      <button
        onClick={() => window.electron.ipcRenderer.invoke('updater:test-quit')}
        className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-danger"
      >
        Test Quit (remove me)
      </button>

      {/* Check for updates */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Software updates</p>
          <p className="text-[10px] text-muted">
            <StatusMessage status={status} />
          </p>
        </div>
        <div>
          {status.state === 'idle' || status.state === 'not-available' || status.state === 'error' ? (
            <button
              onClick={handleCheck}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6"
            >
              {status.state === 'error' ? 'Retry' : 'Check for Updates'}
            </button>
          ) : status.state === 'checking' ? (
            <button
              disabled
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-foreground opacity-50"
            >
              <RefreshCw size={12} className="animate-spin" />
              Checking...
            </button>
          ) : null}
        </div>
      </div>

      {/* Download progress bar */}
      {status.state === 'downloading' && (
        <div className="flex flex-col gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${status.percent}%` }}
            />
          </div>
          <p className="text-[10px] text-muted">
            {status.percent}% — {formatSpeed(status.bytesPerSecond)}
          </p>
        </div>
      )}

      {/* Update available — inline release notes + actions */}
      {status.state === 'available' && (
        <UpdateAvailableSection
          currentVersion={appVersion}
          newVersion={status.version}
          releaseNotes={status.releaseNotes}
          onDownload={handleDownload}
          onDismiss={handleDismiss}
        />
      )}

      {/* Downloaded — restart prompt */}
      {status.state === 'downloaded' && (
        <div className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Update v{status.version} ready</p>
              <p className="text-[10px] text-muted">Restart the app to apply the update.</p>
            </div>
          </div>
          <button
            onClick={handleInstall}
            className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
          >
            Restart Now
          </button>
        </div>
      )}
    </div>
  )
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond > 1_000_000) return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`
  if (bytesPerSecond > 1_000) return `${(bytesPerSecond / 1_000).toFixed(0)} KB/s`
  return `${bytesPerSecond} B/s`
}

interface UpdateAvailableSectionProps {
  currentVersion: string
  newVersion: string
  releaseNotes: string
  onDownload: () => void
  onDismiss: () => void
}

function UpdateAvailableSection({
  currentVersion,
  newVersion,
  releaseNotes,
  onDownload,
  onDismiss
}: UpdateAvailableSectionProps): React.JSX.Element {
  const parsedNotes = useMemo(() => {
    if (!releaseNotes) return []
    return releaseNotes
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => {
        const content = line.slice(2)
        const boldMatch = content.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/)
        if (boldMatch) return { title: boldMatch[1], desc: boldMatch[2] }
        return { title: content.replace(/\*\*/g, ''), desc: '' }
      })
  }, [releaseNotes])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="flex items-center gap-2">
        <Download size={16} className="text-accent flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Version {newVersion} available</p>
          <p className="text-[10px] text-muted">{currentVersion} → {newVersion}</p>
        </div>
      </div>

      {parsedNotes.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            Release Notes
          </p>
          {parsedNotes.map((note, i) => (
            <div key={i} className="py-1 border-b border-border/30 last:border-0">
              <p className="text-sm font-medium text-foreground">{note.title}</p>
              {note.desc && <p className="text-sm font-light text-muted">{note.desc}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
        >
          Not Now
        </button>
        <button
          onClick={onDownload}
          className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
        >
          Download & Install
        </button>
      </div>
    </div>
  )
}

function StatusMessage({ status }: { status: UpdateStatus }): React.JSX.Element {
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
      return <span>Downloading update...</span>
    case 'downloaded':
      return (
        <span className="flex items-center gap-1 text-green-500">
          <CheckCircle size={10} />
          Update v{status.version} ready — restart to apply
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
