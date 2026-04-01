import { useState, useEffect } from 'react'
import { Copy, Server } from 'lucide-react'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'

export function McpSettingsContent(): React.JSX.Element {
  const mcpEnabled = useSetting('mcp_enabled') === 'true'
  const { setSetting } = useSettingsStore()
  const [serverPath, setServerPath] = useState('')
  const [configJson, setConfigJson] = useState('')

  useEffect(() => {
    window.api.mcp.getInfo().then((info) => {
      setServerPath(info.serverPath)
      setConfigJson(info.configJson)
    })
  }, [])

  // Parse the config to extract the command for display
  const mcpEntry = (() => {
    try {
      const parsed = JSON.parse(configJson)
      return parsed?.mcpServers?.ToDoozy
    } catch { return null }
  })()
  const command = mcpEntry?.command ?? 'node'

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        MCP Server
      </p>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Enable MCP Server</p>
          <p className="text-[10px] text-muted">
            Allow AI assistants to manage tasks via Model Context Protocol
          </p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSetting('mcp_enabled', 'true')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              mcpEnabled ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            On
          </button>
          <button
            onClick={() => setSetting('mcp_enabled', 'false')}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
              !mcpEnabled ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
            }`}
          >
            Off
          </button>
        </div>
      </div>

      {mcpEnabled && (
        <>
          <div className="flex items-center gap-2">
            <Server size={14} className="text-fg-secondary" />
            <span className="text-sm font-light text-foreground">Server ready</span>
          </div>

          {/* Claude Code */}
          <div className="flex flex-col gap-2 rounded border border-border bg-background px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Claude Code</p>
            <p className="text-[12px] font-light text-foreground/80">Run this command in your terminal:</p>
            <div className="flex items-center gap-2">
              <pre className="flex-1 select-all overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary">
                claude mcp add ToDoozy -e ELECTRON_RUN_AS_NODE=1 -- {command} {serverPath}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(`claude mcp add ToDoozy -e ELECTRON_RUN_AS_NODE=1 -- ${command} ${serverPath}`)}
                className="flex-shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title="Copy command"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>

          {/* Claude Desktop — no MCP servers yet */}
          <div className="flex flex-col gap-2 rounded border border-border bg-background px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Claude Desktop — No MCP servers yet</p>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] font-light text-foreground/80">
              <li>Open Claude Desktop &gt; Settings &gt; Developer &gt; Edit Config</li>
              <li>Add a comma after the last entry in your config, then paste this before the final <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">{'}'}</code>:</li>
            </ol>
            <div className="flex items-center gap-2">
              <pre className="flex-1 select-all overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary">
{`"mcpServers": {
  "ToDoozy": {
    "command": "${command}",
    "args": ["${serverPath}"],
    "env": { "ELECTRON_RUN_AS_NODE": "1" }
  }
}`}
              </pre>
              <button
                onClick={() => {
                  const block = `"mcpServers": {\n  "ToDoozy": {\n    "command": "${command}",\n    "args": ["${serverPath}"],\n    "env": { "ELECTRON_RUN_AS_NODE": "1" }\n  }\n}`
                  navigator.clipboard.writeText(block)
                }}
                className="flex-shrink-0 self-start rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title="Copy block"
              >
                <Copy size={12} />
              </button>
            </div>
            <p className="text-[11px] font-light text-muted">Your file should look like this:</p>
            <pre className="overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1 font-mono text-[10px] text-muted/60">
{`{
  "preferences": { ... },
  "mcpServers": {
    "ToDoozy": {
      "command": "${command}",
      "args": ["..."],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}`}
            </pre>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] font-light text-foreground/80" start={3}>
              <li>Save and restart Claude Desktop</li>
            </ol>
          </div>

          {/* Claude Desktop — already have MCP servers */}
          <div className="flex flex-col gap-2 rounded border border-border bg-background px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Claude Desktop — Already have MCP servers</p>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] font-light text-foreground/80">
              <li>Open Claude Desktop &gt; Settings &gt; Developer &gt; Edit Config</li>
              <li>Find the <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">{'"mcpServers"'}</code> section. Add a comma after the last server entry, then add:</li>
            </ol>
            <div className="flex items-center gap-2">
              <pre className="flex-1 select-all overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary">
{`"ToDoozy": {
  "command": "${command}",
  "args": ["${serverPath}"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}`}
              </pre>
              <button
                onClick={() => {
                  const entry = `"ToDoozy": {\n  "command": "${command}",\n  "args": ["${serverPath}"],\n  "env": { "ELECTRON_RUN_AS_NODE": "1" }\n}`
                  navigator.clipboard.writeText(entry)
                }}
                className="flex-shrink-0 self-start rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title="Copy entry"
              >
                <Copy size={12} />
              </button>
            </div>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] font-light text-foreground/80" start={3}>
              <li>Save and restart Claude Desktop</li>
            </ol>
          </div>

          {/* Gemini */}
          <div className="flex flex-col gap-2 rounded border border-border bg-background px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Gemini (Google AI Studio)</p>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] font-light text-foreground/80">
              <li>Open Google AI Studio &gt; Settings &gt; MCP Servers</li>
              <li>Click &quot;Add MCP Server&quot; and paste this JSON config:</li>
            </ol>
            <div className="flex items-center gap-2">
              <pre className="flex-1 select-all overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary">
{`{
  "command": "${command}",
  "args": ["${serverPath}"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}`}
              </pre>
              <button
                onClick={() => {
                  const block = `{\n  "command": "${command}",\n  "args": ["${serverPath}"],\n  "env": { "ELECTRON_RUN_AS_NODE": "1" }\n}`
                  navigator.clipboard.writeText(block)
                }}
                className="flex-shrink-0 self-start rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title="Copy config"
              >
                <Copy size={12} />
              </button>
            </div>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] font-light text-foreground/80" start={3}>
              <li>Save and the server should connect automatically</li>
            </ol>
          </div>

          {/* Other clients */}
          <div className="flex flex-col gap-2 rounded border border-border bg-background px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Other MCP Clients</p>
            <p className="text-[12px] font-light text-foreground/80">
              Set <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">ELECTRON_RUN_AS_NODE=1</code> in the environment, then use this command and argument:
            </p>
            <div className="flex items-center gap-2">
              <pre className="flex-1 select-all overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary">
                {command} {serverPath}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(`${command} ${serverPath}`)}
                className="flex-shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title="Copy command"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
