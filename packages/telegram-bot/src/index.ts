import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import TelegramBot from 'node-telegram-bot-api'

// Prevent multiple instances — PID file lock
const PID_FILE = join(__dirname, '..', '.bot.pid')
if (existsSync(PID_FILE)) {
  const oldPid = parseInt(readFileSync(PID_FILE, 'utf-8'), 10)
  try {
    process.kill(oldPid, 0) // Check if process exists
    console.error(`Bot already running (PID ${oldPid}). Killing old instance.`)
    process.kill(oldPid, 'SIGTERM')
    // Wait a moment for cleanup
    const start = Date.now()
    while (Date.now() - start < 2000) { try { process.kill(oldPid, 0) } catch { break } }
  } catch { /* process doesn't exist, stale PID file */ }
}
writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => { try { unlinkSync(PID_FILE) } catch { /* ignore */ } })
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
import {
  parseMessage,
  isStandaloneCommand,
  isDoneCommand,
  isMyDayCommand,
  formatDueDate,
  formatUrl
} from './parser'
import {
  findProjectByName,
  findOrCreateLabel,
  createTask,
  getProjectTasks,
  getProjects,
  completeTask,
  getMyDayTasks,
  getRecentTasks,
  fuzzyFindTask,
  findStatusByName,
  getRecentlyCompletedTasks,
  SupabaseLabel,
  supabase,
  userId
} from './supabase'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ENV_ALLOWED_IDS = (process.env.ALLOWED_TELEGRAM_IDS ?? '')
  .split(',')
  .map((id) => parseInt(id.trim(), 10))
  .filter((id) => !isNaN(id))

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN env var')
}

if (ENV_ALLOWED_IDS.length === 0) {
  throw new Error('Missing ALLOWED_TELEGRAM_IDS env var')
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

console.log('ToDoozy Telegram Bot started. Polling for messages...')

// Register bot commands for Telegram's autocomplete menu
bot.setMyCommands([
  { command: 'help', description: 'Show all commands and syntax' },
  { command: 'list', description: 'Show all projects' },
  { command: 'default', description: 'View/change default projects for Telegram & iOS' },
  { command: 'done', description: 'Show recently completed tasks' },
  { command: 'recent', description: 'Recent open tasks (tap to complete)' },
  { command: 'myday', description: 'Show My Day tasks' },
]).catch(() => { /* ignore if already set */ })

// ---- Auth guard (checks env var + Supabase user_settings) ----

let cachedSupabaseIds: number[] = []
let lastIdsFetch = 0

async function getAllowedIds(): Promise<number[]> {
  // Refresh from Supabase every 60s
  if (Date.now() - lastIdsFetch > 60_000) {
    try {
      const { data } = await supabase
        .from('user_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'telegram_allowed_ids')
        .single()
      cachedSupabaseIds = (data?.value ?? '').split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
    } catch { /* ignore */ }
    lastIdsFetch = Date.now()
  }
  // Supabase IDs take priority when available; env var is bootstrap fallback
  return cachedSupabaseIds.length > 0 ? cachedSupabaseIds : ENV_ALLOWED_IDS
}

async function isAuthorized(msg: TelegramBot.Message): Promise<boolean> {
  if (!msg.from) return false
  const allowed = await getAllowedIds()
  return allowed.includes(msg.from.id)
}

// ---- Message handler ----

bot.on('message', async (msg) => {
  if (!msg.text || !(await isAuthorized(msg))) return

  const chatId = msg.chat.id
  const text = msg.text.trim()

  try {
    const isDotCommand = text.startsWith('.')
    // Normalize . prefix to / for uniform parsing
    const normalized = isDotCommand ? '/' + text.slice(1) : text

    // Dot commands always run built-in commands directly
    // Slash commands check project names first, then fall back to built-in
    if (normalized.startsWith('/') && !isDotCommand) {
      // /projectname — check if it matches a real project first
      const standaloneProject = isStandaloneCommand(normalized)
      if (standaloneProject) {
        const matchedProject = await findProjectByName(standaloneProject)
        if (matchedProject) {
          await handleListProject(chatId, standaloneProject)
          return
        }
        // Not a project — fall through to built-in command check below
      }
    }

    // Built-in commands (always for ., fallback for /)
    if (normalized === '/help' || normalized === '/start') {
      await sendHelp(chatId)
      return
    }
    if (normalized === '/list') {
      await handleListProjects(chatId)
      return
    }
    if (normalized === '/default') {
      await handleSetDefault(chatId)
      return
    }
    if (normalized === '/recent') {
      await handleRecent(chatId)
      return
    }
    if (isMyDayCommand(normalized)) {
      await handleMyDay(chatId)
      return
    }
    const doneCmd = isDoneCommand(normalized)
    if (doneCmd) {
      await handleDone(chatId, doneCmd.query)
      return
    }

    // Dot-prefixed project names (e.g. .personal)
    if (isDotCommand) {
      const standaloneProject = isStandaloneCommand(normalized)
      if (standaloneProject) {
        await handleListProject(chatId, standaloneProject)
        return
      }
    }

    // Slash command that didn't match project or built-in
    if (normalized.startsWith('/') && isStandaloneCommand(normalized)) {
      const name = isStandaloneCommand(normalized)
      await bot.sendMessage(chatId, `Project "${name}" not found.`)
      return
    }

    // Regular text — create task
    await handleCreateTask(chatId, text)
  } catch (err) {
    console.error('Error handling message:', err)
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    await bot.sendMessage(chatId, `Error: ${errMsg}`)
  }
})

// ---- Callback query handler (inline buttons) ----

bot.on('callback_query', async (query) => {
  if (!query.data || !query.message) return

  // Auth check via chat
  const chatId = query.message.chat.id
  const allowedIds = await getAllowedIds()
  if (!query.from || !allowedIds.includes(query.from.id)) {
    await bot.answerCallbackQuery(query.id, { text: 'Unauthorized' })
    return
  }

  try {
    if (query.data.startsWith('defpick:')) {
      const integration = query.data.slice(8) // 'telegram' or 'ios'
      const projects = await getProjects()
      const ROW_SIZE = 2
      const buttons: TelegramBot.InlineKeyboardButton[][] = []

      // iOS gets a "Follow Telegram" option at the top
      if (integration === 'ios') {
        buttons.push([{ text: '🔗 Follow Telegram', callback_data: 'defset:ios:follow_telegram' }])
      }

      const currentDefault = integration === 'telegram'
        ? await getDefaultProjectName('telegram_default_project')
        : await getIosDefaultProjectName()

      for (let i = 0; i < projects.length; i += ROW_SIZE) {
        buttons.push(
          projects.slice(i, i + ROW_SIZE).map((p) => ({
            text: `${p.name === currentDefault ? '✅ ' : ''}${p.name}`,
            callback_data: `defset:${integration}:${p.id}`
          }))
        )
      }

      const label = integration === 'telegram' ? '📱 Telegram' : '🍎 iOS Shortcut'
      await bot.answerCallbackQuery(query.id)
      await bot.editMessageText(`${label} — select default project:`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {})
      return
    }

    if (query.data.startsWith('defset:')) {
      const parts = query.data.split(':')
      const integration = parts[1] // 'telegram' or 'ios'
      const value = parts.slice(2).join(':') // project ID or 'follow_telegram'

      const settingKey = integration === 'telegram' ? 'telegram_default_project' : 'ios_shortcut_default_project'

      if (value === 'follow_telegram') {
        await supabase.from('user_settings').delete()
          .eq('user_id', userId).eq('key', settingKey)
        await bot.answerCallbackQuery(query.id, { text: '🍎 Following Telegram default' })
        await bot.editMessageText('✅ iOS Shortcut now follows Telegram default', {
          chat_id: chatId,
          message_id: query.message.message_id
        }).catch(() => {})
        return
      }

      const projects = await getProjects()
      const project = projects.find((p) => p.id === value)
      const projectName = project?.name ?? value

      await supabase.from('user_settings').upsert({
        id: `${userId}:${settingKey}`,
        user_id: userId,
        key: settingKey,
        value: projectName,
        updated_at: new Date().toISOString()
      })

      const emoji = integration === 'telegram' ? '📱' : '🍎'
      await bot.answerCallbackQuery(query.id, { text: `Default: ${projectName}` })
      await bot.editMessageText(`✅ ${emoji} Default project set to *${escapeMarkdownV2(projectName)}*`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'MarkdownV2'
      }).catch(() => {})
      return
    }

    if (query.data.startsWith('list:')) {
      const projectName = query.data.slice(5)
      await bot.answerCallbackQuery(query.id)
      await handleListProject(chatId, projectName)
      return
    }

    if (query.data.startsWith('done:')) {
      const taskId = query.data.slice(5)
      const success = await completeTask(taskId)

      if (success) {
        await bot.answerCallbackQuery(query.id, { text: 'Task completed!' })

        // Update the inline keyboard: mark completed task with ✅, keep others clickable
        const oldKeyboard = (query.message.reply_markup?.inline_keyboard ?? []) as TelegramBot.InlineKeyboardButton[][]
        const newKeyboard: TelegramBot.InlineKeyboardButton[][] = []
        for (const row of oldKeyboard) {
          const newRow: TelegramBot.InlineKeyboardButton[] = []
          for (const btn of row) {
            if (btn.callback_data === `done:${taskId}`) {
              // Replace with completed indicator (no callback = not clickable)
              const title = btn.text.replace(/^○ /, '')
              newRow.push({ text: `✅ ${title}`, callback_data: `noop:${taskId}` })
            } else {
              newRow.push(btn)
            }
          }
          newKeyboard.push(newRow)
        }

        await bot.editMessageReplyMarkup(
          { inline_keyboard: newKeyboard },
          { chat_id: chatId, message_id: query.message.message_id }
        ).catch(() => {})
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'Failed to complete task' })
      }
    }

    if (query.data.startsWith('noop:')) {
      await bot.answerCallbackQuery(query.id, { text: 'Already completed' })
    }
  } catch (err) {
    console.error('Error handling callback:', err)
    await bot.answerCallbackQuery(query.id, { text: 'Error occurred' })
  }
})

// ---- Handlers ----

async function sendHelp(chatId: number): Promise<void> {
  await bot.sendMessage(chatId, [
    '*ToDoozy Bot*',
    '',
    'Send any text to create a task\\. Use smart syntax:',
    '`@label` — assign label \\(auto\\-created if new\\)',
    '`/project` — assign to project \\(fuzzy\\-matched\\)',
    '`d:today` — due date \\(today, tomorrow, monday, 2026\\-04\\-10\\)',
    '`p:high` — priority \\(low, normal, high, urgent\\)',
    '`r:url` — reference URL',
    '`s:status` — set status',
    '',
    '*Commands \\(use `/` or `.`\\):*',
    '`/projectname` — list tasks in a project',
    '`/done` — show recently completed tasks',
    '`/done text` — fuzzy\\-match and complete a task',
    '`/recent` — recent open tasks \\(tap to complete\\)',
    '`/myday` — show My Day tasks',
    '`/list` — show all projects \\(tap to view tasks\\)',
    '`/default` — view/change default projects for Telegram \\& iOS',
    '`/help` — show this help',
    '',
    '*Example:*',
    '`eggs and milk /groceries d:today @fast p:high`'
  ].join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleCreateTask(chatId: number, text: string): Promise<void> {
  const parsed = parseMessage(text)

  if (!parsed.title) {
    await bot.sendMessage(chatId, 'Could not parse a task title from your message.')
    return
  }

  // Resolve project
  let projectId: string | null = null
  let projectName: string | null = null

  if (parsed.project) {
    const proj = await findProjectByName(parsed.project)
    if (proj) {
      projectId = proj.id
      projectName = proj.name
    } else {
      await bot.sendMessage(chatId, `Project "${parsed.project}" not found.`)
      return
    }
  } else {
    // Check for user's telegram default project setting
    const { data: defaultSetting } = await supabase
      .from('user_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'telegram_default_project')
      .single()

    if (defaultSetting?.value) {
      const proj = await findProjectByName(defaultSetting.value)
      if (proj) {
        projectId = proj.id
        projectName = proj.name
      }
    }

    // Fallback to first owned project
    if (!projectId) {
      const projects = await getProjects()
      if (projects.length > 0) {
        const owned = projects.find((p) => p.owner_id === (process.env.TODOOZY_USER_ID ?? ''))
        const proj = owned ?? projects[0]
        projectId = proj.id
        projectName = proj.name
      }
    }
  }

  if (!projectId) {
    await bot.sendMessage(chatId, 'No project found. Create a project in ToDoozy first.')
    return
  }

  // Resolve labels
  const labelIds: string[] = []
  const resolvedLabels: SupabaseLabel[] = []
  for (const labelName of parsed.labels) {
    const label = await findOrCreateLabel(labelName)
    labelIds.push(label.id)
    resolvedLabels.push(label)
  }

  // Resolve status
  let statusId: string | null = null
  if (parsed.status) {
    const st = await findStatusByName(projectId, parsed.status)
    if (st) statusId = st.id
  }

  // Create task
  await createTask({
    projectId,
    title: parsed.title,
    priority: parsed.priority,
    dueDate: parsed.dueDate,
    referenceUrl: parsed.referenceUrl,
    statusId,
    labelIds,
    recurrenceRule: parsed.recurrenceRule
  })

  // Build confirmation
  const lines: string[] = []
  lines.push(`✅ ${parsed.title}`)

  const meta: string[] = []
  if (projectName) meta.push(`📁 ${projectName}`)
  if (parsed.dueDate) meta.push(`📅 ${formatDueDate(parsed.dueDate)}`)
  if (parsed.priority > 0) {
    const pLabels = ['', 'Low', 'Normal', 'High', 'Urgent']
    meta.push(`⚡ ${pLabels[parsed.priority]}`)
  }
  if (resolvedLabels.length > 0) {
    meta.push(`🏷 ${resolvedLabels.map((l) => l.name).join(', ')}`)
  }
  if (meta.length > 0) lines.push(meta.join(' · '))

  if (parsed.referenceUrl) {
    lines.push(`🔗 ${formatUrl(parsed.referenceUrl)}`)
  }

  await bot.sendMessage(chatId, lines.join('\n'))
}

async function handleSetDefault(chatId: number): Promise<void> {
  const telegramDefault = await getDefaultProjectName('telegram_default_project')
  const iosDisplay = await getIosDefaultDisplay()

  const lines = [
    '⚙️ *Default Projects*',
    '',
    `📱 Telegram: ${escapeMarkdownV2(telegramDefault ?? 'Auto (first owned)')}`,
    `🍎 iOS Shortcut: ${escapeMarkdownV2(iosDisplay)}`
  ]

  await bot.sendMessage(chatId, lines.join('\n'), {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📱 Change Telegram', callback_data: 'defpick:telegram' },
          { text: '🍎 Change iOS Shortcut', callback_data: 'defpick:ios' }
        ]
      ]
    }
  })
}

async function getDefaultProjectName(key: string = 'telegram_default_project'): Promise<string | null> {
  const { data } = await supabase
    .from('user_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .single()
  if (!data?.value) return null
  const proj = await findProjectByName(data.value)
  return proj?.name ?? null
}

async function getIosDefaultProjectName(): Promise<string | null> {
  return getDefaultProjectName('ios_shortcut_default_project')
}

async function getIosDefaultDisplay(): Promise<string> {
  const iosDefault = await getIosDefaultProjectName()
  if (iosDefault) return iosDefault
  const telegramDefault = await getDefaultProjectName('telegram_default_project')
  return `Following Telegram (${telegramDefault ?? 'Auto'})`
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

async function handleListProjects(chatId: number): Promise<void> {
  const projects = await getProjects()
  if (projects.length === 0) {
    await bot.sendMessage(chatId, 'No projects found.')
    return
  }

  const ROW_SIZE = 2
  const buttons: TelegramBot.InlineKeyboardButton[][] = []
  for (let i = 0; i < projects.length; i += ROW_SIZE) {
    buttons.push(
      projects.slice(i, i + ROW_SIZE).map((p) => ({
        text: `📁 ${p.name}`,
        callback_data: `list:${p.name}`
      }))
    )
  }

  await bot.sendMessage(chatId, '*Your Projects:*\nClick to show all open tasks', {
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: buttons }
  })
}

async function handleListProject(chatId: number, projectName: string): Promise<void> {
  const project = await findProjectByName(projectName)
  if (!project) {
    await bot.sendMessage(chatId, `Project "${projectName}" not found.`)
    return
  }

  const tasks = await getProjectTasks(project.id)
  if (tasks.length === 0) {
    await bot.sendMessage(chatId, `📁 ${project.name} — no open tasks`)
    return
  }

  // Build inline keyboard — one task per row with done button
  const keyboard: TelegramBot.InlineKeyboardButton[][] = []
  for (const t of tasks.slice(0, 20)) {
    const label = `○ ${t.title.length > 30 ? t.title.slice(0, 30) + '…' : t.title}`
    keyboard.push([{ text: label, callback_data: `done:${t.id}` }])
  }

  await bot.sendMessage(chatId, `📁 ${project.name} — ${tasks.length} task${tasks.length === 1 ? '' : 's'}`, {
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function handleRecent(chatId: number): Promise<void> {
  // Show 10 most recently added non-done tasks with inline done buttons
  const tasks = await getRecentTasks(10)
  if (tasks.length === 0) {
    await bot.sendMessage(chatId, 'No open tasks found.')
    return
  }

  const keyboard: TelegramBot.InlineKeyboardButton[][] = []
  for (const task of tasks) {
    const label = `○ ${task.title.length > 30 ? task.title.slice(0, 30) + '…' : task.title}`
    keyboard.push([{ text: label, callback_data: `done:${task.id}` }])
  }

  await bot.sendMessage(chatId, `Recent open tasks — ${tasks.length}`, {
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function handleDone(chatId: number, query: string | null): Promise<void> {
  if (query) {
    // Fuzzy match and complete
    const task = await fuzzyFindTask(query)
    if (!task) {
      await bot.sendMessage(chatId, `No task matching "${query}" found.`)
      return
    }

    const success = await completeTask(task.id)
    if (success) {
      await bot.sendMessage(chatId, `✅ Done: ${task.title}`)
    } else {
      await bot.sendMessage(chatId, `Failed to complete "${task.title}".`)
    }
    return
  }

  // Show recently completed tasks (text only)
  const tasks = await getRecentlyCompletedTasks(10)
  if (tasks.length === 0) {
    await bot.sendMessage(chatId, 'No recently completed tasks.')
    return
  }

  const lines: string[] = [`✅ Recently completed:`, '']
  for (const task of tasks) {
    const date = task.completed_date ? new Date(task.completed_date) : null
    const dateStr = date ? `${date.getDate()}/${date.getMonth() + 1} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : ''
    lines.push(`✅ ${task.title} · ${task.project_name}${dateStr ? ` · ${dateStr}` : ''}`)
  }

  await bot.sendMessage(chatId, lines.join('\n'))
}

async function handleMyDay(chatId: number): Promise<void> {
  const tasks = await getMyDayTasks()
  if (tasks.length === 0) {
    await bot.sendMessage(chatId, '☀️ My Day — no tasks')
    return
  }

  const lines: string[] = [`☀️ My Day (${tasks.length} task${tasks.length === 1 ? '' : 's'})`]
  lines.push('')

  for (const task of tasks) {
    let line = `○ ${task.title}`
    const meta: string[] = [task.project_name]
    if (task.due_date) meta.push(`📅 ${formatDueDate(task.due_date)}`)
    if (task.priority > 0) {
      const pLabels = ['', 'p:low', 'p:normal', 'p:high', 'p:urgent']
      meta.push(pLabels[task.priority])
    }
    line += ` · ${meta.join(' · ')}`
    lines.push(line)
  }

  const keyboard: TelegramBot.InlineKeyboardButton[][] = []
  for (const task of tasks) {
    const label = `✓ ${task.title.length > 30 ? task.title.slice(0, 30) + '…' : task.title}`
    keyboard.push([{ text: label, callback_data: `done:${task.id}` }])
  }

  await bot.sendMessage(chatId, lines.join('\n'), {
    reply_markup: { inline_keyboard: keyboard }
  })
}
