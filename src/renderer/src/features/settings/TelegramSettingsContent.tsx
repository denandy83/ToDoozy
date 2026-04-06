import { useState, useCallback, useEffect } from 'react'
import { Check, ExternalLink, X } from 'lucide-react'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'

export function TelegramSettingsContent(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const { setSetting, hydrateSettings } = useSettingsStore()
  const telegramId = useSetting('telegram_user_id')
  const defaultProject = useSetting('telegram_default_project')
  const [idInput, setIdInput] = useState('')
  const [saved, setSaved] = useState(false)

  const sortedProjects = Object.values(projects).sort((a, b) => a.sidebar_order - b.sidebar_order)
  const isConnected = !!telegramId

  // Refresh settings on mount to pick up changes made via Telegram bot
  useEffect(() => {
    hydrateSettings()
  }, [hydrateSettings])

  const handleSaveId = useCallback(() => {
    const trimmed = idInput.trim()
    if (!trimmed) return
    setSetting('telegram_user_id', trimmed)
    setSetting('telegram_allowed_ids', trimmed)
    setIdInput('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [idInput, setSetting])

  const handleRemoveId = useCallback(() => {
    setSetting('telegram_user_id', null)
    setSetting('telegram_allowed_ids', null)
  }, [setSetting])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-4">Telegram Bot</h3>
        <p className="text-sm font-light text-foreground/60">
          Create and manage tasks directly from Telegram.
        </p>
      </div>

      {/* Telegram User ID */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">Your Telegram ID</h4>
        {!isConnected ? (
          <>
            <p className="text-xs font-light text-foreground/50 mb-2">
              Message{' '}
              <button onClick={() => window.open('https://t.me/userinfobot', '_blank')} className="text-accent hover:underline inline-flex items-center gap-0.5">
                @userinfobot <ExternalLink size={10} />
              </button>
              {' '}on Telegram to get your ID, then paste it here.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={idInput}
                onChange={(e) => setIdInput(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveId()}
                placeholder="e.g. 674103800"
                className="flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted/40 focus:border-accent focus:outline-none"
              />
              <button
                onClick={handleSaveId}
                disabled={!idInput.trim()}
                className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 disabled:opacity-30"
              >
                {saved ? <Check size={14} className="text-success" /> : 'Connect'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-3 py-1 text-[11px] font-mono text-success">
              {telegramId}
            </div>
            <button
              onClick={handleRemoveId}
              className="rounded-full p-1 text-muted hover:bg-danger/10 hover:text-danger transition-colors"
              title="Disconnect"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Everything below only shows when connected */}
      {isConnected && (
        <>
          {/* Default Project */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">Default Project</h4>
            <p className="text-xs font-light text-foreground/50 mb-2">
              Tasks created without a /project tag go here.
            </p>
            <select
              value={defaultProject ?? ''}
              onChange={(e) => setSetting('telegram_default_project', e.target.value || null)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">Auto (first owned project)</option>
              {sortedProjects.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Commands Reference */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">Commands</h4>
            <p className="text-xs font-light text-foreground/50 mb-2">
              Use <code className="text-accent">.</code> prefix for commands, <code className="text-accent">/</code> checks project names first.
            </p>
            <div className="flex flex-col gap-0.5">
              {[
                ['.help', 'Show all commands'],
                ['.list', 'Show all projects'],
                ['.default', 'Change default project'],
                ['.done', 'Recent tasks to complete'],
                ['.done <text>', 'Fuzzy-match and complete'],
                ['.myday', 'My Day tasks'],
                ['/projectname', 'List project tasks'],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="flex items-baseline gap-3 py-0.5">
                  <code className="text-[11px] font-mono text-accent whitespace-nowrap w-24">{cmd}</code>
                  <span className="text-xs font-light text-foreground/50">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Smart Syntax */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">Smart Syntax</h4>
            <p className="text-xs font-light text-foreground/50 mb-2">
              Add inline when creating a task:
            </p>
            <div className="flex flex-col gap-0.5">
              {[
                ['@label', 'Assign label (auto-created)'],
                ['/project', 'Assign to project'],
                ['d:today', 'Due date'],
                ['p:high', 'Priority'],
                ['r:url', 'Reference URL'],
                ['s:status', 'Set status'],
              ].map(([syntax, desc]) => (
                <div key={syntax} className="flex items-baseline gap-3 py-0.5">
                  <code className="text-[11px] font-mono text-accent whitespace-nowrap w-24">{syntax}</code>
                  <span className="text-xs font-light text-foreground/50">{desc}</span>
                </div>
              ))}
            </div>
            <p className="text-xs font-light text-foreground/40 mt-2 italic">
              Example: buy milk /groceries d:tomorrow @fast p:high
            </p>
          </div>
        </>
      )}
    </div>
  )
}
