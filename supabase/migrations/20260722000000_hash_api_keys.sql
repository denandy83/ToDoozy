-- Story #98 — Hash API keys at rest (security-migration)
--
-- Replaces the plaintext `api_keys.key` column with a SHA-256 hash so the raw
-- key is never stored or compared in plaintext. Existing keys keep working: the
-- backfill hashes the current plaintext with the SAME algorithm the MCP edge
-- function (supabase/functions/mcp/hash.ts) and the Integrations settings UI
-- (src/shared/hashApiKey.ts) use — SHA-256, lowercase hex — so for any presented
-- key, hash(key) == the stored key_hash.
--
-- ############################################################################
-- ##  HUMAN-GATED — DO NOT AUTO-APPLY.                                       ##
-- ##  This migration is DESTRUCTIVE (it DROPs the plaintext `key` column).   ##
-- ##  A human must, TOGETHER (they are interdependent):                      ##
-- ##    1. Apply this migration to the live project.                         ##
-- ##    2. Deploy the edge function:  supabase functions deploy mcp          ##
-- ##    3. Ship the desktop app build that hashes on the key-creation path.  ##
-- ##  Once `key` is dropped, any client still reading/writing the plaintext  ##
-- ##  column stops working. MCP + iOS Shortcut + Telegram quick-add auth     ##
-- ##  keep working across the cutover because they match the backfilled hash.##
-- ############################################################################

-- pgcrypto provides digest(). On Supabase it lives in the `extensions` schema;
-- IF NOT EXISTS is a safe no-op when it is already enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- Ensure digest()/encode() resolve whether pgcrypto is installed in
-- `extensions` (Supabase default) or `public` (self-hosted / dev copies).
SET LOCAL search_path = public, extensions;

-- 1. Add the hash column (nullable during backfill).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_hash text;

-- 2. Backfill from the existing plaintext key (SHA-256, lowercase hex).
UPDATE api_keys
SET key_hash = encode(digest(key, 'sha256'), 'hex')
WHERE key IS NOT NULL AND key_hash IS NULL;

-- 3. Every existing row had a NOT NULL key, so every row now has a hash.
ALTER TABLE api_keys ALTER COLUMN key_hash SET NOT NULL;

-- 4. Move the uniqueness/index guarantee from `key` to `key_hash`.
DROP INDEX IF EXISTS idx_api_keys_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- 5. Remove the plaintext column entirely (also drops its UNIQUE constraint).
ALTER TABLE api_keys DROP COLUMN IF EXISTS key;

COMMIT;

-- 6. Recompile quick_add_task (iOS Shortcut / Telegram quick-add) to look the
--    caller up by hash instead of the now-removed plaintext column. Signature
--    and behavior are otherwise unchanged. The user_settings legacy fallback is
--    left intact — that separate plaintext store is out of scope for this story.
CREATE OR REPLACE FUNCTION public.quick_add_task(
  p_api_key TEXT,
  p_title TEXT,
  p_project_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_project_id UUID;
  v_project_name TEXT;
  v_status_id UUID;
  v_task_id UUID;
  v_default_project TEXT;
  v_key_hash TEXT;
BEGIN
  -- Hash the presented key once and look the user up by hash.
  v_key_hash := encode(digest(p_api_key, 'sha256'), 'hex');

  SELECT ak.user_id INTO v_user_id
  FROM api_keys ak
  WHERE ak.key_hash = v_key_hash;

  IF v_user_id IS NULL THEN
    -- Fallback: check user_settings for backward compatibility
    SELECT us.user_id INTO v_user_id
    FROM user_settings us
    WHERE us.key = 'api_key' AND us.value = p_api_key::text;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid API key');
  END IF;

  -- Increment request count on api_keys
  UPDATE api_keys SET request_count = request_count + 1, last_used_at = now()
  WHERE key_hash = v_key_hash;

  -- Determine project
  IF p_project_name IS NOT NULL THEN
    SELECT p.id, p.name INTO v_project_id, v_project_name
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = v_user_id
      AND lower(p.name) = lower(p_project_name)
    LIMIT 1;
  END IF;

  IF v_project_id IS NULL THEN
    -- Check iOS shortcut default project first
    SELECT us.value INTO v_default_project
    FROM user_settings us
    WHERE us.user_id = v_user_id AND us.key = 'ios_shortcut_default_project';

    IF v_default_project IS NOT NULL AND v_default_project != 'follow_telegram' THEN
      SELECT p.id, p.name INTO v_project_id, v_project_name
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = v_user_id
        AND lower(p.name) = lower(v_default_project)
      LIMIT 1;
    END IF;
  END IF;

  IF v_project_id IS NULL THEN
    -- Check telegram default project
    SELECT us.value INTO v_default_project
    FROM user_settings us
    WHERE us.user_id = v_user_id AND us.key = 'telegram_default_project';

    IF v_default_project IS NOT NULL THEN
      SELECT p.id, p.name INTO v_project_id, v_project_name
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = v_user_id
        AND lower(p.name) = lower(v_default_project)
      LIMIT 1;
    END IF;
  END IF;

  IF v_project_id IS NULL THEN
    -- Fall back to first owned project
    SELECT p.id, p.name INTO v_project_id, v_project_name
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = v_user_id AND pm.role = 'owner'
    ORDER BY p.sidebar_order
    LIMIT 1;
  END IF;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No project found');
  END IF;

  -- Get default status
  SELECT s.id INTO v_status_id
  FROM statuses s
  WHERE s.project_id = v_project_id AND s.is_default = 1
  LIMIT 1;

  IF v_status_id IS NULL THEN
    SELECT s.id INTO v_status_id
    FROM statuses s
    WHERE s.project_id = v_project_id
    ORDER BY s.order_index
    LIMIT 1;
  END IF;

  IF v_status_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No status found for project');
  END IF;

  -- Create task
  v_task_id := gen_random_uuid();
  INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, created_at, updated_at)
  VALUES (v_task_id, v_project_id, v_user_id, p_title, v_status_id, 0, now(), now());

  RETURN jsonb_build_object(
    'task_id', v_task_id,
    'project_id', v_project_id,
    'project_name', v_project_name,
    'title', p_title
  );
END;
$$;
