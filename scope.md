# Supabase Disk IO Optimization Plan

## The Problem
ToDoozy is depleting its Supabase free-tier Disk IO Budget with only 1-2 active users. The Nano compute (shared CPU, 0.5 GB RAM) has a baseline of ~87 IOPS. Once burst budget is consumed, the instance throttles hard — response times spike, CPU idles on IO wait, and the app becomes unresponsive.

---

## Real Data From Your Instance (as of 2026-04-14)

### Top Queries by Call Count (pg_stat_statements)

| Query | Calls | Total Time | Avg Time |
|-------|-------|-----------|----------|
| `realtime.list_changes()` (WAL decode) | **1,735,415** | 9,152s | 5.27ms |
| `realtime.list_changes()` (v2 w/ slot_changes) | **399,924** | 2,940s | 7.35ms |
| `set_config` (PostgREST request setup) | **277,692** | 55s | 0.20ms |
| `share_project` RPC | **10,355** | 59s | 5.75ms |
| Realtime subscription INSERT | **22,689** | 278s | 12.26ms |
| `pg_publication_tables` scan | **8,794** | 51s | 5.81ms |

**The #1 offender is Realtime WAL decoding at 2.1M calls consuming 12,092 seconds of DB time.**

### Table Statistics (Sequential Scans vs Index Scans)

| Table | Seq Scans | Index Scans | Live Rows | Updates | Inserts |
|-------|-----------|-------------|-----------|---------|---------|
| **project_members** | **1,998,396** | 12,367 | 13 | 11 | 47 |
| **projects** | **50,383** | 11,050 | 10 | **19,557** | 25 |
| **api_keys** | 1,580 | 103 | 2 | **832** | 3 |
| **statuses** | 945 | 47,488 | 31 | **7,746** | 76 |
| **release_notes** | 778 | 99 | 18 | 3 | 19 |
| tasks | 553 | 219,119 | 339 | **77,535** | 505 |

**project_members has 2 MILLION sequential scans for a 13-row table.** This is the 10s member polling loop doing full table scans every cycle.

**projects has 19,557 updates and 50K seq scans for a 10-row table.** The `share_project` RPC is called on every poll cycle for every shared project, needlessly updating the projects row.

### Dead Tuple Bloat

| Table | Dead Tuples | Live Tuples | Dead % |
|-------|-------------|-------------|--------|
| api_keys | 47 | 2 | 2,350% |
| user_project_areas | 16 | 2 | 800% |
| user_saved_views | 13 | 2 | 650% |
| project_members | 45 | 13 | 346% |
| projects | 25 | 10 | 250% |
| statuses | 25 | 31 | 81% |

Excessive dead tuples from constant updates without VACUUM = more disk pages to scan.

### Missing Indexes (Confirmed by Supabase Performance Advisor)

Unindexed foreign keys flagged:
- `activity_log.task_id` (shared_activity_log_task_id_fkey)
- `api_keys.user_id` (api_keys_user_id_fkey)
- `project_invites.invited_by` (shared_project_invites_invited_by_fkey)
- `statuses.project_id` → has basic index but NOT compound with `updated_at`
- `tasks.project_id` → has basic index but NOT compound with `updated_at`
- `task_labels.task_id` → only has composite PK (task_id, label_id), no standalone index

### Realtime Infrastructure

- 2 active replication slots (both logical)
- WAL level: logical (required for Realtime)
- Shared buffers: 224 MB (28672 x 8kB)
- Max connections: 60
- Work mem: 2,184 kB

### Checkpoint Frequency (from Postgres logs)

Checkpoints occurring every ~5 minutes, writing 9-50 buffers each. WAL distance of ~32-49 MB between checkpoints confirms constant write activity even when idle — driven by Realtime WAL processing.

### Security Issues Found

- **ERROR**: `user_profiles` view exposes `auth.users` to `anon` role
- **ERROR**: `user_profiles` is SECURITY DEFINER (runs as view creator, bypasses caller's RLS)
- **WARN**: 8 functions with mutable search_path (SQL injection risk)
- **WARN**: `release_notes` table has RLS policies that are always-true for both `authenticated` and `anon`
- **WARN**: Leaked password protection is disabled

---

## Root Cause Analysis

### Why is disk IO so high with 1-2 users?

The IO is NOT from user data volume (339 tasks, 10 projects — tiny). It's from:

1. **Realtime WAL decoding: 2.1M calls** — Every postgres_changes subscription forces Postgres to decode WAL entries. With multiple channels x multiple tables x RLS checks per event, this dominates.

2. **project_members sequential scans: 2M scans** — The 10-second polling loop does a full table scan on every tick. With 13 rows and no useful index, this is pure waste.

3. **share_project RPC: 10K calls** — Called on every 30s poll cycle for every shared project. This function does an INSERT ON CONFLICT + UPDATE on projects table, generating WAL entries and dead tuples even when nothing changed.

4. **Unfiltered task_labels Realtime** — Subscribes to ALL inserts across all users, forcing WAL decode for irrelevant events.

5. **Missing compound indexes** — Every incremental pull query (`updated_at > X`) scans all rows in the table instead of using an index seek.

---

## Supabase Best Practices (from docs + community research)

### Realtime vs Polling (industry consensus)
- Linear, Notion, ClickUp all use **WebSocket-first with HTTP fallback** — they don't poll alongside WebSockets
- Supabase Realtime is cheaper than polling at scale because it uses one WAL stream shared across subscribers vs N*M polling queries
- BUT: every postgres_changes event requires RLS authorization check per subscriber (100 users = 100 reads per insert)
- postgres_changes are processed on a single thread — compute upgrades don't help much
- Best practice: use filtered subscriptions, avoid unfiltered tables, consider separate "public" tables without RLS for high-scale scenarios

### Supabase High Disk IO Guide recommendations
- Check cache hit rate — low cache = all queries hit disk
- Optimize slow queries (>1s) — they use disk inefficiently
- Monitor swap usage — if RAM is exhausted, OS swaps to disk constantly
- Add proper indexes for frequently-queried columns
- Regular VACUUM to reclaim dead tuple space

### For Todo Apps Specifically
- Realtime for instant sync, polling only as fallback
- Batch writes where possible (don't push every keystroke)
- Subscribe to active context only (current project, not all projects)
- Use `updated_at` filters for incremental sync (already doing this, but needs indexes)

---

## The Plan

### PHASE 1: IMMEDIATE (Do Today) — ~80% IO Reduction

#### 1A. Add Missing Database Indexes

**Impact**: Converts full table scans to index seeks on every poll cycle.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_project_updated 
  ON tasks(project_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statuses_project_updated 
  ON statuses(project_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_labels_task 
  ON task_labels(task_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_labels_label 
  ON task_labels(label_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_owner 
  ON tasks(owner_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_log_task 
  ON activity_log(task_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_invites_invited_by 
  ON project_invites(invited_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_user 
  ON api_keys(user_id);
```

**Downside**: Marginal write overhead (~1%). Worth it.

#### 1B. Kill the 10-Second Member Polling Loop

**Impact**: Eliminates 2M+ sequential scans on project_members.

- **File**: `src/renderer/src/AppLayout.tsx:322`
- **Current**: `setInterval(() => loadMembers(selectedProject.id), 10_000)`
- **Change**: Remove entirely. Realtime subscription for `project_members` already handles this. Load members once on project switch + on Realtime callback.
- **Downside**: None.

#### 1C. Stop Calling share_project RPC on Every Poll Cycle

**Impact**: Eliminates 10K+ unnecessary RPC calls and project row updates.

- **File**: `src/renderer/src/services/PersonalSyncService.ts` (pullProjectMetadata)
- **Current**: `pullProjectMetadata()` calls `share_project` RPC every 30s for each project
- **Change**: Only call `share_project` when a project is first created or when the user explicitly changes project name/color/icon. Use a simple `SELECT` to check if metadata changed.
- **Downside**: None.

#### 1D. Increase Poll Interval + Make Realtime-Aware

**Impact**: Reduces poll queries from ~30/min to ~4/min (or 0 when Realtime is healthy).

- **File**: `src/renderer/src/App.tsx:138`
- **Current**: `setInterval(doPull, 30_000)` — always on
- **Change**: When Realtime is connected, disable polling entirely. When Realtime is disconnected, poll every 120s. On Realtime reconnect, do one immediate pull then stop.
- **Downside**: Max 2-minute delay for external changes when Realtime is down.

#### 1E. Remove Unfiltered task_labels Realtime Subscription

**Impact**: Stops WAL decoding for all task_label inserts across all users.

- **File**: `src/renderer/src/services/PersonalSyncService.ts:1190-1194`
- **Current**: Subscribes to ALL task_labels INSERTs with no filter
- **Change**: Remove subscription. Detect label changes via task's `updated_at` during normal task pull.
- **Downside**: Slight delay seeing label changes from external tools.

#### 1F. Run VACUUM on Bloated Tables

```sql
VACUUM ANALYZE api_keys;
VACUUM ANALYZE project_members;
VACUUM ANALYZE projects;
VACUUM ANALYZE user_project_areas;
VACUUM ANALYZE user_saved_views;
VACUUM ANALYZE statuses;
```

### PHASE 2: THIS WEEK — Additional ~10% IO Reduction

#### 2A. Fix N+1 in getSharedProjectMembers()
- **File**: `src/renderer/src/AppLayout.tsx:549-600`
- Use `.in('id', userIds)` batch query instead of per-member profile lookups.

#### 2B. Fix N+1 in pushTask() Label Resolution
- **File**: `src/renderer/src/services/PersonalSyncService.ts:113-128`
- Batch label resolution — fetch all labels for all tasks being pushed in one query.

#### 2C. Deduplicate Realtime Subscriptions ✅ DONE (2026-04-16)
- Added `personalChannels: Map<string, RealtimeChannel>` to PersonalSyncService with has-check before subscribing
- Split App.tsx effect so RT subscriptions depend only on `currentUser` (not `currentProjectId`) — eliminates teardown/recreate on every project switch
- Fixed invite channel name from `invites:${email}:${Date.now()}` to stable `invites:${email}`
- Added `unsubscribeAllPersonal()` for clean teardown at logout
- **Impact**: RT subscription INSERTs should drop from 464/hr back toward baseline (~16/hr); list_changes should drop proportionally

#### 2D. Debounce Settings Writes
- **File**: `src/renderer/src/services/PersonalSyncService.ts:245`
- Batch with 5-second debounce. Collect changed settings, push once.

#### 2E. Subscribe Only to Active Project (Personal)
- **File**: `src/renderer/src/services/PersonalSyncService.ts:1173-1205`
- Subscribe only to the currently active project. On project switch, unsubscribe old + subscribe new.

### PHASE 3: NEXT SPRINT — Architecture Improvements

#### 3A. Adaptive Polling Based on Realtime Health
Track Realtime connection state in syncStore. Healthy = no polling. Disconnected = poll at 60s. Reconnect = immediate pull + stop.

#### 3B. Batch Sync Queue Processing
- **File**: `src/renderer/src/services/SyncService.ts:281-300`
- Group queue entries by table, batch upsert per table.

#### 3C. Throttle Startup Sync
Only sync projects modified since `last_sync_at`. Skip `discoverRemoteMemberships` if last check was < 5 min ago.

#### 3D. Personal Project Activity Log — Local Only
Stop syncing activity_log to Supabase for personal projects. Only sync for shared projects.

---

## What to STOP / START / CHANGE

### STOP
- Polling members every 10 seconds (Realtime handles it; 2M unnecessary scans)
- Calling share_project RPC every poll cycle (10K+ unnecessary writes)
- Subscribing to unfiltered task_labels (WAL decodes for all users)
- Polling when Realtime is connected (redundant IO)
- N+1 querying user profiles and labels (batch instead)
- Double-subscribing shared projects (duplicate WAL processing)

### START
- Compound indexes on hot query paths
- Tracking Realtime connection health to toggle polling
- Batching Supabase writes (settings, labels)
- Regular VACUUM on frequently-updated tables
- Using `.in()` batch queries to eliminate N+1

### CHANGE
- Poll every 30s always → Poll 120s only when Realtime down (-90% poll queries)
- Member poll every 10s → Realtime only + load on switch (-100% member polls)
- share_project every poll → Only on create/metadata change (-99% RPC calls)
- Per-label queries in push → Batch `.in()` query (-80% label queries)
- All projects subscribed → Active project only (personal) (fewer WAL channels)
- Immediate settings push → 5s debounced batch (-90% settings writes)

---

## Estimated IO Reduction

| Change | Impact |
|--------|--------|
| Remove 10s member polling | ~25% |
| Stop share_project on poll | ~15% |
| Add indexes (reduce scan IO) | ~20% |
| Increase poll to 120s + RT gate | ~15% |
| Remove unfiltered task_labels RT | ~10% |
| Fix N+1 patterns | ~5% |
| Debounce settings | ~2% |
| **Total estimated reduction** | **~85-90%** |

## Scaling Impact

| Users | Current (queries/min) | After Optimization |
|-------|----------------------|-------------------|
| 1-2 | ~3,000+ | ~50-100 |
| 10 | Would kill instance | ~200-400 |
| 50 | Impossible | ~800-1500 |

---

## Security Fixes (from Supabase advisors)

1. Fix user_profiles view — Exposes auth.users to anon
2. Set search_path on 8 functions
3. Tighten release_notes RLS
4. Enable leaked password protection

---

## Verification

After Phase 1:
- Supabase Dashboard → Database Health → Disk IO Budget should stop depleting over 24h
- `pg_stat_statements` → realtime.list_changes calls should drop dramatically
- `pg_stat_user_tables` → project_members seq_scan count should stop growing
- Test: create task via Telegram bot → verify it appears in app within seconds (Realtime path)
- Test: kill network → restore → verify sync catches up
