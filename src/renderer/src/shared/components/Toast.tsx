import { useEffect, useState, useCallback, useRef } from 'react'
import { usePresence } from '../motion/usePresence'

interface ToastAction { label: string; onClick: () => void; variant?: 'accent' | 'danger' | 'muted' }
interface ToastItem {
  id: string
  message: string
  action?: ToastAction
  actions?: ToastAction[]
  variant?: 'default' | 'danger'
  persistent?: boolean
  duration?: number
}
interface VisibleToast extends ToastItem { closing: boolean }
interface ToastState {
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  removeToast: (id: string) => void
}
let globalState: ToastState | null = null
let globalHasToasts = false
let globalHasToastsListeners: Array<(has: boolean) => void> = []
function setGlobalHasToasts(has: boolean): void {
  if (globalHasToasts === has) return
  globalHasToasts = has
  for (const listener of globalHasToastsListeners) listener(has)
}
export function useHasToasts(): boolean {
  const [has, setHas] = useState(globalHasToasts)
  useEffect(() => {
    globalHasToastsListeners.push(setHas)
    setHas(globalHasToasts)
    return () => { globalHasToastsListeners = globalHasToastsListeners.filter((listener) => listener !== setHas) }
  }, [])
  return has
}
export function useToast(): { addToast: (toast: Omit<ToastItem, 'id'>) => void } {
  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => globalState?.addToast(toast), [])
  return { addToast }
}
function ToastMessage({ toast, dismiss, exited }: { toast: VisibleToast; dismiss: (id: string) => void; exited: (id: string) => void }): React.JSX.Element | null {
  const presence = usePresence(!toast.closing, 'toast')
  useEffect(() => { if (!presence.present) exited(toast.id) }, [presence.present, exited, toast.id])
  if (!presence.present) return null
  const run = (action: ToastAction): void => { action.onClick(); dismiss(toast.id) }
  return <div {...presence.props} role={toast.persistent ? 'alertdialog' : 'status'} aria-label={toast.persistent ? toast.message : undefined}
    aria-live={toast.persistent ? 'assertive' : 'polite'} aria-atomic="true"
    className="ui-surface ui-toast flex items-center gap-3 rounded-[10px] border border-border bg-surface px-4 py-3 shadow-xl">
    <span className={`text-[13px] font-medium ${toast.variant === 'danger' ? 'text-danger' : 'text-foreground'}`}>{toast.message}</span>
    {toast.action && <button onClick={() => { if (toast.action) run(toast.action) }} className="text-[13px] font-medium text-accent hover:underline">{toast.action.label}</button>}
    {toast.actions?.map((action, i) => <button key={i} onClick={() => run(action)}
      className={`text-[13px] font-medium ${action.variant === 'danger' ? 'text-danger hover:underline' : action.variant === 'muted' ? 'text-muted hover:text-foreground' : 'text-accent hover:underline'}`}>{action.label}</button>)}
    {!toast.persistent && <button onClick={() => dismiss(toast.id)} className="ui-icon-button text-muted hover:text-foreground" aria-label="Dismiss notification">×</button>}
  </div>
}
export function ToastContainer(): React.JSX.Element {
  const [toasts, setToasts] = useState<VisibleToast[]>([])
  const [shaking, setShaking] = useState(false)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const dismiss = useCallback((id: string): void => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, closing: true } : toast))
  }, [])
  const exited = useCallback((id: string): void => { setToasts((current) => current.filter((toast) => toast.id !== id)) }, [])
  useEffect(() => {
    const timerMap = timers.current
    const state: ToastState = {
      addToast: (toast) => {
        const id = crypto.randomUUID()
        setToasts((current) => [...current, { ...toast, id, closing: false }])
        if (!toast.persistent) timerMap.set(id, setTimeout(() => dismiss(id), toast.duration ?? 5000))
      },
      removeToast: dismiss
    }
    globalState = state
    return () => {
      timerMap.forEach(clearTimeout)
      timerMap.clear()
      if (globalState === state) globalState = null
      setGlobalHasToasts(false)
    }
  }, [dismiss])
  useEffect(() => { setGlobalHasToasts(toasts.some((toast) => !toast.closing)) }, [toasts])
  const persistentToast = toasts.find((toast) => toast.persistent && !toast.closing)
  useEffect(() => {
    if (!persistentToast) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const actions = persistentToast.actions ?? (persistentToast.action ? [persistentToast.action] : [])
      event.preventDefault()
      event.stopPropagation()
      const action = event.key === 'Enter' ? actions[0] : event.key === 'Escape' ? actions.at(-1) : undefined
      if (action) { action.onClick(); dismiss(persistentToast.id) }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [persistentToast, dismiss])
  return <>
    {persistentToast && <div className="fixed inset-0 z-[99]" onClick={() => { setShaking(true); setTimeout(() => setShaking(false), 300) }} />}
    <div className={`fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 ${shaking && persistentToast ? 'modal-shake' : ''}`}>
      {toasts.map((toast) => <ToastMessage key={toast.id} toast={toast} dismiss={dismiss} exited={exited} />)}
    </div>
  </>
}
