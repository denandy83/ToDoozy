import { useState, useCallback } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { useAuthStore } from '../../shared/stores/authStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'

export function TelegramSettingsContent(): React.JSX.Element {
  const currentUser = useAuthStore((s) => s.currentUser)
  const projects = useProjectStore((s) => s.projects)
  const { setSetting } = useSettingsStore()
  const defaultProject = useSetting('telegram_default_project')
  const [copied, setCopied] = useState<string | null>(null)

  const sortedProjects = Object.values(projects).sort((a, b) => a.sidebar_order - b.sidebar_order)

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  const handleSetDefault = useCallback((projectName: string) => {
    if (currentUser) {
      setSetting('telegram_default_project', projectName)
    }
  }, [currentUser, setSetting])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-4">Telegram Bot</h3>
        <p className="text-sm font-light text-foreground/60 mb-4">
          The ToDoozy Telegram bot lets you create and manage tasks directly from Telegram.
        </p>
      </div>

      {/* Default Project */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">Default Project</h4>
        <p className="text-xs font-light text-foreground/50 mb-2">
          Tasks created without a /project tag will go to this project.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {sortedProjects.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSetDefault(p.name)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                defaultProject === p.name
                  ? 'bg-accent/12 text-accent border border-accent/15'
                  : 'text-muted hover:bg-foreground/6 border border-transparent'
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Setup Info */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">Setup</h4>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-3 py-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Your Telegram ID</span>
              <p className="text-xs font-light text-foreground/50 mt-0.5">
                Message <button onClick={() => window.open('https://t.me/userinfobot', '_blank')} className="text-accent hover:underline">@userinfobot</button> on Telegram to get your ID
              </p>
            </div>
            <button
              onClick={() => window.open('https://t.me/userinfobot', '_blank')}
              className="rounded p-1.5 text-muted hover:bg-foreground/6 transition-colors"
              title="Open @userinfobot"
            >
              <ExternalLink size={14} />
            </button>
          </div>

          {currentUser && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-3 py-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Supabase User ID</span>
                <p className="text-xs font-mono text-foreground/60 mt-0.5 select-text">{currentUser.id}</p>
              </div>
              <button
                onClick={() => handleCopy(currentUser.id, 'uid')}
                className="rounded p-1.5 text-muted hover:bg-foreground/6 transition-colors"
                title="Copy"
              >
                {copied === 'uid' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Commands Reference */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">Commands</h4>
        <p className="text-xs font-light text-foreground/50 mb-2">
          Use <code className="text-accent">/</code> or <code className="text-accent">.</code> prefix. Slash checks project names first.
        </p>
        <div className="flex flex-col gap-1">
          {[
            ['.help', 'Show all commands'],
            ['.list', 'Show all projects'],
            ['.default', 'Change default project'],
            ['.settings', 'Bot settings'],
            ['.done', 'Show recent tasks to complete'],
            ['.done <text>', 'Fuzzy-match and complete a task'],
            ['.myday', 'Show My Day tasks'],
            ['/projectname', 'List tasks in a project'],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="flex items-baseline gap-3 py-0.5">
              <code className="text-[11px] font-mono text-accent whitespace-nowrap">{cmd}</code>
              <span className="text-xs font-light text-foreground/50">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Smart Syntax */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">Smart Syntax</h4>
        <p className="text-xs font-light text-foreground/50 mb-2">
          Add these inline when creating a task:
        </p>
        <div className="flex flex-col gap-1">
          {[
            ['@label', 'Assign label (auto-created if new)'],
            ['/project', 'Assign to project (fuzzy-matched)'],
            ['d:today', 'Due date (today, tomorrow, monday, 2026-04-10)'],
            ['p:high', 'Priority (low, normal, high, urgent)'],
            ['r:url', 'Reference URL'],
            ['s:status', 'Set status'],
          ].map(([syntax, desc]) => (
            <div key={syntax} className="flex items-baseline gap-3 py-0.5">
              <code className="text-[11px] font-mono text-accent whitespace-nowrap">{syntax}</code>
              <span className="text-xs font-light text-foreground/50">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs font-light text-foreground/40 mt-2 italic">
          Example: buy milk /groceries d:tomorrow @fast p:high
        </p>
      </div>
    </div>
  )
}
