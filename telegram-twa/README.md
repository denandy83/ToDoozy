# ToDoozy Telegram Web App (TWA)

A Telegram Mini App that displays your ToDoozy tasks with full details — statuses, priorities, labels, due dates, descriptions, and subtasks.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Telegram App                               │
│  ┌───────────────────────────────────────┐  │
│  │  ToDoozy TWA (React SPA)              │  │
│  │  - Project selector                   │  │
│  │  - Task list grouped by status        │  │
│  │  - Task detail with subtasks          │  │
│  └──────────────┬────────────────────────┘  │
│                 │                            │
└─────────────────┼────────────────────────────┘
                  │ HTTPS
      ┌───────────▼───────────┐
      │  Express Server       │  ← Raspberry Pi / Portainer
      │  - Serves SPA         │
      │  - Validates initData │
      │  - Links TG accounts  │
      └───────────┬───────────┘
                  │
      ┌───────────▼───────────┐
      │  Supabase             │
      │  - shared_tasks       │
      │  - shared_projects    │
      │  - shared_statuses    │
      │  - auth.users         │
      └───────────────────────┘
```

## Data Source

The TWA reads from Supabase **shared project** tables. This means:
- **Shared projects** appear automatically in the TWA
- **Personal/local-only projects** are not visible (they live in your local SQLite only)
- To see a project in the TWA, share it in the ToDoozy desktop app (you can share it with just yourself)

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_SUPABASE_URL` | Your Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key | Yes |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from @BotFather | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for auto-login after linking) | Optional |
| `PORT` | Server port (default: 3100) | No |

### 2. Deploy with Docker (Portainer)

#### Option A: Docker Compose (recommended)

1. Clone or copy the `telegram-twa/` directory to your Raspberry Pi
2. Create `.env` with your credentials
3. Run:

```bash
cd telegram-twa
docker compose up -d --build
```

#### Option B: Portainer Stack

1. In Portainer, go to **Stacks → Add Stack**
2. Paste the contents of `docker-compose.yml`
3. Add environment variables in the **Environment variables** section
4. Deploy

#### Option C: Build and Run Manually

```bash
npm install
npm run build:all
PORT=3100 node dist-server/index.js
```

### 3. Configure Your Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Select your existing bot
3. Send `/setmenubutton`
4. Choose your bot
5. Send the URL: `https://your-pi-domain:3100` (must be HTTPS)
6. Set the button text: `Tasks`

> **HTTPS required**: Telegram requires HTTPS for Web Apps. Use a reverse proxy
> (Caddy, nginx + Let's Encrypt, Cloudflare Tunnel) in front of port 3100.

### 4. First-Time Login

1. Open your bot in Telegram and tap the **Tasks** menu button
2. The TWA opens and shows a login form
3. Sign in with your **ToDoozy email/password** (same as the desktop app)
4. Your Telegram account is automatically linked
5. Next time you open the TWA, you'll be signed in automatically (if `SUPABASE_SERVICE_ROLE_KEY` is configured)

## Development

```bash
cd telegram-twa
npm install
npm run dev
```

The dev server runs on `http://localhost:5210`. For testing the Telegram WebApp integration locally, use [ngrok](https://ngrok.com/) or a similar tunnel to get an HTTPS URL.

## Features

- **Project selector** — switch between your shared projects
- **Task list** — tasks grouped by status with priority badges, due dates, and labels
- **Task detail** — full task view with description, subtasks, metadata
- **Telegram theme** — adapts to the user's Telegram light/dark theme
- **Telegram back button** — native navigation in the task detail view
- **Pull-to-refresh** — tap the refresh button to reload tasks

## Reverse Proxy Example (Caddy)

If you're using Caddy on your Pi for HTTPS:

```
todoozy.yourdomain.com {
    reverse_proxy localhost:3100
}
```

## Reverse Proxy Example (nginx)

```nginx
server {
    listen 443 ssl;
    server_name todoozy.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
