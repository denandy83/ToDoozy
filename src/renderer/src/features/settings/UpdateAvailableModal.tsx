import { useMemo, useCallback } from 'react'
import { Download, X } from 'lucide-react'
import { useUpdateStore } from '../../shared/stores/updateStore'

export function UpdateAvailableModal(): React.JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const downloadUpdate = useUpdateStore((s) => s.downloadUpdate)
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate)

  const handleDownload = useCallback(() => {
    downloadUpdate()
  }, [downloadUpdate])

  const handleDismiss = useCallback(() => {
    if (status.state === 'available') {
      dismissUpdate(status.version)
    }
  }, [status, dismissUpdate])

  if (status.state !== 'available') return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="relative mx-4 flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute right-3 top-3 rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          <X size={14} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12">
            <Download size={20} className="text-accent" />
          </div>
          <div>
            <p className="text-[15px] font-light tracking-tight text-foreground">
              Version {status.version} available
            </p>
            <p className="text-[10px] text-muted">A new update is ready to download</p>
          </div>
        </div>

        {/* Release notes */}
        <ReleaseNotes notes={status.releaseNotes} />

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleDismiss}
            className="rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
          >
            Not Now
          </button>
          <button
            onClick={handleDownload}
            className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90"
          >
            Download & Install
          </button>
        </div>
      </div>
    </div>
  )
}

function ReleaseNotes({ notes }: { notes: string }): React.JSX.Element | null {
  const parsed = useMemo(() => {
    if (!notes) return []
    return notes
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => {
        const content = line.slice(2)
        const boldMatch = content.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/)
        if (boldMatch) return { title: boldMatch[1], desc: boldMatch[2] }
        return { title: content.replace(/\*\*/g, ''), desc: '' }
      })
  }, [notes])

  if (parsed.length === 0) return null

  return (
    <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-background p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        {"What's New"}
      </p>
      {parsed.map((note, i) => (
        <div key={i} className="py-1.5 border-b border-border/30 last:border-0">
          <p className="text-[13px] font-medium text-foreground">{note.title}</p>
          {note.desc && <p className="text-[12px] font-light text-muted mt-0.5">{note.desc}</p>}
        </div>
      ))}
    </div>
  )
}
