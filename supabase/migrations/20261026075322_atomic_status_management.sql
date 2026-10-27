-- All MCP status mutations are serialized and transactional. The MCP service
-- role supplies its authenticated caller; browser callers may only name themselves.
CREATE OR REPLACE FUNCTION public.manage_project_status(
  p_project_id uuid, p_actor uuid, p_action text, p_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  current_status public.statuses%ROWTYPE;
  target_status public.statuses%ROWTYPE;
  result jsonb;
  ids uuid[];
  next_done integer;
  next_default integer;
  next_order integer;
  status_name text;
  changed_at timestamptz;
  completed_at text;
BEGIN
  IF p_actor IS NULL OR (current_user NOT IN ('postgres', 'service_role') AND p_actor IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Invalid status actor';
  END IF;
  PERFORM 1 FROM public.projects WHERE id = p_project_id AND owner_id = p_actor AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the project owner can manage statuses'; END IF;
  -- Lock existing rows too: concurrent direct edits must not be overwritten.
  PERFORM 1 FROM public.statuses WHERE project_id = p_project_id ORDER BY id FOR UPDATE;

  changed_at := clock_timestamp();
  -- completed_date is text in the deployed schema; match the app's ISO UTC format.
  completed_at := to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  IF p_action = 'reorder' THEN
    SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_input->'status_ids');
    IF coalesce(cardinality(ids), 0) = 0
       OR cardinality(ids) <> (SELECT count(*) FROM public.statuses WHERE project_id = p_project_id AND deleted_at IS NULL)
       OR cardinality(ids) <> (SELECT count(DISTINCT id) FROM unnest(ids) AS x(id))
       OR EXISTS (SELECT 1 FROM unnest(ids) AS x(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.statuses s WHERE s.id = x.id AND s.project_id = p_project_id AND s.deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'Provide every active project status exactly once';
    END IF;
    UPDATE public.statuses s SET order_index = x.position - 1, updated_at = changed_at
    FROM unnest(ids) WITH ORDINALITY AS x(id, position)
    WHERE s.id = x.id AND s.project_id = p_project_id AND s.deleted_at IS NULL;
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.order_index) INTO result FROM public.statuses s
      WHERE s.project_id = p_project_id AND s.deleted_at IS NULL;
    RETURN result;
  ELSIF p_action = 'ensure' THEN
    SELECT coalesce(max(order_index), -1) + 1 INTO next_order FROM public.statuses WHERE project_id = p_project_id AND deleted_at IS NULL;
    result := '[]'::jsonb;
    FOR status_name IN SELECT btrim(value) FROM jsonb_array_elements_text(p_input->'names') LOOP
      IF status_name <> '' AND NOT EXISTS (SELECT 1 FROM public.statuses WHERE project_id = p_project_id
          AND deleted_at IS NULL AND lower(btrim(name)) = lower(status_name)) THEN
        INSERT INTO public.statuses(id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
        VALUES (gen_random_uuid(), p_project_id, status_name, '#888888', 'circle', next_order, 0, 0, changed_at, changed_at)
        RETURNING * INTO current_status;
        result := result || jsonb_build_array(to_jsonb(current_status));
        next_order := next_order + 1;
      END IF;
    END LOOP;
    RETURN jsonb_build_object('created', result, 'created_count', jsonb_array_length(result));
  ELSIF p_action = 'create' THEN
    status_name := btrim(p_input->>'name');
    IF coalesce(status_name, '') = '' THEN RAISE EXCEPTION 'Status name cannot be blank'; END IF;
    next_done := CASE WHEN p_input->>'is_done' IN ('true', '1') THEN 1 ELSE 0 END;
    next_default := CASE WHEN p_input->>'is_default' IN ('true', '1') THEN 1 ELSE 0 END;
    IF next_default = 1 AND EXISTS (SELECT 1 FROM public.statuses WHERE project_id = p_project_id AND is_default = 1 AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'There can only be one default status';
    END IF;
    IF next_done = 1 AND EXISTS (SELECT 1 FROM public.statuses WHERE project_id = p_project_id AND is_done = 1 AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'There can only be one done status';
    END IF;
    SELECT coalesce(max(order_index), -1) + 1 INTO next_order FROM public.statuses WHERE project_id = p_project_id AND deleted_at IS NULL;
    INSERT INTO public.statuses(id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
    VALUES ((p_input->>'id')::uuid, p_project_id, status_name, coalesce(p_input->>'color', '#888888'),
      coalesce(p_input->>'icon', 'circle'), coalesce((p_input->>'order_index')::integer, next_order), next_done, next_default, changed_at, changed_at)
    RETURNING * INTO current_status;
    RETURN to_jsonb(current_status);
  END IF;

  SELECT * INTO current_status FROM public.statuses WHERE id = (p_input->>'id')::uuid AND project_id = p_project_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Status not found'; END IF;
  IF p_action = 'update' THEN
    status_name := CASE WHEN p_input ? 'name' THEN btrim(p_input->>'name') ELSE current_status.name END;
    IF coalesce(status_name, '') = '' THEN RAISE EXCEPTION 'Status name cannot be blank'; END IF;
    next_done := CASE WHEN NOT p_input ? 'is_done' THEN current_status.is_done
      WHEN p_input->>'is_done' IN ('true', '1') THEN 1 ELSE 0 END;
    IF current_status.is_done = 1 AND next_done = 0 THEN RAISE EXCEPTION 'The done status must be retained'; END IF;
    IF next_done = 1 AND EXISTS (SELECT 1 FROM public.statuses WHERE project_id = p_project_id AND id <> current_status.id AND is_done = 1 AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'There can only be one done status';
    END IF;
    UPDATE public.statuses SET name = status_name, color = coalesce(p_input->>'color', current_status.color),
      icon = coalesce(p_input->>'icon', current_status.icon), order_index = coalesce((p_input->>'order_index')::integer, current_status.order_index),
      is_done = next_done, updated_at = changed_at WHERE id = current_status.id RETURNING to_jsonb(statuses.*) INTO result;
    IF next_done IS DISTINCT FROM current_status.is_done THEN
      UPDATE public.tasks SET completed_date = CASE WHEN next_done = 1 THEN completed_at ELSE NULL END,
        updated_at = changed_at WHERE project_id = p_project_id AND status_id = current_status.id AND deleted_at IS NULL;
    END IF;
    RETURN result;
  ELSIF p_action = 'delete' THEN
    IF current_status.is_done = 1 OR current_status.is_default = 1 THEN RAISE EXCEPTION 'Default and done statuses must be retained'; END IF;
    SELECT * INTO target_status FROM public.statuses WHERE id = (p_input->>'target_id')::uuid
      AND project_id = p_project_id AND id <> current_status.id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Replacement status must be a different active status in the same project'; END IF;
    UPDATE public.tasks SET status_id = target_status.id, completed_date = CASE WHEN target_status.is_done = 1 THEN completed_at ELSE NULL END,
      updated_at = changed_at WHERE project_id = p_project_id AND status_id = current_status.id AND deleted_at IS NULL;
    UPDATE public.statuses SET deleted_at = changed_at, updated_at = changed_at WHERE id = current_status.id;
    RETURN jsonb_build_object('deleted', true, 'status_id', current_status.id, 'reassign_to_status_id', target_status.id);
  END IF;
  RAISE EXCEPTION 'Unknown status operation';
END;
$$;
REVOKE ALL ON FUNCTION public.manage_project_status(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_project_status(uuid, uuid, text, jsonb) TO authenticated, service_role;
