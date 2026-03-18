import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
}

export function Modal({ open, onClose, children, title }: ModalProps): React.JSX.Element | null {
  const backdropRef = useRef<HTMLDivElement>(null)

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

  if (!open) return null

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === backdropRef.current) {
      onClose()
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-surface p-10 shadow-2xl motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label="Close"
        >
          <X size={16} />
        </button>
        {title && (
          <h2 className="mb-6 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  )
}
