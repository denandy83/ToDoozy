-- ============================================================================
-- One-time heal: label-identity divergence (ToDoozy task d5b138b1)
-- ============================================================================
-- Run this in the Supabase SQL editor (service role — bypasses RLS) for the
-- affected user. It is the CLOUD half of the fix; the LOCAL SQLite half
-- self-heals on the next reconcile via the broadened consolidation push
-- (LabelRepository.consolidate driven by consolidateLocalLabel — see
-- syncTables.ts remoteUpsert / PersonalSyncService pushLabel).
--
-- WHAT IT DOES, scoped to the user's SOLO projects only (projects they own
-- whose membership is just themselves — never shared projects like
-- "Todoozy Bugs" / "Crewlounge", where per-member labels are legitimate):
--   for every task_label that points at a label owned by ANOTHER account
--   (the user's alt, andycassiers@gmail.com) while the user owns a clean
--   same-name canonical label:
--     1. ensure the canonical (task_id, canonical_label_id) link exists/active
--     2. soft-delete the stray (task_id, foreign_label_id) link
--   The foreign LABEL ROWS themselves are never touched (the alt account is
--   still used for testing and owns its own Personal/shared data).
--
-- Idempotent: re-running is a no-op once converged. Preview-first.
-- ----------------------------------------------------------------------------
-- Set the affected user once. (primary = andy.cassiers@gmail.com)
--   primary_id := '4cf29d6b-c208-4230-af6a-358a1e46c56e'
-- ============================================================================

-- ── Reusable scope CTE (used by every step below) ──────────────────────────
-- divergent(task_id, foreign_id, canonical_id, name) = the links to remap.

-- ----------------------------------------------------------------------------
-- STEP 0 — PREVIEW. Run this first; eyeball the names/counts. Expect the 10
-- labels from the task (Todoozy, Case Timeline LWC, Grilled, Later, YUMMY,
-- Obsidian Vault, Portal, newlabel, newest, Techlog). has_canonical must be
-- true for every row — a false means the user lacks a same-name canonical and
-- that name must be handled separately (create the canonical first).
-- ----------------------------------------------------------------------------
WITH params AS (SELECT '4cf29d6b-c208-4230-af6a-358a1e46c56e'::uuid AS primary_id),
solo AS (
  SELECT p.id
  FROM projects p CROSS JOIN params
  WHERE p.owner_id = params.primary_id
    AND (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id) = 1
),
divergent AS (
  SELECT tl.task_id, tl.label_id AS foreign_id, lf.name,
         can.id AS canonical_id
  FROM task_labels tl
  CROSS JOIN params
  JOIN tasks t ON t.id = tl.task_id AND t.project_id IN (SELECT id FROM solo)
  JOIN user_labels lf ON lf.id = tl.label_id
  LEFT JOIN user_labels can ON lower(can.name) = lower(lf.name)
        AND can.user_id = params.primary_id AND can.deleted_at IS NULL
  WHERE tl.deleted_at IS NULL
    AND lf.user_id <> params.primary_id
)
SELECT name, foreign_id, canonical_id, count(*) AS links,
       bool_and(canonical_id IS NOT NULL) AS has_canonical
FROM divergent
GROUP BY name, foreign_id, canonical_id
ORDER BY links DESC;

-- ----------------------------------------------------------------------------
-- STEP 1 — APPLY. Wrapped in a transaction so it's all-or-nothing. Only acts
-- on rows that HAVE a canonical (canonical_id IS NOT NULL); any name lacking a
-- canonical is left untouched and will still show up in STEP 2's verify.
-- ----------------------------------------------------------------------------
BEGIN;

WITH params AS (SELECT '4cf29d6b-c208-4230-af6a-358a1e46c56e'::uuid AS primary_id),
solo AS (
  SELECT p.id
  FROM projects p CROSS JOIN params
  WHERE p.owner_id = params.primary_id
    AND (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id) = 1
),
divergent AS (
  SELECT tl.task_id, tl.label_id AS foreign_id, can.id AS canonical_id
  FROM task_labels tl
  CROSS JOIN params
  JOIN tasks t ON t.id = tl.task_id AND t.project_id IN (SELECT id FROM solo)
  JOIN user_labels lf ON lf.id = tl.label_id
  JOIN user_labels can ON lower(can.name) = lower(lf.name)
        AND can.user_id = params.primary_id AND can.deleted_at IS NULL
  WHERE tl.deleted_at IS NULL
    AND lf.user_id <> params.primary_id
)
-- 1a. Ensure the canonical link exists & is active (revive a tombstone).
INSERT INTO task_labels (task_id, label_id, deleted_at)
SELECT DISTINCT task_id, canonical_id, NULL::timestamptz FROM divergent
ON CONFLICT (task_id, label_id) DO UPDATE SET deleted_at = NULL;

WITH params AS (SELECT '4cf29d6b-c208-4230-af6a-358a1e46c56e'::uuid AS primary_id),
solo AS (
  SELECT p.id
  FROM projects p CROSS JOIN params
  WHERE p.owner_id = params.primary_id
    AND (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id) = 1
),
divergent AS (
  SELECT tl.task_id, tl.label_id AS foreign_id, can.id AS canonical_id
  FROM task_labels tl
  CROSS JOIN params
  JOIN tasks t ON t.id = tl.task_id AND t.project_id IN (SELECT id FROM solo)
  JOIN user_labels lf ON lf.id = tl.label_id
  JOIN user_labels can ON lower(can.name) = lower(lf.name)
        AND can.user_id = params.primary_id AND can.deleted_at IS NULL
  WHERE tl.deleted_at IS NULL
    AND lf.user_id <> params.primary_id
)
-- 1b. Soft-delete the stray foreign link now that the canonical one is active.
UPDATE task_labels tl
SET deleted_at = now()
FROM divergent d
WHERE tl.task_id = d.task_id AND tl.label_id = d.foreign_id AND tl.deleted_at IS NULL;

-- Inspect the row counts in the two statements above, then:
COMMIT;
-- (ROLLBACK; instead if anything looks wrong.)

-- ----------------------------------------------------------------------------
-- STEP 2 — VERIFY. Re-run STEP 0's preview. Expect ZERO rows. Then sign in on
-- the desktop app and confirm `Reconcile: labels … failed=0`.
-- ----------------------------------------------------------------------------
