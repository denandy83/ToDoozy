-- Drop the old share_project overload (without p_owner_id) that caused PGRST203
-- ambiguity after the 20260427 migration added the p_owner_id variant.
DROP FUNCTION IF EXISTS public.share_project(uuid, text, text, text, text);
