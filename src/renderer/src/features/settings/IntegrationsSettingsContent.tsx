import { useState, useCallback, useEffect, useRef } from 'react'
import { Check, ExternalLink, X, Copy, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useAuthStore } from '../../shared/stores/authStore'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'
import { useToast } from '../../shared/components/Toast'
import { getSupabase } from '../../lib/supabase'
import { shouldForceDelete } from '../../shared/utils/shiftDelete'
import { McpSettingsContent } from './McpSettingsContent'

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
          .in('key', ['telegram_default_project', 'telegram_user_id', 'telegram_allowed_ids', 'api_key', 'ios_shortcut_default_project'])
        if (data && data.length > 0) {
          for (const row of data) {
            if (row.value) await window.api.settings.set(userId, row.key, row.value)
          }
          hydrateSettings()
        } else {
          console.log('[Integrations] No settings returned from Supabase (auth may not be ready)')
        }
      } catch (err) { console.warn('[Integrations] Failed to pull settings from Supabase:', err) }
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

  const iosDefaultProject = useSetting('ios_shortcut_default_project')
  const [subTab, setSubTab] = useState<'telegram' | 'shortcut' | 'mcp'>('telegram')


  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-tabs ── */}
      <div className="flex gap-1 border-b border-border">
        {(['telegram', 'shortcut', 'mcp'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              subTab === tab
                ? 'text-accent border-b-2 border-accent -mb-px'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab === 'telegram' ? 'Telegram Bot' : tab === 'shortcut' ? 'iOS Shortcut' : 'MCP Server'}
          </button>
        ))}
      </div>

      {/* ══════════════ TELEGRAM BOT ══════════════ */}
      {subTab === 'telegram' && (
      <div>
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

        {/* Telegram Default Project */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Default Project</span>
          <p className="text-xs font-light text-foreground/50 mb-2 mt-1">
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
        <p className="text-xs font-light text-foreground/50 mb-3">
          Create tasks by voice using your iPhone or Apple Watch Action Button.
        </p>

        {/* iOS Shortcut Default Project */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Default Project</span>
          <p className="text-xs font-light text-foreground/50 mb-2 mt-1">
            Tasks created via iOS Shortcut go here.
          </p>
          <select
            value={iosDefaultProject ?? 'follow_telegram'}
            onChange={(e) => setSetting('ios_shortcut_default_project', e.target.value === 'follow_telegram' ? null : e.target.value)}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          >
            <option value="follow_telegram">Follow Telegram default{defaultProject ? ` (${defaultProject})` : ''}</option>
            {sortedProjects.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

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
            {/* Setup instructions with inline copy fields */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Setup</span>
              <p className="text-xs font-light text-foreground/50 mt-1 mb-3">
                Create a Shortcut to add tasks by voice. Assign it to your Action Button.
              </p>
              <div className="flex flex-col gap-3">
                <Step n={1} text='Open Shortcuts app → tap "+" → New Shortcut' />
                <Step n={2} text='Add action: "Dictate Text"' />
                <Step n={3} text='Add action: "Get Contents of URL" and paste this URL:'>
                  <CopyField value={`${SUPABASE_URL}/rest/v1/rpc/quick_add_task`} label="url" copied={copied} onCopy={handleCopy} />
                </Step>
                <Step n={4} text="Set Method to POST" />
                <Step n={5} text="Add Header — key: apikey, value:">
                  <CopyField value={ANON_KEY} label="anon" copied={copied} onCopy={handleCopy} truncate />
                </Step>
                <Step n={6} text="Add Header — key: Authorization, value:">
                  <CopyField value={`Bearer ${ANON_KEY}`} label="auth" copied={copied} onCopy={handleCopy} truncate />
                </Step>
                <Step n={7} text="Add Header — key: Content-Type, value:">
                  <CopyField value="application/json" label="ctype" copied={copied} onCopy={handleCopy} />
                </Step>
                <Step n={8} text='Set Request Body to JSON, add key p_api_key with your API key:'>
                  <CopyField value={apiKey} label="key2" copied={copied} onCopy={handleCopy} highlight />
                </Step>
                <Step n={9} text='Add another JSON key: p_title — tap the value field and select "Dictated Text" from the variables above' />
                <Step n={10} text='Add action: "Get Dictionary Value" — set Key to project_name, Dictionary to the URL result' />
                <Step n={11} text='Add action: "Show Notification" — set title to "Task added to" followed by the Dictionary Value variable' />
                <Step n={12} text="Done! Go to Settings → Action Button to assign this shortcut" />
              </div>
            </div>
          </>
        )}
      </div>

      )}

      {/* ══════════════ MCP SERVER ══════════════ */}
      {subTab === 'mcp' && <McpSettingsContent />}

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

function Step({ n, text, children }: { n: number; text: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="flex gap-2">
        <span className="text-[10px] font-bold text-accent w-4 flex-shrink-0 mt-0.5">{n}</span>
        <span className="text-xs font-light text-foreground/60">{text}</span>
      </div>
      {children && <div className="ml-6 mt-1">{children}</div>}
    </div>
  )
}

function CopyField({ value, label, copied, onCopy, truncate, highlight }: {
  value: string; label: string; copied: string | null
  onCopy: (text: string, label: string) => void
  truncate?: boolean; highlight?: boolean
}): React.JSX.Element {
  return (
    <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${highlight ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface/50'}`}>
      <code className={`flex-1 text-[10px] font-mono ${highlight ? 'text-accent' : 'text-foreground/50'} ${truncate ? 'truncate' : 'break-all'}`}>
        {truncate ? value.slice(0, 40) + '...' : value}
      </code>
      <button onClick={() => onCopy(value, label)} className="rounded p-1 text-muted hover:bg-foreground/6 flex-shrink-0">
        {copied === label ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      </button>
    </div>
  )
}
