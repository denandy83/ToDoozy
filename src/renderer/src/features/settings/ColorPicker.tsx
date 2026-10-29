import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ColorSwatches } from '../../shared/components/ColorSwatches'
import { MotionPresence } from '../../shared/motion/MotionPresence'
import { useFocusTrap } from '../../shared/hooks/useFocusTrap'
import { useFocusRestore } from '../../shared/hooks/useFocusRestore'
import { pushPopup } from '../../shared/utils/popupStack'

interface ColorValueProps {
  label?: string
  value: string
  onChange: (value: string) => void
}

export function ColorSquare({ value, onChange, label = 'Color' }: ColorValueProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useFocusTrap(menuRef, open)
  useFocusRestore(open, menuRef)
  useEffect(() => {
    if (!open) return
    const unsubscribe = pushPopup(() => setOpen(false))
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => { unsubscribe(); document.removeEventListener('mousedown', outside) }
  }, [open])
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu || !anchor) return
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 8))
    const top = anchor.bottom + menu.offsetHeight + 4 <= window.innerHeight - 8 ? anchor.bottom + 4 : Math.max(8, anchor.top - menu.offsetHeight - 4)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.transformOrigin = `${anchor.left + anchor.width/2-left}px ${top >= anchor.bottom ? '0px' : menu.offsetHeight+'px'}`
    if (open && document.activeElement === triggerRef.current) menu.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open, anchor])
  return <>
    <button ref={triggerRef} type="button" aria-label={`Edit ${label.toLowerCase()} color`} aria-expanded={open}
      onClick={() => { setAnchor(triggerRef.current?.getBoundingClientRect() ?? null); setOpen(!open) }}
      className="h-7 w-7 flex-shrink-0 rounded-md border border-border" style={{ backgroundColor: value }} />
    {createPortal(<MotionPresence open={open}>{() => anchor ? <div ref={menuRef} role="dialog" aria-label={`${label} colors`} className="fixed z-[120] w-60 rounded-lg border border-border bg-surface p-3 shadow-xl" style={{ left: anchor.left, top: anchor.bottom + 4 }}>
      <div className="mb-3 flex items-center justify-between gap-2"><span className="ui-section-label">{label}</span><button type="button" className="ui-icon-button text-muted" onClick={() => setOpen(false)} aria-label="Close color choices">×</button></div>
      <ColorSwatches value={value} onChange={onChange} />
    </div> : null}</MotionPresence>, document.body)}
  </>
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
      onChange={(e) => { setInputValue(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value) }}
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
  return <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: '70px 28px 1fr' }}>
    <span className="ui-section-label text-right">{label}</span>
    <ColorSquare label={label} value={value} onChange={onChange} />
    <ColorHex label={label} value={value} onChange={onChange} />
  </div>
}

export function ColorPickerCells({ label, value, onChange }: ColorPickerProps): React.JSX.Element {
  return <>
    <span className="ui-section-label text-right">{label}</span>
    <ColorSquare label={label} value={value} onChange={onChange} />
    <ColorHex label={label} value={value} onChange={onChange} />
  </>
}
