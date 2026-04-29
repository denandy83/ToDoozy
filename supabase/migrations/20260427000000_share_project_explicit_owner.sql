-- Migration: share_project RPC accepts optional p_owner_id
--
-- Background: the MCP edge function authenticates via API key and uses the
-- service-role client, which has no JWT. auth.uid() is NULL inside the RPC,
-- which made create_project fail with NOT NULL on projects.owner_id.
--
-- Fix: take an optional p_owner_id and COALESCE with auth.uid(). Renderer
-- callers that rely on auth.uid() are unaffected; the MCP path passes the
-- userId resolved from the API key.

CREATE OR REPLACE FUNCTION share_project(
  p_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_color text DEFAULT '#888888',
  p_icon text DEFAULT 'folder',
  p_owner_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner uuid := COALESCE(p_owner_id, auth.uid());
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'share_project: owner_id required (no auth.uid() and no p_owner_id provided)';
  END IF;

  INSERT INTO projects (id, owner_id, name, description, color, icon, created_at, updated_at)
  VALUES (p_id, v_owner, p_name, p_description, p_color, p_icon, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    updated_at = now();

  INSERT INTO project_members (project_id, user_id, role, joined_at)
  VALUES (p_id, v_owner, 'owner', now())
  ON CONFLICT (project_id, user_id) DO NOTHING;
END;
$$;
