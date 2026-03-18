import { useEffect, useState, useCallback } from 'react'

interface ToastItem {
  id: string
  message: string
  action?: { label: string; onClick: () => void }
  variant?: 'default' | 'danger'
}

interface ToastState {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  removeToast: (id: string) => void
}

let globalState: ToastState | null = null

export function useToast(): { addToast: (toast: Omit<ToastItem, 'id'>) => void } {
  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    globalState?.addToast(toast)
  }, [])
  return { addToast }
}

export function ToastContainer(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    globalState = {
      toasts,
      addToast: (toast) => {
        const id = crypto.randomUUID()
        setToasts((prev) => [...prev, { ...toast, id }])
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 5000)
      },
      removeToast: (id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }
    }
  }, [toasts])

  if (toasts.length === 0) return <></>

  return (
    <div className="fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-200"
        >
          <span
            className={`text-sm font-light ${toast.variant === 'danger' ? 'text-danger' : 'text-foreground'}`}
          >
            {toast.message}
          </span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.onClick()
                globalState?.removeToast(toast.id)
              }}
              className="text-[11px] font-bold uppercase tracking-widest text-accent hover:underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
