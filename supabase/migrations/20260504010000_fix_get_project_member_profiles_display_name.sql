-- get_project_member_profiles was missing the user-set `display_name`
-- field as a preferred source. While the RPC was broken (42702 ambiguous
-- column bug, fixed in the previous migration), all calls fell through
-- to get_user_profiles, which DOES check display_name first. With the
-- 42702 bug fixed the RPC started returning the wrong (less-specific)
-- name. Align with get_user_profiles' COALESCE order.

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
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      NULL
    )::TEXT AS display_name
  FROM project_members pm
  JOIN auth.users au ON au.id = pm.user_id
  WHERE pm.project_id = p_project_id;
END;
$$;
