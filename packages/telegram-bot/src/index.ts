import TelegramBot from 'node-telegram-bot-api'
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
  SupabaseLabel
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
    // Normalize . prefix to / for command parsing
    const normalized = text.startsWith('.') ? '/' + text.slice(1) : text

    // /help or .help
    if (normalized === '/help' || normalized === '/start') {
      await sendHelp(chatId)
      return
    }

    // /myday or .myday
    if (isMyDayCommand(normalized)) {
      await handleMyDay(chatId)
      return
    }

    // /done or .done or /done <query>
    const doneCmd = isDoneCommand(normalized)
    if (doneCmd) {
      await handleDone(chatId, doneCmd.query)
      return
    }

    // /projectname or .projectname (standalone) — list project tasks
    const standaloneProject = isStandaloneCommand(normalized)
    if (standaloneProject) {
      await handleListProject(chatId, standaloneProject)
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
    // Default to first project (personal)
    const projects = await getProjects()
    if (projects.length > 0) {
      // Prefer a project owned by the user
      const owned = projects.find((p) => p.owner_id === (process.env.TODOOZY_USER_ID ?? ''))
      const proj = owned ?? projects[0]
      projectId = proj.id
      projectName = proj.name
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

  const lines: string[] = []
  lines.push(`📁 ${project.name} (${tasks.length} task${tasks.length === 1 ? '' : 's'})`)
  lines.push('')

  for (const task of tasks.slice(0, 20)) {
    let line = `○ ${task.title}`
    const meta: string[] = []
    if (task.due_date) meta.push(`📅 ${formatDueDate(task.due_date)}`)
    if (task.priority > 0) {
      const pLabels = ['', 'p:low', 'p:normal', 'p:high', 'p:urgent']
      meta.push(pLabels[task.priority])
    }
    if (task.labels.length > 0) {
      meta.push(task.labels.map((l) => l.name).join(', '))
    }
    if (meta.length > 0) line += ` · ${meta.join(' · ')}`
    lines.push(line)
  }

  // Build inline keyboard with done buttons
  const keyboard: TelegramBot.InlineKeyboardButton[][] = []
  const ROW_SIZE = 2
  for (let i = 0; i < Math.min(tasks.length, 20); i += ROW_SIZE) {
    const row: TelegramBot.InlineKeyboardButton[] = []
    for (let j = i; j < Math.min(i + ROW_SIZE, tasks.length, 20); j++) {
      const t = tasks[j]
      const label = `✓ ${t.title.length > 20 ? t.title.slice(0, 20) + '…' : t.title}`
      row.push({ text: label, callback_data: `done:${t.id}` })
    }
    keyboard.push(row)
  }

  await bot.sendMessage(chatId, lines.join('\n'), {
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
