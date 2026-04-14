---
name: supabasecheck
description: Check Supabase Disk IO stats and compare against the pre-optimization baseline from 2026-04-14. Use when the user wants to check if optimizations are working, says "supabasecheck", "check supabase", "how's supabase doing", "disk io status".
---

# Supabase Performance Check

Compare current Supabase stats against the pre-optimization baseline captured on 2026-04-14 to verify that IO optimizations are working.

## Baseline (2026-04-14, pre-optimization)

```
KEY METRICS:
- realtime.list_changes() calls: 2,138,831
- realtime.list_changes() total DB time: 12,116s
- share_project RPC calls: 10,835
- Realtime subscription INSERTs: 22,689
- Index count: 29

TABLE IO (seq_scan / idx_scan / dead_tup):
- project_members: 2,000,324 / 12,848 / 45
- projects: 51,830 / 11,531 / 10
- api_keys: 1,625 / 103 / 13
- statuses: 945 / 48,449 / 25
- tasks: 558 / 220,081 / 23
- user_settings: 270 / 952 / 17

WRITE STATS:
- projects updates: 20,519
- tasks updates: 77,535
- statuses updates: 7,746
```

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

2. Compare each metric against the baseline above.

3. Calculate % change: `((current - baseline) / baseline * 100)`. Negative = improvement for scans/calls/dead_tup. Positive = improvement for index_count.

4. Present results as a markdown table:

```markdown
| Metric | Baseline | Current | Change |
|--------|----------|---------|--------|
| RT list_changes calls | 2,138,831 | X | -Y% |
| share_project RPC calls | 10,835 | X | -Y% |
| project_members seq_scans | 2,000,324 | X | -Y% |
| projects updates | 20,519 | X | -Y% |
| Index count | 29 | X | +Y% |
| Dead tuples (total) | ~200 | X | -Y% |
```

5. Flag any metric that got WORSE (increased calls/scans/dead_tup).

6. Provide a summary: "IO reduction estimate: ~X% based on query call reduction."

**Note:** `pg_stat_statements` and `pg_stat_user_tables` are cumulative since last stats reset. To get a clean comparison, you may need to reset stats first with `SELECT pg_stat_reset()` and check again after 24h. Warn the user if the stats haven't been reset since the optimization was deployed.
