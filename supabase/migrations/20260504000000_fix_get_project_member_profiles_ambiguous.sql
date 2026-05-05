-- Fix: get_project_member_profiles was returning HTTP 400 for every call
-- with Postgres error 42702 ("column reference \"user_id\" is ambiguous").
--
-- Cause: RETURNS TABLE (user_id UUID, ...) declares an OUT parameter named
-- user_id. Inside the function body, the bare `user_id = auth.uid()` in
-- the membership check could refer to either the OUT parameter or the
-- project_members.user_id column. Postgres rejected the call.
--
-- Fix: qualify the column references with the `pm` table alias.

CREATE OR REPLACE FUNCTION get_project_member_profiles(p_project_id UUID)
RETURNS TABLE (
  user_id    UUID,
  email      TEXT,
  display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be a member of the project
  IF NOT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this project';
  END IF;

  RETURN QUERY
  SELECT
    pm.user_id,
    au.email::TEXT,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      NULL
    )::TEXT AS display_name
  FROM project_members pm
  JOIN auth.users au ON au.id = pm.user_id
  WHERE pm.project_id = p_project_id;
END;
$$;
