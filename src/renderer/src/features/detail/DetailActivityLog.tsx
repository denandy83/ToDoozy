import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ActivityLogEntry } from '../../../../shared/types'

interface DetailActivityLogProps {
  taskId: string
}

export function DetailActivityLog({ taskId }: DetailActivityLogProps): React.JSX.Element {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadEntries = async (): Promise<void> => {
      setLoading(true)
      try {
        const result = await window.api.activityLog.findByTaskId(taskId)
        if (!cancelled) {
          setEntries(result)
        }
      } catch (err) {
        console.error('Failed to load activity log:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadEntries()
    return () => {
      cancelled = true
    }
  }, [taskId])

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const ChevIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={toggle}
        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted transition-colors hover:text-foreground"
        aria-expanded={expanded}
      >
        <ChevIcon size={12} />
        Activity ({entries.length})
      </button>

      {expanded && (
        <div className="ml-3 border-l border-border pl-3">
          {loading && <p className="text-[10px] text-muted">Loading...</p>}
          {!loading && entries.length === 0 && (
            <p className="text-[10px] text-muted/60">No activity recorded</p>
          )}
          {entries.map((entry) => (
            <ActivityEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

interface ActivityEntryProps {
  entry: ActivityLogEntry
}

function ActivityEntry({ entry }: ActivityEntryProps): React.JSX.Element {
  const date = new Date(entry.created_at)
  const timeStr = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div className="flex flex-col py-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {entry.action}
        </span>
        <span className="text-[10px] text-muted/60">{timeStr}</span>
      </div>
      {(entry.old_value || entry.new_value) && (
        <div className="mt-0.5 text-[10px] text-muted/80">
          {entry.old_value && (
            <span className="line-through">{entry.old_value}</span>
          )}
          {entry.old_value && entry.new_value && <span className="mx-1">→</span>}
          {entry.new_value && <span>{entry.new_value}</span>}
        </div>
      )}
    </div>
  )
}
