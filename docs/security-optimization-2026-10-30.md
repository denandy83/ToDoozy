# Security and sync optimization rollout

This change addresses the nonvisual findings from the combined October 26 audit.
Source changes are release candidates until the PR is merged, the desktop is
released and installed, and the two SQL migrations and MCP function are deployed.
Do not equate a local benchmark with production disk I/O.

## Coverage

| Audit references | Change |
| --- | --- |
| NAV-01 | Trusted-document preload and IPC checks, navigation/redirect/popup guards, sanitized timer descriptions. |
| DB-01–06 | Owner-bound sharing; confirmed-email invitation lookup/acceptance; scoped invitation policies and profile reads; explicit named API grants. Ordinary members can update appearance columns only, preventing role escalation. |
| TASK-01–05 | Recursive copies preserve references and completion; native copies roll back on failure. Parent validation rejects cycles and cross-project graphs. A prospective SQL trigger protects remote writes and restores too. |
| VIEW-01–02 | Saved-view counts apply due-date and assignee filters; the renderer applies included/excluded assignees. |
| DATE-01–03 | Monthly day/ordinal recurrence, local calendar date keys, local-day UTC boundaries, and local statistics grouping. |
| SYNC-01 | Pending queued tombstones and status-delete dependencies survive age-based cleanup. |
| STATE-01–03 | Account-owned caches/timers reset; stale hydration/mutation replies are fenced by account and database generation; attachment requests are ordered. |
| TIMER-01 | Interval updates subtract elapsed time, including delayed callbacks and automatic phase transitions. |
| MCP-01–04 | Stable complete pagination, query failures propagate, rejected/zero-row reorders fail, and release-note writes require a server administrator allowlist. |
| BOT-01–03 | Explicit service-role membership/owner scope, active-row filters, pagination, bounded recent queries and useful partial creation errors when label writes fail. |
| FILE-01–02 | Unique private attachment-open paths and recoverable removal with byte-preserving Undo. Deleted local attachments are purged after 30 days. |
| DEP-01 | Updated bot qs override/lockfile; production dependency audits checked separately. |

MCP multi-request copies/reorders can still be partly applied if a later network
write fails. Failures are reported; they are not advertised as transactions.
Copies preflight existing cycles before writing. The graph guard prevents new
invalid hierarchy changes and does not rewrite historical data.

Historical password-removal remediation needs trustworthy affected-account
evidence. Duplicate production label cleanup is a separate data operation, and
old clients can recreate those links. Neither is a synthetic test or an automatic
bulk data repair in this change. User-retired reports and `later` features remain
outside this work. No paid compute, Broadcast migration, or new cloud telemetry
table is required for these fixes.

## Benchmarks

Run the paired sync benchmark against the last merged source:

```sh
node scripts/benchmark-sync.cjs --baseline dea910d34d3a47de01e6398e4145377ae964d548 --output /private/path/sync-comparison.json
```

This executes actual sync effects and SDK calls against a synthetic transport,
using seven paired runs and a fixed 1 ms request delay. It records source hashes,
request counts, scheduling and timings. The baseline needs that Git object;
ordinary CI tests use portable fixtures and do not require repository history.

Observed request counts for 20 unchanged projects: 80 → 60; healthy fallback
timer traffic: 80 → 0; three reconnect flaps: 320 → 180; maximum concurrent
catch-up pulls: 3 → 1. Four archived projects reduce the initial 80 requests to
52. Background archived pulls read project metadata; explicit pulls retain full
reconciliation. See the dated report for paired timings and index measurements.

Local PGlite/Postgres query timings and cloud `pg_stat_io`/WAL snapshots are
separate evidence. The latter are cumulative database counters, not host disk or
swap throughput. A production host before/after comparison requires real Metrics
API samples, comparable workload, and the deployed candidate. Never infer disk
budget balance from request counts, cache hits, IOPS or disk busy time.

## Persistent diagnostics

The app records minute aggregates of its Supabase HTTP requests: allowlisted
route/method, request/error counts, time to response headers, declared response
Content-Length and unknown response sizes. It does not inspect response bodies,
record query values/tokens or count Realtime WebSocket messages. Declared bytes
are not measured wire throughput. Requests completing in a later interval are
counted in that interval.

`diagnostics.db` under Electron's userData stores at most 10,080 aggregates for
seven days, with file mode 0600. Recent history is restored into the Logs view.
This is local aggregate history; it does not upload logs or write to Supabase.

### Host I/O collector setup

1. Sign in to the Supabase dashboard and select the correct project. Locate an
   existing privileged secret/service-role key in its API-key settings. A public
   anon/publishable key cannot read privileged host metrics. Keep the credential
   in server-side Keychain or an existing private server env file; never paste it
   into a report, chat, renderer setting or committed file.
2. Determine the installed app's Electron userData directory. Use a private
   `host-metrics` subdirectory inside it. Run one collector on the monitoring Mac,
   not a separate collector per ToDoozy device.
3. With a Keychain item whose account is the project reference and service is
   your chosen private item name, run:

   ```sh
   python3 scripts/supabase_metrics.py --project-ref PROJECT_REF --output-dir '/path/to/userData/host-metrics' --keychain-service PRIVATE_ITEM_NAME
   ```

   Alternatively use `--env-file /private/server.env`, with
   `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`.
   Do not copy the key into a new plaintext file merely to run this command.
4. Take at least two successful samples, 60 seconds apart. The first counter
   sample has unknown rates. Inspect `host-latest.json` and the app's Logs view
   for timestamped summaries. Missing/reset counters remain unknown; scrape
   failures and samples older than three minutes are marked unavailable/stale.
5. For before/after measurement, preserve the timestamped SQLite sample history
   privately, record client versions and workload windows, deploy the reviewed
   candidate, and compare equally long observation windows. Do not load test
   production user data. A missing budget series stays unknown; use Studio's
   budget chart separately when needed.

The collector accepts only selected numeric series and approved device/CPU labels,
disables HTTP redirects, bounds responses/timeouts, enforces a finite interval
of at least 60 seconds, takes an exclusive lock and retains at most seven days /
10,080 samples. Whole-disk inventory is required to report physical disk rates;
partition counters are not added again. Credentials never cross into the app.
Install a background job only after the first real authenticated scrape succeeds.

Supabase's Metrics API is beta and metric names may change. Official references:
[Metrics API](https://supabase.com/docs/guides/observability/metrics),
[Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk),
[Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Deployment and verification

1. Complete the independent tests and `no-mistakes` review/test/lint/CI pipeline;
   merge the reviewed PR through the normal human gate.
2. Apply `20261030213612_security_performance_hardening.sql`, then
   `20261030221433_task_hierarchy_guard.sql`. These are prospective policy/grant,
   function and index changes; do not run rollback scripts that restore unsafe
   authorization. Validate catalog grants/policies and run Supabase advisors.
3. Deploy the MCP function with its imported modules. The default denies
   `set_whats_new`; configure `TODOOZY_RELEASE_ADMIN_IDS` server-side with only
   authorized release operators if that tool is needed.
4. Rebuild/restart the bot from the same source with its existing private
   configuration. Set `TODOOZY_TIME_ZONE` to the user's IANA timezone when the
   bot host timezone differs. Restart desktop clients on the released version;
   older clients retain their old sync behavior.
5. Verify only read-only production metadata/metrics. Behavioral authorization
   and mutation checks belong to isolated databases and synthetic accounts.
   Record exact deployed versions and take comparable host metric windows.

Checks: `npm run typecheck`, `npm test`, `npm run check:telegram-bot`,
`npm run lint`, `npm run build`, plus the independent database and sync fixtures.
