import { useState, useCallback, useRef, useEffect } from 'react'

interface ColorValueProps {
  value: string
  onChange: (value: string) => void
}

export function ColorSquare({ value, onChange }: ColorValueProps): React.JSX.Element {
  return (
    <div className="relative">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-7 w-7 cursor-pointer opacity-0"
      />
      <div
        className="h-7 w-7 rounded-md border border-border cursor-pointer"
        style={{ backgroundColor: value }}
      />
    </div>
  )
}

export function ColorHex({ value, onChange }: ColorValueProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setInputValue(value) }, [value])

  return editing ? (
    <input
      ref={inputRef}
      type="text"
      value={inputValue}
      onChange={(e) => { setInputValue(e.target.value); onChange(e.target.value) }}
      onBlur={() => {
        setEditing(false)
        if (!/^#[0-9a-fA-F]{6}$/.test(inputValue)) setInputValue(value)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
      autoFocus
    />
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="text-left text-xs font-mono text-fg-secondary hover:text-foreground transition-colors"
    >
      {value}
    </button>
  )
}

interface ColorPickerProps {
  label: string
  value: string
  onChange: (color: string) => void
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  const handleHexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setInputValue(v)
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        onChange(v)
      }
    },
    [onChange]
  )

  const handleNativeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setInputValue(v)
      onChange(v)
    },
    [onChange]
  )

  const handleBlur = useCallback(() => {
    setEditing(false)
    if (!/^#[0-9a-fA-F]{6}$/.test(inputValue)) {
      setInputValue(value)
    }
  }, [inputValue, value])

  return (
    <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: '70px 28px 1fr' }}>
      <label className="text-[8px] font-bold uppercase tracking-widest text-muted text-right">
        {label}
      </label>
      <div className="relative">
        <input
          type="color"
          value={value}
          onChange={handleNativeChange}
          className="absolute inset-0 h-7 w-7 cursor-pointer opacity-0"
        />
        <div
          className="h-7 w-7 rounded-md border border-border cursor-pointer"
          style={{ backgroundColor: value }}
        />
      </div>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleHexChange}
          onBlur={handleBlur}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-left text-xs font-mono text-fg-secondary hover:text-foreground transition-colors"
        >
          {value}
        </button>
      )}
    </div>
  )
}

export function ColorPickerCells({ label, value, onChange }: ColorPickerProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  const handleNativeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
    },
    [onChange]
  )

  const handleHexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setInputValue(v)
      onChange(v)
    },
    [onChange]
  )

  const handleBlur = useCallback(() => {
    setEditing(false)
    if (!/^#[0-9a-fA-F]{6}$/.test(inputValue)) {
      setInputValue(value)
    }
  }, [inputValue, value])

  return (
    <>
      <span className="text-[8px] font-bold uppercase tracking-widest text-muted text-right">
        {label}
      </span>
      <div className="relative">
        <input
          type="color"
          value={value}
          onChange={handleNativeChange}
          className="absolute inset-0 h-7 w-7 cursor-pointer opacity-0"
        />
        <div
          className="h-7 w-7 rounded-md border border-border cursor-pointer"
          style={{ backgroundColor: value }}
        />
      </div>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleHexChange}
          onBlur={handleBlur}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-left text-xs font-mono text-fg-secondary hover:text-foreground transition-colors"
        >
          {value}
        </button>
      )}
    </>
  )
}
