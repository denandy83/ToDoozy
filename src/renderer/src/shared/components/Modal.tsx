import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useFocusRestore } from '../hooks/useFocusRestore'
import { usePresence } from '../motion/usePresence'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  size?: 'default' | 'large'
  className?: string
}

export function Modal({ open, onClose, children, title, size = 'default', className }: ModalProps): React.JSX.Element | null {
  const backdropRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const presence = usePresence(open, 'dialog')
  useFocusRestore(presence.present, contentRef)
  useFocusTrap(contentRef, presence.present)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!presence.present) return null

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === backdropRef.current) {
      onClose()
    }
  }

  return (
    <div
      ref={backdropRef}
      {...presence.props}
      className="ui-surface ui-dialog ui-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div ref={contentRef} role="dialog" aria-modal="true" aria-label={title ?? 'Dialog'} className={`ui-modal-content relative w-full rounded-xl border border-border bg-surface p-10 shadow-2xl ${
        size === 'large' ? 'max-w-3xl overflow-hidden' : 'max-w-lg'
      } ${className ?? ''}`}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label="Close"
        >
          <X size={16} />
        </button>
        {title && (
          <h2 className="mb-6 ui-section-label">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  )
}
