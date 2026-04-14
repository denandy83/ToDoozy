-- Compound indexes for incremental pull queries (WHERE project_id = ? AND updated_at > ?)
CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_statuses_project_updated ON statuses(project_id, updated_at);

-- Foreign key indexes flagged by Supabase performance advisor
CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_task ON activity_log(task_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_created_by ON project_invites(created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
