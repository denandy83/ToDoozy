# Telegram bot polling recovery

The candidate container and CI use Node 22.23.2. Node 22 is supported LTS; Node 20
is EOL ([official release table](https://nodejs.org/en/about/previous-releases)).
Generated `dist` output is excluded from root lint; source, tests and config remain
covered. Container-image build evidence must be recorded separately when a usable
local Docker daemon is available; package checks alone do not prove the image.

The bot uses the locked `node-telegram-bot-api` 0.66.0 API. The installed package's
`doc/api.md` documents `getWebHookInfo()`, `isPolling()`, `startPolling()` and
`stopPolling()`. Its `src/telegramPolling.js` is the compatibility reference:
`cancel:true` does not abort the old polling loop, so this bot never uses it.

The watchdog installs its error handlers before starting polling. Logs contain
fixed reason labels and recognized error/status codes, never raw transport
errors, request URLs, tokens or service keys. Fatal or repeated polling errors
stop gracefully, then retry with 5/10/20-second backoff (respecting Telegram's
bounded `retry_after`). Three unsuccessful recoveries exhaust the budget and the next recovery request
exits nonzero; ten minutes of healthy polling with an empty backlog replenishes
the budget.
Unauthorized/forbidden/conflicting consumers exit immediately for operator
attention and the existing Docker restart policy.

Successful public `getUpdates` responses supply a heartbeat, including empty
responses. Every minute the watchdog checks activity and calls `getWebHookInfo`.
Three minutes without a successful poll, three growing-backlog samples, or five
non-draining positive samples initiates recovery. A transient spike that drains
resets the counters. Monitor API failures/timeouts log safely and do not restart
an otherwise healthy poller. Requests have a 40-second transport timeout;
graceful stop has a separate 45-second deadline. An inactive consumer or failed
stop exits nonzero rather than starting an overlapping consumer. SIGINT/SIGTERM
cancel retry/monitor work and await graceful stop; compose allows 60 seconds.

From the repository root, install root dev dependencies and this package's
locked dependencies, then run `npm run check:telegram-bot`. This runs package
source/test typechecks, isolated executable tests against the real pinned
polling classes with synthetic clock/transport responses, and compilation.
The bot tests never load the production entrypoint's environment or Supabase
configuration and never contact Telegram. Root CI runs these package checks in
addition to desktop checks. The container builds with `npm ci` and prunes dev
dependencies. The test runner is the repository's pinned root Vitest.

## Reviewed rollout recipe (not executed)

This source change has not deployed the bot or changed server-side environment.
After the outer pipeline and independent exact-commit verification approve the
candidate, an authorized operator should:

1. On the existing bot server, use the existing compose project directory and
   server-side env file; do not copy secrets into source or command arguments.
   Record the current source commit, `docker compose images` output and the
   running container's image ID (`docker inspect --format '{{.Image}}'
   todoozy-telegram-bot`). Tag that image with a unique local rollback tag before
   replacing it. Preserve the existing server env file unchanged.
2. Check out the approved commit using the established deployment process.
   Build the existing `todoozy-telegram-bot` service with `docker compose build
   todoozy-telegram-bot`. Confirm build success before replacing the old service.
3. Stop the existing service with `docker compose stop todoozy-telegram-bot`,
   allowing its graceful stop deadline, then `docker compose up -d --no-deps
   todoozy-telegram-bot`. Do not run a second consumer alongside it.
4. Inspect status, restart count and sanitized logs. Verify healthy polling and
   stable/draining backlog using the established operational monitoring; a
   running Node/container alone is insufficient. Do not print credentials or
   dump container environment. Repeated exits require investigation of auth,
   conflicts, network or Telegram limits, not a tight manual restart loop.
5. If recovery or ordinary task handling regresses, stop the candidate first.
   Restore the recorded previous source revision and use a temporary compose
   override referencing the preserved rollback image, with no rebuild. Start
   only that existing service, retaining its original server-side env. Verify
   status and ordinary processing, and record that the watchdog fix is rolled
   back; the old silent-polling risk returns until a corrected candidate ships.

No desktop/MCP writer or pending SQL activation is included in bot deployment.
Their separately documented coordinated paused-writer rollout still applies.

## Dependency audit scope

The desktop and bot have separate manifests and lockfiles; audit both with
`npm audit` from the root and `npm --prefix packages/telegram-bot audit`, including
dev dependencies. The bot lock retains SDK 0.66.0 and uses the maintained Cypress
request implementation for both its injected transport and the legacy request
peer, with patched compatible form-data, qs, ws and uuid versions. Overrides are
compatibility constraints, not audit exclusions. Installed advisories do not by
themselves establish exploitation of the bot's used API paths. Repeat clean
`npm ci`, dependency-tree checks, both audits, bot checks and synthetic localhost
transport/production-pruned consumer checks before rollout. No live Telegram or
container deployment is implied by these checks.
