import { useMemo, useState } from 'react'
import { Copy, Trash2, Check } from 'lucide-react'
import { useLogStore, selectLogEntries, type LogEntry } from '../../shared/stores/logStore'

function formatEntry(e: LogEntry): string {
  const ctx = e.context ? ` (${e.context})` : ''
  return `[${e.timestamp}] ${e.level.toUpperCase()} ${e.category}: ${e.message}${ctx}`
}

function levelClass(level: LogEntry['level']): string {
  if (level === 'error') return 'text-danger'
  if (level === 'warn') return 'text-amber-500'
  return 'text-muted'
}

export function LogsSettingsContent(): React.JSX.Element {
  const entries = useLogStore(selectLogEntries)
  const clear = useLogStore((s) => s.clear)
  const [copied, setCopied] = useState(false)

  const fullText = useMemo(() => entries.map(formatEntry).join('\n'), [entries])

  const handleCopy = async (): Promise<void> => {
    if (!fullText) return
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Ignore — clipboard APIs are best-effort.
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-light uppercase tracking-[0.15em]">Logs</h2>
          <p className="mt-2 text-sm font-light text-muted">
            Live connection events (Realtime channels and online/offline). Cleared on app restart.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button
            onClick={clear}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-danger/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3 font-mono text-[11px] leading-relaxed">
        {entries.length === 0 ? (
          <p className="text-muted">No events yet.</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="flex-shrink-0 text-muted/60">{e.timestamp.slice(11, 19)}</span>
                <span className={`flex-shrink-0 w-12 uppercase ${levelClass(e.level)}`}>{e.level}</span>
                <span className="flex-shrink-0 w-20 text-muted/80">{e.category}</span>
                <span className="flex-1 break-words">
                  {e.message}
                  {e.context && <span className="text-muted/60"> — {e.context}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
