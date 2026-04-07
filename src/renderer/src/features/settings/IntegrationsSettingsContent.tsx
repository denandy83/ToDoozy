import { useState, useCallback, useEffect, useRef } from 'react'
import { Check, ExternalLink, X, Copy, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useAuthStore } from '../../shared/stores/authStore'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'
import { useToast } from '../../shared/components/Toast'
import { getSupabase } from '../../lib/supabase'
import { shouldForceDelete } from '../../shared/utils/shiftDelete'

const SUPABASE_URL = 'https://znmgsyjkaftbnhtlcxrm.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubWdzeWprYWZ0Ym5odGxjeHJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjA2MTUsImV4cCI6MjA4OTM5NjYxNX0.FzDK5NRvauwrwgM7oaMqZqosYaY2nSeBlFsSQfzoDM0'

export function IntegrationsSettingsContent(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const { setSetting, hydrateSettings } = useSettingsStore()
  const telegramId = useSetting('telegram_user_id')
  const defaultProject = useSetting('telegram_default_project')
  const apiKey = useSetting('api_key')
  const [idInput, setIdInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const sortedProjects = Object.values(projects).sort((a, b) => a.sidebar_order - b.sidebar_order)
  const isTelegramConnected = !!telegramId
  const { addToast } = useToast()
  const undoRef = useRef<string | null>(null)

  const userId = useAuthStore((s) => s.currentUser?.id)

  // Pull integration settings from Supabase on mount
  useEffect(() => {
    if (!userId) return
    const pull = async (): Promise<void> => {
      try {
        const supabase = await getSupabase()
        const { data } = await supabase
          .from('user_settings')
          .select('key, value')
          .eq('user_id', userId)
          .in('key', ['telegram_default_project', 'telegram_user_id', 'telegram_allowed_ids', 'api_key'])
        if (data) {
          for (const row of data) {
            if (row.value) await window.api.settings.set(userId, row.key, row.value)
          }
          hydrateSettings()
        }
      } catch { /* offline */ }
    }
    pull()
  }, [userId, hydrateSettings])

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  // ── Telegram handlers ──
  const handleSaveTelegramId = useCallback(() => {
    const trimmed = idInput.trim()
    if (!trimmed) return
    setSetting('telegram_user_id', trimmed)
    setSetting('telegram_allowed_ids', trimmed)
    setIdInput('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [idInput, setSetting])

  const doRemoveTelegramId = useCallback(async () => {
    setSetting('telegram_user_id', null)
    setSetting('telegram_allowed_ids', null)
    try {
      const supabase = await getSupabase()
      if (userId) {
        await supabase.from('user_settings').delete().eq('user_id', userId).eq('key', 'telegram_user_id')
        await supabase.from('user_settings').delete().eq('user_id', userId).eq('key', 'telegram_allowed_ids')
      }
    } catch { /* offline */ }
  }, [setSetting, userId])

  const handleRemoveTelegramId = useCallback((e: React.MouseEvent) => {
    if (shouldForceDelete(e)) { doRemoveTelegramId(); return }
    const savedId = telegramId
    undoRef.current = savedId
    doRemoveTelegramId()
    addToast({
      message: 'Telegram ID removed',
      variant: 'danger',
      action: {
        label: 'Undo',
        onClick: () => {
          if (undoRef.current) {
            setSetting('telegram_user_id', undoRef.current)
            setSetting('telegram_allowed_ids', undoRef.current)
            getSupabase().then(async (supabase) => {
              if (userId && undoRef.current) {
                await supabase.from('user_settings').upsert({ id: `${userId}:telegram_user_id`, user_id: userId, key: 'telegram_user_id', value: undoRef.current, updated_at: new Date().toISOString() })
                await supabase.from('user_settings').upsert({ id: `${userId}:telegram_allowed_ids`, user_id: userId, key: 'telegram_allowed_ids', value: undoRef.current, updated_at: new Date().toISOString() })
              }
            }).catch(() => {})
            undoRef.current = null
          }
        }
      }
    })
  }, [doRemoveTelegramId, telegramId, addToast, setSetting, userId])

  // ── API Key handlers ──
  const handleGenerateApiKey = useCallback(async () => {
    const key = crypto.randomUUID()
    setSetting('api_key', key)
    // Also push to Supabase
    try {
      const supabase = await getSupabase()
      if (userId) {
        await supabase.from('user_settings').upsert({
          id: `${userId}:api_key`, user_id: userId, key: 'api_key', value: key, updated_at: new Date().toISOString()
        })
      }
    } catch { /* offline */ }
  }, [setSetting, userId])

  const handleRevokeApiKey = useCallback(async () => {
    setSetting('api_key', null)
    try {
      const supabase = await getSupabase()
      if (userId) {
        await supabase.from('user_settings').delete().eq('user_id', userId).eq('key', 'api_key')
      }
    } catch { /* offline */ }
  }, [setSetting, userId])

  const [subTab, setSubTab] = useState<'telegram' | 'shortcut'>('telegram')

  // ── Shortcut deep link ──
  const shortcutUrl = apiKey ? buildShortcutDeepLink(apiKey) : null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-4">Integrations</h3>
      </div>

      {/* ── Shared Default Project ── */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">Default Project</h4>
        <p className="text-xs font-light text-foreground/50 mb-2">
          Tasks created via Telegram or iOS Shortcut without a project tag go here.
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

      {/* ── Sub-tabs ── */}
      <div className="flex gap-1 border-b border-border">
        {(['telegram', 'shortcut'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              subTab === tab
                ? 'text-accent border-b-2 border-accent -mb-px'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab === 'telegram' ? 'Telegram Bot' : 'iOS Shortcut'}
          </button>
        ))}
      </div>

      {/* ══════════════ TELEGRAM BOT ══════════════ */}
      {subTab === 'telegram' && (
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">Telegram Bot</h4>

        {/* Telegram ID */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Your Telegram ID</span>
          {!isTelegramConnected ? (
            <>
              <p className="text-xs font-light text-foreground/50 mb-2 mt-1">
                Message{' '}
                <button onClick={() => window.open('https://t.me/userinfobot', '_blank')} className="text-accent hover:underline inline-flex items-center gap-0.5">
                  @userinfobot <ExternalLink size={10} />
                </button>
                {' '}to get your ID.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTelegramId()}
                  placeholder="Your numeric Telegram ID"
                  className="flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted/40 focus:border-accent focus:outline-none"
                />
                <button onClick={handleSaveTelegramId} disabled={!idInput.trim()} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 disabled:opacity-30">
                  {saved ? <Check size={14} className="text-success" /> : 'Connect'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-3 py-1 text-[11px] font-mono text-success">{telegramId}</div>
              <button onClick={handleRemoveTelegramId} className="rounded-full p-1 text-muted hover:bg-danger/10 hover:text-danger transition-colors" title="Disconnect"><X size={12} /></button>
            </div>
          )}
        </div>

        {isTelegramConnected && (
          <>
            <div className="rounded-lg border border-accent/15 bg-accent/5 px-4 py-3 mb-4">
              <p className="text-xs font-light text-foreground/70 mb-2">
                Open{' '}
                <button onClick={() => window.open('https://t.me/todoozybot', '_blank')} className="text-accent font-bold hover:underline inline-flex items-center gap-0.5">
                  @todoozybot <ExternalLink size={10} />
                </button>
                {' '}and send your first task:
              </p>
              <code className="block rounded bg-background/50 px-3 py-2 text-sm font-mono text-foreground/80">
                buy groceries d:tomorrow @shopping p:high
              </code>
            </div>

            {/* Commands */}
            <div className="flex flex-col gap-0.5 mb-2">
              {[
                ['.help', 'Show all commands'], ['.list', 'Show all projects'], ['.default', 'Change default project'],
                ['.done', 'Recently completed'], ['.done <text>', 'Complete a task'], ['.recent', 'Recent open tasks'],
                ['.myday', 'My Day tasks'], ['/projectname', 'List project tasks'],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="flex items-baseline gap-3 py-0.5">
                  <code className="text-[11px] font-mono text-accent whitespace-nowrap w-24">{cmd}</code>
                  <span className="text-xs font-light text-foreground/50">{desc}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      )}

      {/* ══════════════ iOS SHORTCUT ══════════════ */}
      {subTab === 'shortcut' && (
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-3">iOS Shortcut</h4>
        <p className="text-xs font-light text-foreground/50 mb-3">
          Create tasks by voice using your iPhone or Apple Watch Action Button.
        </p>

        {/* API Key */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">API Key</span>
          {!apiKey ? (
            <div className="mt-2">
              <button onClick={handleGenerateApiKey} className="rounded-lg border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6">
                Generate API Key
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 rounded-lg border border-border bg-surface/50 px-3 py-1.5 text-[11px] font-mono text-foreground/60 truncate">{apiKey}</code>
              <button onClick={() => handleCopy(apiKey, 'apikey')} className="rounded p-1.5 text-muted hover:bg-foreground/6 transition-colors" title="Copy">
                {copied === 'apikey' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
              <button onClick={handleRevokeApiKey} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger transition-colors" title="Revoke">
                <RefreshCw size={14} />
              </button>
            </div>
          )}
        </div>

        {apiKey && (
          <>
            {/* Install Shortcut button */}
            {shortcutUrl && (
              <div className="mb-4">
                <button
                  onClick={() => window.open(shortcutUrl, '_blank')}
                  className="rounded-lg bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80"
                >
                  Install Shortcut
                </button>
                <p className="text-[10px] font-light text-foreground/40 mt-1">
                  Opens the Shortcuts app with the shortcut pre-configured
                </p>
              </div>
            )}

            {/* Manual setup instructions */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Manual Setup</span>
              <div className="mt-2 flex flex-col gap-2">
                {[
                  ['1', 'Open the Shortcuts app → tap + → New Shortcut'],
                  ['2', 'Add action: "Dictate Text"'],
                  ['3', 'Add action: "Get Contents of URL"'],
                  ['4', `Set URL to: ${SUPABASE_URL}/rest/v1/rpc/quick_add_task`],
                  ['5', 'Method: POST, Headers: apikey = (copy below), Content-Type = application/json'],
                  ['6', 'Request Body (JSON): {"p_api_key": "(your API key)", "p_title": "Dictated Text"}'],
                  ['7', 'Add action: "Show Notification" → "Task added!"'],
                  ['8', 'Settings → Action Button → assign this shortcut'],
                ].map(([step, text]) => (
                  <div key={step} className="flex gap-2">
                    <span className="text-[10px] font-bold text-accent w-4 flex-shrink-0">{step}</span>
                    <span className="text-xs font-light text-foreground/60">{text}</span>
                  </div>
                ))}
              </div>

              {/* Copyable values */}
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted w-16">URL</span>
                  <code className="flex-1 truncate text-[10px] font-mono text-foreground/50">{SUPABASE_URL}/rest/v1/rpc/quick_add_task</code>
                  <button onClick={() => handleCopy(`${SUPABASE_URL}/rest/v1/rpc/quick_add_task`, 'url')} className="rounded p-1 text-muted hover:bg-foreground/6">
                    {copied === 'url' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted w-16">apikey</span>
                  <code className="flex-1 truncate text-[10px] font-mono text-foreground/50">{ANON_KEY.slice(0, 30)}...</code>
                  <button onClick={() => handleCopy(ANON_KEY, 'anon')} className="rounded p-1 text-muted hover:bg-foreground/6">
                    {copied === 'anon' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted w-16">API Key</span>
                  <code className="flex-1 truncate text-[10px] font-mono text-foreground/50">{apiKey}</code>
                  <button onClick={() => handleCopy(apiKey, 'key2')} className="rounded p-1 text-muted hover:bg-foreground/6">
                    {copied === 'key2' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      )}

      {/* ══════════════ SMART SYNTAX (shown in telegram tab) ══════════════ */}
      {subTab === 'telegram' && isTelegramConnected && (
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">Smart Syntax (Telegram)</h4>
        <div className="flex flex-col gap-0.5">
          {[
            ['@label', 'Assign label'], ['/project', 'Assign to project'], ['d:today', 'Due date'],
            ['p:high', 'Priority'], ['r:url', 'Reference URL'], ['s:status', 'Set status'],
          ].map(([syntax, desc]) => (
            <div key={syntax} className="flex items-baseline gap-3 py-0.5">
              <code className="text-[11px] font-mono text-accent whitespace-nowrap w-24">{syntax}</code>
              <span className="text-xs font-light text-foreground/50">{desc}</span>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}

function buildShortcutDeepLink(_apiKey: string): string {
  const name = 'ToDoozy Quick Add'
  // Note: shortcuts:// deep links have limited support for complex actions.
  // This opens the Shortcuts app to create a new shortcut with the given name.
  return `shortcuts://create-shortcut?name=${encodeURIComponent(name)}`
}
