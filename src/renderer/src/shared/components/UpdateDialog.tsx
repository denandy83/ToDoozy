import { useCallback, useMemo } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { Modal } from './Modal'
import { useUpdateStore, type UpdateStatus } from '../stores/updateStore'

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond > 1_000_000) {
    return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`
  }
  if (bytesPerSecond > 1_000) {
    return `${(bytesPerSecond / 1_000).toFixed(0)} KB/s`
  }
  return `${bytesPerSecond} B/s`
}

export function UpdateDialog(): React.JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const dialogOpen = useUpdateStore((s) => s.dialogOpen)
  const appVersion = useUpdateStore((s) => s.appVersion)
  const closeDialog = useUpdateStore((s) => s.closeDialog)
  const downloadUpdate = useUpdateStore((s) => s.downloadUpdate)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)

  const handleDismiss = useCallback(() => {
    if (status.state === 'available') {
      dismissUpdate(status.version)
    } else {
      closeDialog()
    }
  }, [status, dismissUpdate, closeDialog])

  const handleInstall = useCallback(() => {
    installUpdate()
  }, [installUpdate])

  const handleDownload = useCallback(() => {
    downloadUpdate()
  }, [downloadUpdate])

  const handleRetry = useCallback(() => {
    checkForUpdates()
  }, [checkForUpdates])

  if (!dialogOpen) return null

  // Only show dialog for actionable states
  const showStates: UpdateStatus['state'][] = ['available', 'downloading', 'downloaded', 'error']
  if (!showStates.includes(status.state)) return null

  return (
    <Modal open={dialogOpen} onClose={handleDismiss} title="Software Update">
      <div className="flex flex-col gap-4">
        {status.state === 'available' && (
          <AvailableContent
            currentVersion={appVersion}
            newVersion={status.version}
            releaseNotes={status.releaseNotes}
            onDownload={handleDownload}
            onDismiss={handleDismiss}
          />
        )}
        {status.state === 'downloading' && (
          <DownloadingContent percent={status.percent} bytesPerSecond={status.bytesPerSecond} />
        )}
        {status.state === 'downloaded' && (
          <DownloadedContent version={status.version} onInstall={handleInstall} />
        )}
        {status.state === 'error' && (
          <ErrorContent message={status.message} onRetry={handleRetry} onDismiss={handleDismiss} />
        )}
      </div>
    </Modal>
  )
}

interface AvailableContentProps {
  currentVersion: string
  newVersion: string
  releaseNotes: string
  onDownload: () => void
  onDismiss: () => void
}

function AvailableContent({
  currentVersion,
  newVersion,
  releaseNotes,
  onDownload,
  onDismiss
}: AvailableContentProps): React.JSX.Element {
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
    <>
      <div className="flex items-center gap-3">
        <Download size={20} className="text-accent flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">
            A new version of ToDoozy is available
          </p>
          <p className="text-[10px] text-muted">
            {currentVersion} → {newVersion}
          </p>
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
          className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
        >
          Not Now
        </button>
        <button
          onClick={onDownload}
          className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
        >
          Install & Restart
        </button>
      </div>
    </>
  )
}

interface DownloadingContentProps {
  percent: number
  bytesPerSecond: number
}

function DownloadingContent({ percent, bytesPerSecond }: DownloadingContentProps): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-3">
        <RefreshCw size={20} className="text-accent flex-shrink-0 animate-spin" />
        <div>
          <p className="text-sm font-medium text-foreground">Downloading update...</p>
          <p className="text-[10px] text-muted">{percent}% — {formatSpeed(bytesPerSecond)}</p>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </>
  )
}

interface DownloadedContentProps {
  version: string
  onInstall: () => void
}

function DownloadedContent({ version, onInstall }: DownloadedContentProps): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-3">
        <CheckCircle size={20} className="text-green-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Update v{version} is ready to install
          </p>
          <p className="text-[10px] text-muted">
            The app will restart to complete the update.
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onInstall}
          className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
        >
          Restart Now
        </button>
      </div>
    </>
  )
}

interface ErrorContentProps {
  message: string
  onRetry: () => void
  onDismiss: () => void
}

function ErrorContent({ message, onRetry, onDismiss }: ErrorContentProps): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-3">
        <AlertCircle size={20} className="text-danger flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Update failed</p>
          <p className="text-[10px] text-muted">{message}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onDismiss}
          className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
        >
          Dismiss
        </button>
        <button
          onClick={onRetry}
          className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
        >
          Retry
        </button>
      </div>
    </>
  )
}
