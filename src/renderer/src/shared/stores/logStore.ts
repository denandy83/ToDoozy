import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogCategory = 'realtime' | 'network' | 'sync'

export interface LogEntry {
  id: number
  timestamp: string
  level: LogLevel
  category: LogCategory
  message: string
  context?: string
}

const MAX_ENTRIES = 500

interface LogState {
  entries: LogEntry[]
}

interface LogActions {
  addLog(level: LogLevel, category: LogCategory, message: string, context?: string): void
  clear(): void
}

export type LogStore = LogState & LogActions

let nextId = 1

// Anomaly detector — flags runaway realtime event storms (JWT refresh loops, etc.)
// If >THRESHOLD realtime-category logs fire within WINDOW_MS, raise a bell notification
// so the user sees it even when the Logs panel is closed. Cooldown avoids spam.
const ANOMALY_WINDOW_MS = 30_000
const ANOMALY_THRESHOLD = 25
const ANOMALY_COOLDOWN_MS = 5 * 60_000
let realtimeEventTimestamps: number[] = []
let lastAnomalyAt = 0

async function fireAnomalyNotification(count: number, windowSec: number): Promise<void> {
  try {
    const { useNotificationStore } = await import('./notificationStore')
    await useNotificationStore.getState().createNotification({
      id: crypto.randomUUID(),
      type: 'sync_anomaly',
      message: `Realtime sync anomaly: ${count} events in ${windowSec}s — open Settings → Logs`
    })
  } catch {
    // Notification store may not be ready (e.g., pre-auth); skip silently.
  }
}

// Only count messages that indicate something is genuinely wrong. Normal
// startup chatter (subscribe confirmations, effect mount/unmount, WS open,
// SIGNED_IN/OUT) clusters tightly during login/logout but isn't a storm.
//
// Reconnect-related messages (CHANNEL_ERROR, CLOSED, TIMED_OUT, Reconnect…)
// are also excluded — wake-from-sleep and Wi-Fi flake naturally produce
// dozens of these in seconds across all channels. The reconnect logic now
// has its own give-up + banner (see SessionBanner connection-lost variant),
// which is the user-facing signal. The anomaly detector is reserved for
// genuine runaway loops (JWT-refresh storms, etc.).
function isAnomalySignal(message: string): boolean {
  if (message.startsWith('ANOMALY')) return false // don't count meta-log
  if (message.startsWith('Subscribed to')) return false
  if (message.startsWith('effect run') || message.startsWith('effect cleanup')) return false
  if (message.startsWith('WS open')) return false
  if (message.startsWith('setAuth deduped')) return false
  // Reconnect noise — handled by give-up banner, not anomaly notifications.
  if (message.startsWith('Channel CHANNEL_ERROR')) return false
  if (message.startsWith('Channel TIMED_OUT')) return false
  if (message.startsWith('Channel CLOSED')) return false
  if (message.startsWith('Reconnect ')) return false
  if (message.startsWith('Power: ')) return false
  // SIGNED_IN/OUT/INITIAL_SESSION are user-driven; TOKEN_REFRESHED at high
  // frequency is a real signal so we DO count those.
  if (
    message === 'auth: SIGNED_IN' ||
    message === 'auth: SIGNED_OUT' ||
    message === 'auth: INITIAL_SESSION'
  ) {
    return false
  }
  return true
}

function checkRealtimeAnomaly(category: LogCategory, message: string): void {
  if (category !== 'realtime') return
  if (!isAnomalySignal(message)) return
  const now = Date.now()
  const cutoff = now - ANOMALY_WINDOW_MS
  realtimeEventTimestamps = realtimeEventTimestamps.filter((t) => t >= cutoff)
  realtimeEventTimestamps.push(now)
  if (
    realtimeEventTimestamps.length >= ANOMALY_THRESHOLD &&
    now - lastAnomalyAt > ANOMALY_COOLDOWN_MS
  ) {
    lastAnomalyAt = now
    const count = realtimeEventTimestamps.length
    const windowSec = ANOMALY_WINDOW_MS / 1000
    useLogStore.getState().addLog(
      'error',
      'realtime',
      `ANOMALY: ${count} realtime events in last ${windowSec}s`,
      'likely JWT-refresh storm — check setAuth count + auth events above'
    )
    void fireAnomalyNotification(count, windowSec)
  }
}

export const useLogStore = createWithEqualityFn<LogStore>(
  (set) => ({
    entries: [],

    addLog: (level, category, message, context) => {
      const entry: LogEntry = {
        id: nextId++,
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        context
      }
      set((state) => {
        const next = [entry, ...state.entries]
        if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES
        return { entries: next }
      })
      checkRealtimeAnomaly(category, message)
    },

    clear: () => set({ entries: [] })
  }),
  shallow
)

export const selectLogEntries = (state: LogState): LogEntry[] => state.entries

export function logEvent(
  level: LogLevel,
  category: LogCategory,
  message: string,
  context?: string
): void {
  useLogStore.getState().addLog(level, category, message, context)
}
