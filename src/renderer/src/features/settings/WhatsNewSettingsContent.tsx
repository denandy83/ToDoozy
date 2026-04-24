import { useState, useEffect, useMemo } from 'react'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import { logEvent } from '../../shared/stores/logStore'

function parseChangelog(content: string): string {
  const lines = content.split('\n')
  const startIdx = lines.findIndex((l) => l.startsWith('## '))
  return startIdx >= 0 ? lines.slice(startIdx).join('\n') : content
}

export interface ChangelogState {
  content: string
  syncError: string | null
}

export function useChangelog(): ChangelogState {
  const [state, setState] = useState<ChangelogState>({ content: '', syncError: null })
  useEffect(() => {
    // Show cache immediately if any
    window.api.app.getChangelog().then((content) => {
      setState((prev) => ({ ...prev, content: parseChangelog(content) }))
    })
    // Then run a fresh sync and log the outcome so failures are visible
    window.api.releaseNotes
      .sync()
      .then(async (result) => {
        if (result.ok) {
          logEvent(
            'info',
            'sync',
            `Release notes synced (${result.count} versions)`,
            `cached=${result.cached}`
          )
        } else {
          logEvent(
            'error',
            'sync',
            `Release notes sync failed: ${result.error ?? 'unknown'}`,
            `cached=${result.cached}`
          )
        }
        const content = await window.api.app.getChangelog()
        setState({
          content: parseChangelog(content),
          syncError: result.ok ? null : result.error ?? 'unknown error'
        })
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        logEvent('error', 'sync', `Release notes IPC failed: ${msg}`)
        setState((prev) => ({ ...prev, syncError: msg }))
      })
  }, [])
  return state
}

export function WhatsNewDot(): React.JSX.Element | null {
  const { content: whatsNew } = useChangelog()
  const lastSeen = useSetting('whats_new_seen') ?? ''

  if (!whatsNew) return null
  const firstHeader = whatsNew.split('\n').find((l) => l.startsWith('## ')) ?? ''
  if (lastSeen === firstHeader) return null

  return (
    <span className="absolute right-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-accent" />
  )
}

export function WhatsNewSettingsContent(): React.JSX.Element {
  const { content: whatsNew, syncError } = useChangelog()
  const { setSetting } = useSettingsStore()

  useEffect(() => {
    if (whatsNew) {
      const firstLine = whatsNew.split('\n').find((l) => l.startsWith('## ')) ?? ''
      setSetting('whats_new_seen', firstLine)
    }
  }, [whatsNew, setSetting])

  const sections = useMemo(() => {
    if (!whatsNew) return []
    const result: Array<{ version: string; items: Array<{ title: string; desc: string }> }> = []
    let currentSection: (typeof result)[0] | null = null

    for (const line of whatsNew.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === '---') continue

      if (trimmed.startsWith('## ')) {
        if (currentSection) result.push(currentSection)
        currentSection = { version: trimmed.slice(3).trim(), items: [] }
        continue
      }

      if (trimmed.startsWith('- ') && currentSection) {
        const content = trimmed.slice(2)
        const boldMatch = content.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/)
        if (boldMatch) {
          currentSection.items.push({ title: boldMatch[1], desc: boldMatch[2] })
        } else {
          currentSection.items.push({ title: content.replace(/\*\*/g, ''), desc: '' })
        }
      }
    }

    if (currentSection) result.push(currentSection)
    return result
  }, [whatsNew])

  return (
    <div className="flex flex-col gap-6">
      {sections.length > 0 ? (
        sections.map((section) => (
          <div key={section.version} className="flex flex-col gap-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent">{section.version}</p>
            {section.items.map((item, j) => (
              <div key={j} className="flex flex-col gap-0.5 py-1.5 border-b border-border/30 last:border-0">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                {item.desc && <p className="text-sm font-light text-muted">{item.desc}</p>}
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-light text-muted">
            {syncError ? 'Unable to load release notes.' : 'No updates yet.'}
          </p>
          {syncError && (
            <p className="text-[11px] font-light text-muted/70">
              {syncError} — see Settings &gt; Logs for details.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
