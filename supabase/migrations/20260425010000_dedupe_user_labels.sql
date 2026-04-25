-- Deduplicate user_labels rows that differ only by capitalization (e.g. "Bug",
-- "bug") or are exact-name duplicates created by races in the create-or-find
-- pattern. Pick a canonical row per (user_id, lower(name)) — the one with the
-- most associated task_labels — then rewrite task_labels to point at it and
-- delete the duplicates. Finally, add a unique index to prevent regressions.
--
-- The renderer's `pullNewTasks` already remaps task_labels at read time so
-- existing user data is intact even before this migration runs; this migration
-- collapses the server-side state so future pulls don't keep re-remapping.

BEGIN;

-- Step 1: rank duplicates per (user_id, lower(name)) by task_labels count, then
-- by created_at as a tiebreaker (oldest wins).
CREATE TEMP TABLE label_dedup_plan ON COMMIT DROP AS
WITH counts AS (
  SELECT
    l.id,
    l.user_id,
    l.name,
    LOWER(l.name) AS lname,
    l.created_at,
    (SELECT COUNT(*) FROM task_labels tl WHERE tl.label_id = l.id) AS uses
  FROM user_labels l
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lname
      ORDER BY uses DESC, created_at ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lname
      ORDER BY uses DESC, created_at ASC
    ) AS canonical_id
  FROM counts
)
SELECT id AS duplicate_id, canonical_id, user_id, name
FROM ranked
WHERE rn > 1;

-- Step 2: rewrite task_labels to point at the canonical label. Use ON CONFLICT
-- DO NOTHING because (task_id, canonical_id) may already exist if both the
-- duplicate and the canonical were attached to the same task.
INSERT INTO task_labels (task_id, label_id)
SELECT tl.task_id, p.canonical_id
FROM task_labels tl
JOIN label_dedup_plan p ON p.duplicate_id = tl.label_id
ON CONFLICT (task_id, label_id) DO NOTHING;

DELETE FROM task_labels tl
USING label_dedup_plan p
WHERE tl.label_id = p.duplicate_id;

-- Step 3: delete the duplicate user_labels rows.
DELETE FROM user_labels l
USING label_dedup_plan p
WHERE l.id = p.duplicate_id;

-- Step 4: prevent future duplicates. lower(name) makes "Bug"/"bug" collide.
CREATE UNIQUE INDEX IF NOT EXISTS user_labels_user_name_unique
  ON user_labels (user_id, LOWER(name));

COMMIT;

-- Note: projects.label_data is a denormalized JSON snapshot of label metadata
-- (name, color) per project. It does not store label IDs, so dedup does not
-- need to rewrite it — the next pushTask from any client will refresh it.
