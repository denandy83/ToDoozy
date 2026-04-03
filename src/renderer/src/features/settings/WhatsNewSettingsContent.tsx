import { useState, useEffect, useMemo } from 'react'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'

function parseChangelog(content: string): string {
  const lines = content.split('\n')
  const startIdx = lines.findIndex((l) => l.startsWith('## '))
  return startIdx >= 0 ? lines.slice(startIdx).join('\n') : content
}

export function useChangelog(): string {
  const [changelog, setChangelog] = useState('')
  useEffect(() => {
    window.api.app.getChangelog().then((content) => {
      setChangelog(parseChangelog(content))
    })
    window.api.releaseNotes.sync().then(() => {
      window.api.app.getChangelog().then((content) => {
        setChangelog(parseChangelog(content))
      })
    }).catch(() => {})
  }, [])
  return changelog
}

export function WhatsNewDot(): React.JSX.Element | null {
  const whatsNew = useChangelog()
  const lastSeen = useSetting('whats_new_seen') ?? ''

  if (!whatsNew) return null
  const firstHeader = whatsNew.split('\n').find((l) => l.startsWith('## ')) ?? ''
  if (lastSeen === firstHeader) return null

  return (
    <span className="absolute right-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-accent" />
  )
}

export function WhatsNewSettingsContent(): React.JSX.Element {
  const whatsNew = useChangelog()
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
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{"What's New"}</p>

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
        <p className="text-sm font-light text-muted">No updates yet.</p>
      )}
    </div>
  )
}
