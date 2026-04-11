-- Update quick_add_task to look up API keys from api_keys table instead of user_settings
CREATE OR REPLACE FUNCTION public.quick_add_task(
  p_api_key TEXT,
  p_title TEXT,
  p_project_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_project_id UUID;
  v_project_name TEXT;
  v_status_id UUID;
  v_task_id UUID;
  v_default_project TEXT;
BEGIN
  -- Look up user by API key from api_keys table
  SELECT ak.user_id INTO v_user_id
  FROM api_keys ak
  WHERE ak.key = p_api_key;

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
  WHERE key = p_api_key;

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
