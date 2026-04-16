---
name: supabasecheck
description: Check Supabase Disk IO stats and compare against the pre-optimization baseline from 2026-04-14. Use when the user wants to check if optimizations are working, says "supabasecheck", "check supabase", "how's supabase doing", "disk io status".
---

# Supabase Performance Check

Compare current Supabase stats against the pre-optimization baseline captured on 2026-04-14 to verify that IO optimizations are working.

## Baseline — Average Hourly Rates (pre-optimization)

Calculated from 1,449 hours of cumulative stats (2026-02-12 to 2026-04-14) with 1-2 active users.

```
QUERY CALL RATES (avg/hour):
- realtime.list_changes() v1:  1,198/hr
- realtime.list_changes() v2:  278/hr
- share_project RPC:           7.5/hr
- set_config (PostgREST):      194/hr
- Realtime subscription INSERTs: 15.7/hr

TABLE SCAN RATES (avg/hour):
- project_members seq_scans:   1,380/hr
- projects seq_scans:          36/hr
- statuses seq_scans:          0.65/hr
- tasks seq_scans:             0.39/hr

WRITE RATES (avg/hour):
- projects updates:            14/hr
- tasks updates:               54/hr
- statuses updates:            5.3/hr
- user_settings updates:       0.58/hr

Index count: 29 (now 37 after optimization)
```

## Post-Optimization Table Stats Snapshot (2026-04-14 10:48 UTC)

Use this to calculate post-optimization deltas for table stats (subtract these from current values).

```
project_members: seq_scan=2,006,711 / idx_scan=37,396 / updates=11
projects: seq_scan=53,824 / idx_scan=12,032 / updates=21,507
tasks: seq_scan=576 / idx_scan=232,860 / updates=81,810
statuses: seq_scan=954 / idx_scan=50,440 / updates=8,120
user_settings: seq_scan=275 / idx_scan=964 / updates=851
api_keys: seq_scan=1,737 / idx_scan=103 / updates=910
```

**pg_stat_statements was reset on 2026-04-14 08:48 UTC** — so query stats start fresh from that point. Table stats (pg_stat_user_tables) could NOT be reset (permission denied on free tier) and are cumulative since 2026-02-12.

## Steps

1. Run these 4 queries against Supabase MCP (use `mcp__supabase__execute_sql`):

### Query 1: Table IO stats
```sql
SELECT relname AS table_name, seq_scan, idx_scan, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup
FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY seq_scan DESC;
```

### Query 2: Top queries by calls
```sql
SELECT query, calls, total_exec_time::numeric(12,2) AS total_ms, mean_exec_time::numeric(10,4) AS avg_ms, rows
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%' AND query NOT LIKE '%pg_catalog%'
ORDER BY calls DESC LIMIT 15;
```

### Query 3: Index count
```sql
SELECT count(*) AS index_count FROM pg_indexes WHERE schemaname = 'public';
```

### Query 4: Table sizes + dead tuples
```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_size, n_live_tup, n_dead_tup
FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC;
```

2. Calculate hours since `pg_stat_statements` reset (2026-04-14 08:48 UTC):
```sql
SELECT EXTRACT(EPOCH FROM (NOW() - '2026-04-14 08:48:47.191683+00'::timestamptz)) / 3600 AS hours_since_reset;
```

3. Divide current totals by hours to get **current rate/hour**.

4. Present results comparing current rates against pre-optimization baseline rates:

```markdown
| Metric | Pre-opt Rate/hr | Current Rate/hr | Change |
|--------|----------------|-----------------|--------|
| RT list_changes v1 | 1,198 | X | ? |
| RT list_changes v2 | 278 | X | ? |
| share_project RPC | 7.5 | X | ? |
| project_members seq_scans | 1,380 | X | ? |
| projects updates | 14 | X | ? |
| tasks updates | 54 | X | ? |
| Index count | 29 | 37 | +8 |
```

5. Flag any metric where the current rate **exceeds** the pre-optimization rate — that means something got worse.

6. Flag any rate that seems unreasonably high for the number of active users (e.g., >100 seq_scans/hr for a 13-row table).

7. Check dead tuples — report any table with dead_tup > live_tup (needs VACUUM).

8. Summary: Report overall health as one of:
   - **Healthy** — all rates below baseline, dead tuples low
   - **Improved but watch** — most rates down, one or two elevated
   - **Needs attention** — rates exceeding baseline or dead tuples accumulating

**Note:** Table stats (pg_stat_user_tables) are cumulative since 2026-02-12 and could NOT be reset (free tier restriction). Only `pg_stat_statements` (query stats) was reset on 2026-04-14 08:48 UTC. For table scan/update rates, subtract the baseline snapshot totals and divide by hours since baseline to get the post-optimization rate.
