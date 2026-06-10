-- Story #91: per-user Realtime channel + activity_log incremental pulls.
--
-- The user-scoped tables were polling/reconcile-only and were never added to
-- the supabase_realtime publication — without this, the new `user:${userId}`
-- channel subscribes successfully but receives zero events.
-- (project_members / activity_log / tasks / statuses inherited publication
-- membership from the shared_* table renames and need no change.)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_labels;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_saved_views;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_project_areas;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Compound indexes for the user-channel reconcile cursors and the
-- (project_id, created_at) incremental activity_log sweep.
-- task_labels(task_id) already exists (20260414000000_add_performance_indexes).
CREATE INDEX IF NOT EXISTS idx_user_labels_user_updated ON user_labels(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_saved_views_user_updated ON user_saved_views(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_project_areas_user_updated ON user_project_areas(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_project_created ON activity_log(project_id, created_at);
