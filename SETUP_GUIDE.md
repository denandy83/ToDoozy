# ToDoozy v2 — Setup Guide

> Do everything in this file BEFORE opening Claude Code.
> Once done, open Claude Code and point it at REBUILD_SPEC.md.

---

## 1. Install Prerequisites

```bash
# Node.js 20+ (required for Electron + electron-vite)
node --version  # should be v20+

# Claude Code CLI
claude --version  # install from https://claude.ai/claude-code if missing

# Supabase CLI (for local dev + migrations)
brew install supabase/tap/supabase
supabase --version

# Git (should already be installed)
git --version
```

---

## 2. Create Supabase Project

1. Go to https://supabase.com → **New Project**
2. Pick a name, set a database password, choose a region close to you
3. Note your **Project URL** and **anon key** (Settings > API) — you'll need these later
https://supabase.com/dashboard/project/znmgsyjkaftbnhtlcxrm
publishable key
anon key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubWdzeWprYWZ0Ym5odGxjeHJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjA2MTUsImV4cCI6MjA4OTM5NjYxNX0.FzDK5NRvauwrwgM7oaMqZqosYaY2nSeBlFsSQfzoDM0
4. In **Auth > Providers**, enable **Google**:
   - Create OAuth credentials at https://console.cloud.google.com/apis/credentials
   - Add the Supabase callback URL (shown in the Google provider settings)
   - Paste the Client ID and Client Secret
5. In **Auth > Settings**, confirm email/password sign-up is enabled
6. In **Auth > URL Configuration**, add `http://localhost:5173` to Redirect URLs (for Electron dev mode)

---

## 3. Create Project Directory

```bash
mkdir todoozy && cd todoozy
git init
```

Copy the spec file into the project:

```bash
cp /path/to/REBUILD_SPEC.md .
```

---

## 4. Configure Claude Code Permissions

Create or edit `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(git *)",
      "Bash(node *)",
      "Bash(supabase *)",
      "Bash(mkdir *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(rm *)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch"
    ]
  }
}
```

This gives Claude broad permissions during the build. Tighten after the project is stable.

---

## 5. Set Up Keybindings

Create `~/.claude/keybindings.json` if it doesn't exist:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "shift+enter": "chat:newline"
      }
    }
  ]
}
```

This lets you type multi-line prompts with Shift+Enter.

---

## 6. Create Environment File

In your project directory, create `.env` (add to `.gitignore`):

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

---

## 7. Open Claude Code

```bash
cd todoozy
claude
```

### First command: Initialize

```
/init
```

This creates `CLAUDE.md`. Claude will ask what the project is — tell it:

> This is an Electron desktop todo app. Read REBUILD_SPEC.md for the complete specification.

### Second command: Set the model

For scaffolding and architecture (Phase 1 steps 1-3), use Opus:

```
/model opus
```

Switch to Sonnet for feature implementation later (faster):

```
/model sonnet
```

### Third command: Install skills

```
/install-skill simplify
/install-skill commit
/install-skill review-pr
/install-skill mcp-builder
```

If skills aren't installable via `/install-skill`, they may already be available as built-in slash commands. Try `/simplify` to check.

### Fourth command: Start building

Give Claude this prompt to begin:

> Read REBUILD_SPEC.md. It contains the complete product specification for ToDoozy v2.
>
> Start by:
> 1. Scaffold the Electron + React + TypeScript project using electron-vite
> 2. Install all dependencies (better-sqlite3, @dnd-kit/core, @dnd-kit/sortable, lucide-react, tailwindcss, @tailwindcss/vite, zustand, @modelcontextprotocol/sdk, @supabase/supabase-js)
> 3. Set up the database layer: schema with versioned migrations, repository classes
> 4. Set up the IPC layer: typed preload bridge with all handlers
> 5. Set up the Zustand stores: taskStore, labelStore, settingsStore, statusStore, projectStore, authStore
> 6. Create the basic app shell: sidebar, main content area, routing between views
>
> Don't build features yet — just the skeleton with proper architecture. I'll request features one at a time after that.

---

## Checklist

Before you start building, confirm:

- [ ] Node.js 20+ installed
- [ ] Claude Code CLI installed and working
- [ ] Supabase CLI installed
- [ ] Supabase project created with URL + anon key noted
- [ ] Google OAuth configured in Supabase
- [ ] `~/.claude/settings.json` has broad permissions
- [ ] `~/.claude/keybindings.json` has Shift+Enter for newlines
- [ ] Project directory created with `git init`
- [ ] `REBUILD_SPEC.md` copied into project directory
- [ ] `.env` file created with Supabase credentials
