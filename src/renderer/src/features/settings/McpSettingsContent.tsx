import { useState, useCallback } from 'react'
import { Check, Copy } from 'lucide-react'

const MCP_URL = 'https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp'

interface McpSettingsContentProps {
  apiKey: string | null
}

export function McpSettingsContent({ apiKey }: McpSettingsContentProps): React.JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  if (!apiKey) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">MCP Server</p>
        <p className="text-xs font-light text-foreground/50">
          Generate an API key above to see setup instructions for connecting AI assistants.
        </p>
      </div>
    )
  }

  const claudeCmd = `claude mcp add -t http -s user ToDoozy ${MCP_URL} -H "Authorization: Bearer ${apiKey}"`
  const geminiCmd = `gemini mcp add --transport http ToDoozy ${MCP_URL} --header "Authorization: Bearer ${apiKey}"`
  const codexCmd = `codex mcp add ToDoozy --url ${MCP_URL}`
  const jsonConfig = JSON.stringify({
    url: MCP_URL,
    headers: { Authorization: `Bearer ${apiKey}` }
  }, null, 2)
  const claudeDesktopConfig = JSON.stringify({
    ToDoozy: {
      command: 'npx',
      args: [
        '-y', 'mcp-remote',
        MCP_URL,
        '--header',
        `Authorization: Bearer ${apiKey}`
      ]
    }
  }, null, 2)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">MCP Server</p>
      <p className="text-xs font-light text-foreground/50">
        Connect AI assistants to manage your tasks via Model Context Protocol.
      </p>

      {/* Claude Code */}
      <SetupSection title="Claude Code" label="claude-cmd" copied={copied} onCopy={handleCopy}>
        <CmdField value={claudeCmd} label="claude-cmd" copied={copied} onCopy={handleCopy} />
      </SetupSection>

      {/* Gemini CLI */}
      <SetupSection title="Gemini CLI" label="gemini-cmd" copied={copied} onCopy={handleCopy}>
        <CmdField value={geminiCmd} label="gemini-cmd" copied={copied} onCopy={handleCopy} />
      </SetupSection>

      {/* Codex CLI */}
      <SetupSection title="Codex CLI" label="codex-cmd" copied={copied} onCopy={handleCopy}>
        <CmdField value={codexCmd} label="codex-cmd" copied={copied} onCopy={handleCopy} />
        <p className="text-[10px] text-muted mt-1">
          Set <code className="rounded bg-surface px-1 py-0.5 font-mono text-[10px]">TODOOZY_API_KEY</code> environment variable to your API key above.
        </p>
      </SetupSection>

      {/* Claude Desktop */}
      <SetupSection title="Claude Desktop" label="claude-desktop" copied={copied} onCopy={handleCopy}>
        <div className="flex items-start gap-2">
          <pre className="flex-1 select-all overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1.5 font-mono text-[11px] text-fg-secondary">
            {claudeDesktopConfig}
          </pre>
          <button
            onClick={() => handleCopy(claudeDesktopConfig, 'claude-desktop')}
            className="flex-shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground mt-0.5"
            title="Copy config"
          >
            {copied === 'claude-desktop' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1">
          Add under {'"mcpServers"'} in Claude Desktop{'\''}s config file. Requires npx.
        </p>
      </SetupSection>

      {/* Streamable HTTP JSON Config */}
      <SetupSection title="Streamable HTTP (ChatGPT, etc.)" label="json-config" copied={copied} onCopy={handleCopy}>
        <div className="flex items-start gap-2">
          <pre className="flex-1 select-all overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1.5 font-mono text-[11px] text-fg-secondary">
            {jsonConfig}
          </pre>
          <button
            onClick={() => handleCopy(jsonConfig, 'json-config')}
            className="flex-shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground mt-0.5"
            title="Copy config"
          >
            {copied === 'json-config' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1">
          For any MCP client that supports Streamable HTTP natively.
        </p>
      </SetupSection>
    </div>
  )
}

function SetupSection({ title, children }: {
  title: string
  label: string
  copied: string | null
  onCopy: (text: string, label: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-background px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{title}</p>
      {children}
    </div>
  )
}

function CmdField({ value, label, copied, onCopy }: {
  value: string; label: string; copied: string | null
  onCopy: (text: string, label: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <pre className="flex-1 select-all overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary">
        {value}
      </pre>
      <button
        onClick={() => onCopy(value, label)}
        className="flex-shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        title="Copy command"
      >
        {copied === label ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      </button>
    </div>
  )
}
