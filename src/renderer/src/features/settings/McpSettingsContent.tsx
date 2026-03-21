import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, Server } from 'lucide-react'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'

export function McpSettingsContent(): React.JSX.Element {
  const mcpEnabled = useSetting('mcp_enabled') === 'true'
  const { setSetting } = useSettingsStore()
  const [serverPath, setServerPath] = useState('')
  const [configJson, setConfigJson] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.mcp.getInfo().then((info) => {
      setServerPath(info.serverPath)
      setConfigJson(info.configJson)
    })
  }, [])

  const handleToggle = useCallback(async () => {
    await setSetting('mcp_enabled', mcpEnabled ? 'false' : 'true')
  }, [mcpEnabled, setSetting])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(configJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [configJson])

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
        <button
          onClick={handleToggle}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            mcpEnabled ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              mcpEnabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {mcpEnabled && (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
              Status
            </p>
            <div className="flex items-center gap-2">
              <Server size={14} className="text-fg-secondary" />
              <span className="text-sm font-light text-foreground">
                Server script available
              </span>
              <span className="inline-flex items-center rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">
                Ready
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
              Server Path
            </p>
            <p className="select-all break-all rounded border border-border bg-background px-3 py-2 font-mono text-[11px] text-fg-secondary">
              {serverPath}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                MCP Configuration
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/12"
              >
                {copied ? (
                  <>
                    <Check size={12} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    Copy Config
                  </>
                )}
              </button>
            </div>
            <p className="text-[10px] text-muted">
              Paste this into your Claude Desktop or Claude Code settings
            </p>
            <pre className="select-all overflow-x-auto rounded border border-border bg-background px-3 py-2 font-mono text-[11px] text-fg-secondary">
              {configJson}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}
