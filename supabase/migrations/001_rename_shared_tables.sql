-- Migration: Rename shared_* tables to generic names + create user-scoped tables
-- Story #51: Supabase Full Sync Engine
-- Run this on the Supabase SQL editor or via MCP

-- ══════════════════════════════════════════════════════════════════════
-- 1. Rename shared_* tables to generic names
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS shared_projects RENAME TO projects;
ALTER TABLE IF EXISTS shared_tasks RENAME TO tasks;
ALTER TABLE IF EXISTS shared_statuses RENAME TO statuses;
ALTER TABLE IF EXISTS shared_project_members RENAME TO project_members;
ALTER TABLE IF EXISTS shared_activity_log RENAME TO activity_log;
ALTER TABLE IF EXISTS shared_project_invites RENAME TO project_invites;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Update RPC functions to use new table names
-- ══════════════════════════════════════════════════════════════════════

-- Re-create share_project function with new table names
CREATE OR REPLACE FUNCTION share_project(
  p_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_color text DEFAULT '#888888',
  p_icon text DEFAULT 'folder'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO projects (id, owner_id, name, description, color, icon, created_at, updated_at)
  VALUES (p_id, auth.uid(), p_name, p_description, p_color, p_icon, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    updated_at = now();

  INSERT INTO project_members (project_id, user_id, role, joined_at)
  VALUES (p_id, auth.uid(), 'owner', now())
  ON CONFLICT (project_id, user_id) DO NOTHING;
END;
$$;

-- Re-create accept_invite function with new table names
CREATE OR REPLACE FUNCTION accept_invite(invite_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id uuid;
  v_status text;
  v_expires_at timestamptz;
BEGIN
  SELECT project_id, status, expires_at
  INTO v_project_id, v_status, v_expires_at
  FROM project_invites
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;

  IF v_expires_at < now() THEN
    UPDATE project_invites SET status = 'expired' WHERE token = invite_token;
    RAISE EXCEPTION 'Invite expired';
  END IF;

  -- Add user as member
  INSERT INTO project_members (project_id, user_id, role, joined_at)
  VALUES (v_project_id, auth.uid(), 'member', now())
  ON CONFLICT (project_id, user_id) DO NOTHING;

  -- Mark invite as accepted
  UPDATE project_invites SET status = 'accepted' WHERE token = invite_token;

  RETURN v_project_id;
END;
$$;

-- Re-create validate_invite function with new table names
CREATE OR REPLACE FUNCTION validate_invite(invite_token uuid)
RETURNS TABLE(
  token uuid,
  project_id uuid,
  project_name text,
  owner_email text,
  expires_at timestamptz,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pi.token,
    pi.project_id,
    p.name as project_name,
    up.email as owner_email,
    pi.expires_at,
    pi.status
  FROM project_invites pi
  JOIN projects p ON p.id = pi.project_id
  JOIN user_profiles up ON up.id = p.owner_id
  WHERE pi.token = invite_token;
END;
$$;

-- Re-create get_pending_invites_for_email function with new table names
CREATE OR REPLACE FUNCTION get_pending_invites_for_email(user_email text)
RETURNS TABLE(
  token uuid,
  project_id uuid,
  project_name text,
  owner_email text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pi.token,
    pi.project_id,
    p.name as project_name,
    up.email as owner_email,
    pi.expires_at
  FROM project_invites pi
  JOIN projects p ON p.id = pi.project_id
  JOIN user_profiles up ON up.id = p.owner_id
  WHERE pi.target_email = lower(trim(user_email))
    AND pi.status = 'pending'
    AND pi.expires_at > now();
END;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 3. Create user-scoped tables for personal data sync
-- ══════════════════════════════════════════════════════════════════════

-- User settings (key-value pairs)
CREATE TABLE IF NOT EXISTS user_settings (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own settings" ON user_settings
  FOR ALL USING (user_id = auth.uid());

-- User labels
CREATE TABLE IF NOT EXISTS user_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#888888',
  order_index integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_labels_user ON user_labels(user_id);
ALTER TABLE user_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own labels" ON user_labels
  FOR ALL USING (user_id = auth.uid());
-- Allow service role (for Telegram bot) to bypass RLS
CREATE POLICY "Service role can manage all labels" ON user_labels
  FOR ALL USING (auth.role() = 'service_role');

-- User saved views
CREATE TABLE IF NOT EXISTS user_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filter_config text NOT NULL DEFAULT '{}',
  project_id uuid,
  sidebar_order integer NOT NULL DEFAULT 0,
  color text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_saved_views_user ON user_saved_views(user_id);
ALTER TABLE user_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own saved views" ON user_saved_views
  FOR ALL USING (user_id = auth.uid());

-- User project areas
CREATE TABLE IF NOT EXISTS user_project_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text,
  color text,
  sidebar_order integer NOT NULL DEFAULT 0,
  is_collapsed integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_project_areas_user ON user_project_areas(user_id);
ALTER TABLE user_project_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project areas" ON user_project_areas
  FOR ALL USING (user_id = auth.uid());

-- User themes
CREATE TABLE IF NOT EXISTS user_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'dark',
  bg text NOT NULL,
  fg text NOT NULL,
  accent text NOT NULL,
  surface text NOT NULL,
  muted text NOT NULL,
  border text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_themes_user ON user_themes(user_id);
ALTER TABLE user_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own themes" ON user_themes
  FOR ALL USING (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════
-- 4. Ensure task_labels junction table exists in Supabase (for bot)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS task_labels (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL,
  PRIMARY KEY (task_id, label_id)
);
-- Service role can write task_labels (for Telegram bot)
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage task labels" ON task_labels
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      JOIN tasks t ON t.project_id = pm.project_id
      WHERE t.id = task_labels.task_id AND pm.user_id = auth.uid()
    )
  );
CREATE POLICY "Service role can manage all task labels" ON task_labels
  FOR ALL USING (auth.role() = 'service_role');

-- ══════════════════════════════════════════════════════════════════════
-- 5. Enable Realtime on renamed tables
-- ══════════════════════════════════════════════════════════════════════

-- Note: Supabase may need Realtime re-enabled after table rename.
-- In the Supabase dashboard: Database → Replication → Enable for:
-- projects, tasks, statuses, project_members, activity_log, project_invites
