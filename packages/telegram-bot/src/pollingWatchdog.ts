import type TelegramBot from 'node-telegram-bot-api'

export function logBotFailure(context: string, error?: unknown): void {
  const value = error as { code?: unknown; response?: { statusCode?: unknown } } | undefined
  const code = ['EFATAL', 'ETELEGRAM', 'EPARSE'].includes(String(value?.code)) ? String(value?.code) : 'UNKNOWN'
  const status = value?.response?.statusCode
  console.error(`${context}: ${code}${typeof status === 'number' && Number.isInteger(status) ? ` HTTP ${status}` : ''}`)
}

export function startPollingWatchdog(bot: TelegramBot, exit: (code: number) => void = process.exit): { shutdown: () => Promise<void> } {
  let stopped = false
  let recovering = false
  let stopPromise: Promise<unknown> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let cancelRetry: (() => void) | undefined
  let lastPoll = Date.now()
  let healthySince = Date.now()
  let errors: number[] = []
  let attempts = 0
  let pending = 0
  let growth = 0
  let undrained = 0
  let checking = false
  const getUpdates = bot.getUpdates.bind(bot)
  bot.getUpdates = (options) => getUpdates(options).then((updates) => {
    lastPoll = Date.now()
    return updates
  })

  const fail = (reason: string): void => {
    if (stopped) return
    stopped = true
    clearInterval(monitor)
    clearTimeout(retryTimer)
    cancelRetry?.()
    console.error(`Polling watchdog exiting: ${reason}`)
    exit(1)
  }
  const bounded = async <T>(work: PromiseLike<T>, timeout: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([Promise.resolve(work), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Polling operation timed out')), timeout)
      })])
    } finally { clearTimeout(timer) }
  }
  const gracefulStop = (): Promise<unknown> => {
    if (!stopPromise) stopPromise = bounded(bot.stopPolling({ cancel: false }), 45_000)
    return stopPromise
  }
  const start = (): void => {
    lastPoll = Date.now()
    void bot.startPolling({ restart: false }).catch((error: unknown) => {
      if (stopped) return
      logBotFailure('Polling start failed', error)
      recover('start failure')
    })
  }
  const recover = (reason: string, minimumDelay = 0): void => {
    if (stopped || recovering) return
    recovering = true
    healthySince = Date.now()
    if (attempts >= 3) { fail('recovery limit exceeded'); return }
    const delay = Math.max(minimumDelay, 5_000 * 2 ** attempts)
    attempts++
    console.error(`Polling recovery scheduled: ${reason}; delay ${delay}ms`)
    void (async () => {
      await gracefulStop()
      if (stopped) return
      await new Promise<void>((resolve) => {
        cancelRetry = resolve
        retryTimer = setTimeout(resolve, delay)
      })
      cancelRetry = undefined
      if (stopped) return
      stopPromise = undefined
      errors = []
      growth = 0
      undrained = 0
      pending = 0
      recovering = false
      start()
    })().catch((error: unknown) => {
      if (stopped) return
      logBotFailure('Polling recovery failed', error)
      fail('graceful stop failed')
    })
  }
  bot.on('polling_error', (error: unknown) => {
    if (stopped) return
    logBotFailure('Polling error', error)
    const value = error as { code?: string; response?: { statusCode?: number; body?: { parameters?: { retry_after?: number } } } }
    const status = value.response?.statusCode
    if (status === 401 || status === 403 || status === 409) { fail('unrecoverable polling response'); return }
    healthySince = Date.now()
    errors = errors.filter((time) => Date.now() - time < 60_000)
    errors.push(Date.now())
    const retryAfter = value.response?.body?.parameters?.retry_after
    const delay = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? Math.max(0,retryAfter) * 1000 : 0
    if (delay > 5 * 60_000) { fail('rate limit exceeds recovery window'); return }
    if (value.code === 'EFATAL' || errors.length >= 3 || status === 429) recover('polling errors', delay)
  })
  bot.on('error', (error: unknown) => {
    logBotFailure('Bot error', error)
    fail('bot error')
  })
  const monitor = setInterval(() => {
    if (stopped || recovering || checking) return
    if (!bot.isPolling()) { fail('polling inactive'); return }
    if (Date.now() - lastPoll >= 3 * 60_000) { recover('polling stalled'); return }
    checking = true
    void bounded(bot.getWebHookInfo(), 15_000).then((info) => {
      if (stopped || recovering) return
      if (info.url) { fail('webhook configured for polling bot'); return }
      const count = info.pending_update_count
      if (!Number.isFinite(count) || count < 0) return
      growth = count > pending ? growth + 1 : 0
      undrained = count > 0 && count >= pending ? undrained + 1 : 0
      pending = count
      if (growth >= 3 || undrained >= 5) recover('backlog not draining')
      if (count > 0) healthySince = Date.now()
      else if (Date.now() - healthySince >= 10 * 60_000) attempts = 0
    }).catch((error: unknown) => {
      if (!stopped) logBotFailure('Polling monitor failed', error)
    }).finally(() => { checking = false })
  }, 60_000)
  start()
  let shutdownPromise: Promise<void> | undefined
  return { shutdown: () => {
    if (shutdownPromise) return shutdownPromise
    stopped = true
    clearInterval(monitor)
    clearTimeout(retryTimer)
    cancelRetry?.()
    shutdownPromise = gracefulStop().then(() => { exit(0) }, (error: unknown) => {
      logBotFailure('Polling shutdown failed', error)
      exit(1)
    })
    return shutdownPromise
  } }
}
