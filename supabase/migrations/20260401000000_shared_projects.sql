-- Shared project collaboration tables with Row Level Security
-- All access enforced through shared_project_members membership

-- ── Shared Projects ─────────────────────────────────────────────────

CREATE TABLE shared_projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#888888',
  icon TEXT DEFAULT 'folder',
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shared_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view shared projects"
  ON shared_projects FOR SELECT
  USING (id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Owner can update shared projects"
  ON shared_projects FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Owner can insert shared projects"
  ON shared_projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can delete shared projects"
  ON shared_projects FOR DELETE
  USING (owner_id = auth.uid());

-- ── Shared Project Members ──────────────────────────────────────────

CREATE TABLE shared_project_members (
  project_id UUID NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

ALTER TABLE shared_project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project members"
  ON shared_project_members FOR SELECT
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Owner can add members"
  ON shared_project_members FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM shared_project_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Owner can remove members"
  ON shared_project_members FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM shared_project_members WHERE user_id = auth.uid() AND role = 'owner'
    )
    OR user_id = auth.uid()  -- Members can remove themselves
  );

-- ── Shared Project Invites ──────────────────────────────────────────

CREATE TABLE shared_project_invites (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shared_project_invites ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can validate an invite token
CREATE POLICY "Authenticated users can read invites"
  ON shared_project_invites FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Owner can create invites"
  ON shared_project_invites FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM shared_project_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Invite can be accepted"
  ON shared_project_invites FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (status = 'accepted' AND accepted_by = auth.uid());

-- ── Shared Statuses ─────────────────────────────────────────────────

CREATE TABLE shared_statuses (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#888888',
  icon TEXT DEFAULT 'circle',
  order_index INTEGER DEFAULT 0,
  is_done INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shared_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view shared statuses"
  ON shared_statuses FOR SELECT
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Owner can manage shared statuses"
  ON shared_statuses FOR ALL
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid() AND role = 'owner'));

-- ── Shared Tasks ────────────────────────────────────────────────────

CREATE TABLE shared_tasks (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  assigned_to UUID,
  title TEXT NOT NULL,
  description TEXT,
  status_id UUID NOT NULL REFERENCES shared_statuses(id),
  priority INTEGER DEFAULT 0,
  due_date TEXT,
  parent_id UUID REFERENCES shared_tasks(id) ON DELETE CASCADE,
  order_index INTEGER DEFAULT 0,
  is_template INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  completed_date TEXT,
  recurrence_rule TEXT,
  reference_url TEXT,
  label_names TEXT, -- JSON array of label name strings
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shared_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view shared tasks"
  ON shared_tasks FOR SELECT
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Members can create shared tasks"
  ON shared_tasks FOR INSERT
  WITH CHECK (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Members can update shared tasks"
  ON shared_tasks FOR UPDATE
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Members can delete shared tasks"
  ON shared_tasks FOR DELETE
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

-- ── Shared Activity Log ─────────────────────────────────────────────

CREATE TABLE shared_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shared_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view shared activity"
  ON shared_activity_log FOR SELECT
  USING (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

CREATE POLICY "Members can create activity entries"
  ON shared_activity_log FOR INSERT
  WITH CHECK (project_id IN (SELECT project_id FROM shared_project_members WHERE user_id = auth.uid()));

-- ── Indexes ─────────────────────────────────────────────────────────

CREATE INDEX idx_shared_tasks_project ON shared_tasks(project_id);
CREATE INDEX idx_shared_tasks_assigned ON shared_tasks(assigned_to);
CREATE INDEX idx_shared_tasks_parent ON shared_tasks(parent_id);
CREATE INDEX idx_shared_statuses_project ON shared_statuses(project_id);
CREATE INDEX idx_shared_activity_project ON shared_activity_log(project_id);
CREATE INDEX idx_shared_invites_project ON shared_project_invites(project_id);
CREATE INDEX idx_shared_invites_status ON shared_project_invites(status);

-- ── Realtime ────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE shared_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_statuses;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_project_members;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_activity_log;

-- ── Secure Invite Acceptance Function ──────────────────────────────
-- Runs as SECURITY DEFINER so it can insert into shared_project_members
-- without the caller needing direct INSERT permission.

CREATE OR REPLACE FUNCTION accept_invite(invite_token UUID)
RETURNS UUID AS $$
DECLARE
  v_project_id UUID;
  v_status TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Validate the invite
  SELECT project_id, status, expires_at
  INTO v_project_id, v_status, v_expires_at
  FROM shared_project_invites
  WHERE token = invite_token;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite token';
  END IF;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;
  IF v_expires_at < now() THEN
    -- Auto-mark as expired
    UPDATE shared_project_invites SET status = 'expired' WHERE token = invite_token;
    RAISE EXCEPTION 'Invite expired';
  END IF;

  -- Add user as member
  INSERT INTO shared_project_members (project_id, user_id, role)
  VALUES (v_project_id, auth.uid(), 'member')
  ON CONFLICT (project_id, user_id) DO NOTHING;

  -- Mark invite as accepted
  UPDATE shared_project_invites
  SET status = 'accepted', accepted_by = auth.uid()
  WHERE token = invite_token;

  RETURN v_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Expired Invite Cleanup Function ────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_expired_invites()
RETURNS void AS $$
BEGIN
  UPDATE shared_project_invites
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();

  DELETE FROM shared_project_invites
  WHERE status = 'expired' AND expires_at < now() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
