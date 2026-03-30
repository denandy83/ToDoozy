import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

interface DetailReferenceUrlProps {
  referenceUrl: string | null
  onReferenceUrlChange: (url: string | null) => void
}

/** Returns true if the string looks like a valid URL (has a dot and no spaces). */
function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes(' ')) return false
  // Must contain a dot (domain separator) and no spaces
  return /^[^\s]+\.[^\s]+/.test(trimmed)
}

/** Ensures a URL has an http(s):// prefix. */
function ensureProtocol(url: string): string {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** Truncates a URL for display: shows domain + start of path, ellipsis if too long. */
function displayUrl(url: string): string {
  try {
    const full = ensureProtocol(url)
    const parsed = new URL(full)
    const display = parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
    return display.length > 50 ? display.slice(0, 47) + '...' : display
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '...' : url
  }
}

export function DetailReferenceUrl({
  referenceUrl,
  onReferenceUrlChange
}: DetailReferenceUrlProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(referenceUrl ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync from prop when task changes
  useEffect(() => {
    setValue(referenceUrl ?? '')
  }, [referenceUrl])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const save = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      const newVal = trimmed || null
      if (newVal !== referenceUrl) {
        onReferenceUrlChange(newVal)
      }
    },
    [referenceUrl, onReferenceUrlChange]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setValue(val)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => save(val), 1000)
    },
    [save]
  )

  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    save(value)
    setIsEditing(false)
  }, [value, save])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      // Revert to saved value and blur
      setValue(referenceUrl ?? '')
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      ;(e.target as HTMLInputElement).blur()
      setIsEditing(false)
    }
  }, [referenceUrl])

  const handleClear = useCallback(() => {
    setValue('')
    onReferenceUrlChange(null)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [onReferenceUrlChange])

  const handleOpenUrl = useCallback(() => {
    if (referenceUrl && looksLikeUrl(referenceUrl)) {
      window.api.shell.openExternal(ensureProtocol(referenceUrl))
    }
  }, [referenceUrl])

  const startEditing = useCallback(() => {
    setIsEditing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Show input when editing or empty
  if (isEditing || !referenceUrl) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsEditing(true)}
        placeholder="Add reference..."
        className="w-full bg-transparent text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-0 py-0.5"
        aria-label="Reference URL"
      />
    )
  }

  // Show saved URL as clickable link
  const isClickable = looksLikeUrl(referenceUrl)

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {isClickable ? (
        <button
          onClick={handleOpenUrl}
          className="group/link flex items-center gap-1 min-w-0 text-sm font-light text-accent hover:underline truncate"
          title={ensureProtocol(referenceUrl)}
          aria-label={`Open ${referenceUrl}`}
        >
          <ExternalLink size={12} className="flex-shrink-0 opacity-50 group-hover/link:opacity-100" />
          <span className="truncate">{displayUrl(referenceUrl)}</span>
        </button>
      ) : (
        <button
          onClick={startEditing}
          className="text-sm font-light text-muted truncate"
          title={referenceUrl}
        >
          {referenceUrl.length > 50 ? referenceUrl.slice(0, 47) + '...' : referenceUrl}
        </button>
      )}
      <button
        onClick={startEditing}
        className="flex-shrink-0 rounded p-0.5 text-muted/40 transition-colors hover:text-foreground hover:bg-foreground/6"
        title="Edit reference URL"
        aria-label="Edit reference URL"
        tabIndex={-1}
      >
        <span className="text-[10px]">edit</span>
      </button>
      <button
        onClick={handleClear}
        className="flex-shrink-0 rounded p-0.5 text-muted/40 transition-colors hover:text-danger hover:bg-foreground/6"
        title="Clear reference URL"
        aria-label="Clear reference URL"
      >
        <X size={12} />
      </button>
    </div>
  )
}
