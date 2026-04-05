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
  SupabaseLabel,
  supabase,
  userId
} from './supabase'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ALLOWED_TELEGRAM_IDS = (process.env.ALLOWED_TELEGRAM_IDS ?? '')
  .split(',')
  .map((id) => parseInt(id.trim(), 10))
  .filter((id) => !isNaN(id))

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN env var')
}

if (ALLOWED_TELEGRAM_IDS.length === 0) {
  throw new Error('Missing ALLOWED_TELEGRAM_IDS env var')
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

console.log('ToDoozy Telegram Bot started. Polling for messages...')

// ---- Auth guard ----

function isAuthorized(msg: TelegramBot.Message): boolean {
  return msg.from !== undefined && ALLOWED_TELEGRAM_IDS.includes(msg.from.id)
}

// ---- Message handler ----

bot.on('message', async (msg) => {
  if (!msg.text || !isAuthorized(msg)) return

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
  if (!query.from || !ALLOWED_TELEGRAM_IDS.includes(query.from.id)) {
    await bot.answerCallbackQuery(query.id, { text: 'Unauthorized' })
    return
  }

  try {
    if (query.data.startsWith('def:')) {
      const projectId = query.data.slice(4)
      // Look up project name
      const projects = await getProjects()
      const project = projects.find((p) => p.id === projectId)
      const projectName = project?.name ?? projectId
      // Save to user_settings
      await supabase.from('user_settings').upsert({
        id: `${userId}:telegram_default_project`,
        user_id: userId,
        key: 'telegram_default_project',
        value: projectName,
        updated_at: new Date().toISOString()
      })
      await bot.answerCallbackQuery(query.id, { text: `Default: ${projectName}` })
      await bot.editMessageText(`✅ Default project set to *${escapeMarkdownV2(projectName)}*`, {
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

        // Update the message to strike through the completed task
        const originalText = query.message.text ?? ''
        const lines = originalText.split('\n')
        // Find the task title from callback data — just show a done indicator
        const updatedText = originalText + `\n\nDone: task marked complete`
        await bot.editMessageText(updatedText, {
          chat_id: chatId,
          message_id: query.message.message_id
        }).catch(() => {
          // Message might be unchanged, ignore
        })
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'Failed to complete task' })
      }
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
    '`/done` — show recent tasks to complete',
    '`/done text` — fuzzy\\-match and complete a task',
    '`/myday` — show My Day tasks',
    '`/list` — show all projects \\(tap to view tasks\\)',
    '`/default` — set default project for new tasks \\(if no project named "default"\\)',
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
    labelIds
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
  const projects = await getProjects()
  if (projects.length === 0) {
    await bot.sendMessage(chatId, 'No projects found.')
    return
  }

  // Show current default
  const currentDefault = await getDefaultProjectName()
  const ROW_SIZE = 2
  const buttons: TelegramBot.InlineKeyboardButton[][] = []
  for (let i = 0; i < projects.length; i += ROW_SIZE) {
    buttons.push(
      projects.slice(i, i + ROW_SIZE).map((p) => ({
        text: `${p.name === currentDefault ? '✅ ' : ''}${p.name}`,
        callback_data: `def:${p.id}`
      }))
    )
  }

  await bot.sendMessage(chatId, `*Default project:* ${escapeMarkdownV2(currentDefault ?? 'none')}`, {
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: buttons }
  })
}

async function getDefaultProjectName(): Promise<string | null> {
  const { data } = await supabase
    .from('user_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'telegram_default_project')
    .single()
  if (!data?.value) return null
  const proj = await findProjectByName(data.value)
  return proj?.name ?? null
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

  // Show recent tasks with done buttons
  const tasks = await getRecentTasks(10)
  if (tasks.length === 0) {
    await bot.sendMessage(chatId, 'No open tasks found.')
    return
  }

  const lines: string[] = ['Recent tasks:']
  for (const task of tasks) {
    lines.push(`○ ${task.title} (${task.project_name})`)
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
