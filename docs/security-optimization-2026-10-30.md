# Security and sync optimization rollout

This change addresses the nonvisual findings from the combined October 26 audit.
Source changes are release candidates until the PR is merged, the desktop is
released and installed, and the three SQL migrations and MCP function are deployed.
Do not equate a local benchmark with production disk I/O.

## Coverage

| Audit references | Change |
| --- | --- |
| NAV-01 | Trusted-document preload and IPC checks, navigation/redirect/popup guards, sanitized timer descriptions. |
| DB-01–06 | Owner-bound sharing; confirmed-email invitation lookup/acceptance/decline and recipient notification reads; scoped invitation policies and profile reads; explicit named API grants. Ordinary members can update appearance columns only, preventing role escalation. |
| TASK-01–05 | Recursive copies preserve references and completion; native copies roll back on failure. Parent validation rejects cycles and cross-project graphs. Native and remote deletions tombstone the subtree; duplicate/template/recurrence copies publish all descendants and labels in ancestor order; prospective SQL triggers protect remote writes and ancestor-first restores. |
| VIEW-01–02 | Saved-view counts apply due-date and assignee filters; the renderer applies included/excluded assignees. |
| DATE-01–03 | Monthly day/ordinal recurrence, local calendar date keys, local-day UTC boundaries, and local statistics grouping. |
| SYNC-01 | Queued tombstones, FK prerequisites and cascade ancestors survive age-based cleanup until acknowledgment. |
| STATE-01–03 | Account-owned caches/timers reset; stale hydration/mutation replies are fenced by account and database generation; settings/themes and file-dialog/create continuations share that boundary; attachment requests are ordered. |
| TIMER-01 | Interval updates subtract elapsed time, including delayed callbacks and automatic phase transitions. |
| MCP-01–04 | Stable complete pagination, query failures propagate, rejected/zero-row reorders fail, and release-note writes require a server administrator allowlist. |
| BOT-01–03 | Explicit service-role membership/owner scope, active-row filters, pagination, bounded recent queries and useful partial creation errors when label writes fail. |
| FILE-01–02 | Unique private attachment-open paths and recoverable removal with byte-preserving Undo; local byte retention follows [PurgeService](../src/main/services/PurgeService.ts). |
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

Exact label-name lookups keep PostgreSQL's directional case matching. When a
candidate exists, a second owner-, ID- and exact-name-filtered read validates it
against the original escaped pattern before reuse or consolidation. This adds
one read per existing-label lookup (and per sync collision lookup); an absent
candidate still takes one read. A renamed, removed or unverifiable candidate
returns an error rather than creating or merging another identity. Recovery
junction reads are constrained by project, and known-project task-label imports
reuse their retained context; arbitrary task IDs use a bounded native bulk read.
These are app request/native transfer costs, not measured physical cloud I/O.

## Invitation response lifecycle

Invitation state and queued dialogs belong to their authenticated user. Reads,
validation, acceptance, decline, local hydration, navigation and subscriptions
retain their original account/database producer. Late replies cannot render old
private project/owner fields, clear another account's cache, change its view or
advance a newer invitation. Effect cleanup also closes a subscription whose
unsubscriber arrives late. A known same-account database replacement cancels the
old operation and rebinds the controller, rather than leaving a busy dialog stuck.

The security migration adds `decline_invite(uuid)`. A targeted decline requires
the caller's confirmed stored email, locks the invitation row like acceptance,
changes only its status and returns an explicit acknowledgement. Repeating an
acknowledged decline is safe. Wrong recipients and anonymous/unconfirmed callers
cannot consume it. Dismissing an untargeted public link returns `dismissed` without
revoking the reusable link. An expired-dialog OK action is local only. Backend
errors or ambiguous acknowledgements leave the current dialog available to retry;
stale errors never appear in another user's dialog. Invitation bearer tokens are
not logged in these response paths. Deploy the matching SQL before the new client.

The paired benchmark below covers the two App sync startup effects, not every
application startup effect: invitation discovery and updater/release-note work
are outside that cohort. Invitation lifecycle regressions separately exercise
actual service/SDK/native and rendered controller paths with synthetic users.

## Benchmarks

Run the paired sync benchmark against the last merged source:

```sh
node scripts/benchmark-sync.cjs --baseline dea910d34d3a47de01e6398e4145377ae964d548 --output /private/path/sync-comparison.json
```

The benchmark bundles the real App Realtime effect, sync services and repositories
at each Git revision. It uses isolated in-memory SQLite and the actual Supabase SDK
with an in-memory synthetic fetch transport; channel bindings/status callbacks are
simulated. Authentication, power state and external transport are controlled inputs.
Catch-up, membership reconciliation, project reads and store hydrations execute
without stubbing reconciliation. Both real App effects execute at each revision, including the separate historical
shared/init/reconcile startup path. Only its intentional two-second timer wait is
advanced; no catch-up implementation is stubbed. Release-note IPC traffic is
outside the Supabase transport boundary.
The fixture records request counts, declared synthetic response bytes, concurrency,
source hashes and timings with a fixed 1 ms request delay. It measures neither
physical cloud disk I/O nor production throughput.

Earlier saved observations used the previous project-only fixture. They do not
describe the expanded membership/user catch-up workload.
Regenerate paired results with this fixture before reporting new request savings.
The event scenario delivers the same remote task update through its real channel
among 20 projects and records HTTP bytes/counts plus local and remote writes.
No production workload or host metric collection is performed by the benchmark.

Automatic startup, resume, channel rejoin, health recovery and debounced project
refreshes share one serialized/coalesced scheduler. Routine events pull only their
affected projects; account-wide recovery retains authoritative membership and
user-table coverage. Canceled account/database jobs cannot abandon pending work
for a new context, and closed channel metadata callbacks cannot recreate channels. Authoritative memberships are
loaded before project enumeration; missing local-owner memberships do not discard
pending local data. Personal and shared channels rebind after archive/restore
metadata changes. Routine archived reconciliation reads metadata only; explicit
reconciliation retains tasks, statuses, activity and label coverage. See
[Recovery and diagnostics](../HELP.md#recovery-and-diagnostics) for the controls.

Local PGlite/Postgres query timings and cloud `pg_stat_io`/WAL snapshots are
separate evidence. The latter are cumulative database counters, not host disk or
swap throughput. A production host before/after comparison requires real Metrics
API samples, comparable workload, and the deployed candidate. Never infer disk
budget balance from request counts, cache hits, IOPS or disk busy time.
Live host before/after I/O remains unmeasured; authenticated collection and
comparable baseline/candidate deployment windows are still required.

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
History belongs to the OS user profile and is shared across app sign-ins; it is
not partitioned by Supabase account. Clearing the visible Logs list does not
delete the retained journal, whose recent entries return on restart.

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
2. Record the active desktop, MCP and bot versions, take the normal backup, and
   check read-only database health. Apply the prerequisite migrations in order:
   `20261030213612_security_performance_hardening.sql`, then
   `20261030221433_task_hierarchy_guard.sql`. These RPC/grant/hierarchy changes
   precede client features that depend on them. Validate catalog grants/policies
   and run Supabase advisors; do not restore unsafe authorization with rollback
   scripts.
3. Deploy the MCP function with its imported modules. The default denies
   `set_whats_new`; configure `TODOOZY_RELEASE_ADMIN_IDS` server-side with only
   authorized release operators if that tool is needed.
4. Rebuild/restart the bot from the same source with its existing private
   configuration. Set `TODOOZY_TIME_ZONE` to the user's IANA timezone when the
   bot host timezone differs. Release and install the matching desktop version
   containing recovery-copy remapping and legacy label-identity repair. Confirm
   the active client versions before applying the third migration,
   `20261031102321_label_junction_authorization.sql`: older clients can replay
   foreign label UUIDs during Keep Copy and the stricter guard correctly rejects
   those writes. This migration remains pending reviewed application; it was not
   deployed by source validation. Keep the first two migrations ahead of the
   desktop release, and the compatible desktop recovery ahead of this guard.
5. Verify only read-only production metadata/metrics. Behavioral authorization
   and mutation checks belong to isolated databases and synthetic accounts.
   Record exact deployed versions and take comparable host metric windows only
   after explicit privileged-key storage/use approval and collector setup.
   Physical host I/O remains unmeasured until authenticated samples from
   comparable deployed windows and client versions exist. No automatic merge,
   deployment, desktop installation or paid upgrade is authorized by these steps.

Checks: `npm run typecheck`, `npm test`, `npm run check:telegram-bot`,
`npm run lint`, `npm run build`, plus the independent database and sync fixtures.
