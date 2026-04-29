-- RPC: get_user_profiles
--
-- General-purpose SECURITY DEFINER function that reads user profile data
-- directly from auth.users for an arbitrary list of user IDs.
--
-- Background: the user_profiles VIEW is defined over auth.users, but the
-- authenticated role does not have SELECT on auth.users, so every REST
-- query to the view returns 403. All places in the app that queried
-- user_profiles directly have been replaced with calls to this function.
--
-- Returns email for ALL auth providers (Google OAuth and email/password).
-- display_name and avatar_url come from raw_user_meta_data, which is
-- populated by OAuth providers (Google sets full_name/picture) but is
-- empty for email/password signups (display_name/avatar_url will be NULL).

CREATE OR REPLACE FUNCTION get_user_profiles(p_user_ids UUID[])
RETURNS TABLE (
  id           UUID,
  email        TEXT,
  display_name TEXT,
  avatar_url   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    au.email::TEXT,
    COALESCE(
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      NULL
    )::TEXT AS display_name,
    COALESCE(
      au.raw_user_meta_data->>'avatar_url',
      au.raw_user_meta_data->>'picture',
      NULL
    )::TEXT AS avatar_url
  FROM auth.users au
  WHERE au.id = ANY(p_user_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_profiles(UUID[]) TO authenticated;
