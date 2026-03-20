import { useEffect, useState, useCallback } from 'react'

interface ToastAction {
  label: string
  onClick: () => void
  variant?: 'accent' | 'danger' | 'muted'
}

interface ToastItem {
  id: string
  message: string
  action?: ToastAction
  actions?: ToastAction[]
  variant?: 'default' | 'danger'
  persistent?: boolean
}

interface ToastState {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  removeToast: (id: string) => void
}

let globalState: ToastState | null = null
let globalHasToasts = false
let globalHasToastsListeners: Array<(has: boolean) => void> = []

function setGlobalHasToasts(has: boolean): void {
  if (globalHasToasts !== has) {
    globalHasToasts = has
    for (const listener of globalHasToastsListeners) listener(has)
  }
}

export function useHasToasts(): boolean {
  const [has, setHas] = useState(globalHasToasts)
  useEffect(() => {
    globalHasToastsListeners.push(setHas)
    setHas(globalHasToasts)
    return () => {
      globalHasToastsListeners = globalHasToastsListeners.filter((l) => l !== setHas)
    }
  }, [])
  return has
}

export function useToast(): { addToast: (toast: Omit<ToastItem, 'id'>) => void } {
  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    globalState?.addToast(toast)
  }, [])
  return { addToast }
}

export function ToastContainer(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [shaking, setShaking] = useState(false)

  useEffect(() => {
    globalState = {
      toasts,
      addToast: (toast) => {
        const id = crypto.randomUUID()
        setToasts((prev) => {
          const next = [...prev, { ...toast, id }]
          setGlobalHasToasts(true)
          return next
        })
        if (!toast.persistent) {
          setTimeout(() => {
            setToasts((prev) => {
              const next = prev.filter((t) => t.id !== id)
              setGlobalHasToasts(next.length > 0)
              return next
            })
          }, 5000)
        }
      },
      removeToast: (id) => {
        setToasts((prev) => {
          const next = prev.filter((t) => t.id !== id)
          setGlobalHasToasts(next.length > 0)
          return next
        })
      }
    }
  }, [toasts])

  const handleOverlayClick = useCallback(() => {
    setShaking(true)
    setTimeout(() => setShaking(false), 300)
  }, [])

  const hasPersistent = toasts.some((t) => t.persistent)

  // Enter confirms first action, Escape cancels (last action) on persistent toasts
  useEffect(() => {
    if (!hasPersistent) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      const persistentToast = toasts.find((t) => t.persistent)
      if (!persistentToast) return
      const actions = persistentToast.actions ?? (persistentToast.action ? [persistentToast.action] : [])
      // Block all keyboard input while persistent toast is visible
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Enter' && actions.length > 0) {
        actions[0].onClick()
        globalState?.removeToast(persistentToast.id)
      } else if (e.key === 'Escape' && actions.length > 0) {
        const cancelAction = actions[actions.length - 1]
        cancelAction.onClick()
        globalState?.removeToast(persistentToast.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [hasPersistent, toasts])

  if (toasts.length === 0) return <></>

  return (
    <>
      {hasPersistent && (
        <div
          className="fixed inset-0 z-[99]"
          onClick={handleOverlayClick}
        />
      )}
      <div className={`fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 ${shaking && hasPersistent ? 'modal-shake' : ''}`}>
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
            {toast.actions && toast.actions.map((action, i) => {
              const colorClass = action.variant === 'danger'
                ? 'text-danger hover:underline'
                : action.variant === 'muted'
                  ? 'text-muted hover:text-foreground'
                  : 'text-accent hover:underline'
              return (
                <button
                  key={i}
                  onClick={() => {
                    action.onClick()
                    globalState?.removeToast(toast.id)
                  }}
                  className={`text-[11px] font-bold uppercase tracking-widest ${colorClass}`}
                >
                  {action.label}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
