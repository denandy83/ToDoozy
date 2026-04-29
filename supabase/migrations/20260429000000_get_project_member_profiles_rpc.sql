-- RPC: get_project_member_profiles
--
-- Background: user_profiles is a VIEW that does not return rows for
-- email/password users — only Google OAuth users have visible rows.
-- This means project members who signed up with email/password appear as
-- "Unknown" in the avatar strip. Root cause is unknown (may be missing
-- rows in the underlying profiles table, or RLS on the view).
--
-- Fix: bypass user_profiles entirely and read directly from auth.users
-- using SECURITY DEFINER. Only members of the given project can call
-- this function (security check on project_members). Returns real email
-- for ALL auth providers and display_name from OAuth metadata where available.

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
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id AND user_id = auth.uid()
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
