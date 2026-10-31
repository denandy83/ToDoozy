-- Prospective integrity guard; existing rows are not rewritten.
CREATE OR REPLACE FUNCTION public.guard_task_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE parent uuid; next_parent uuid; parent_project uuid; parent_deleted timestamptz;
  visited uuid[]; locked_project uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
      AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
      AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
      AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;
  -- Serialize concurrent graph edits, including inserts, in a stable lock order.
  FOR locked_project IN SELECT DISTINCT p FROM unnest(ARRAY[NEW.project_id,OLD.project_id]) p WHERE p IS NOT NULL ORDER BY p LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(locked_project::text,71329));
  END LOOP;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id AND EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.parent_id=NEW.id AND t.deleted_at IS NULL AND t.project_id<>NEW.project_id
  ) THEN RAISE EXCEPTION 'Move the task subtree together; children must remain in the same project'; END IF;
  parent:=NEW.parent_id; visited:=ARRAY[NEW.id];
  WHILE parent IS NOT NULL LOOP
    IF parent=ANY(visited) THEN RAISE EXCEPTION 'A task cannot be its own ancestor'; END IF;
    SELECT t.parent_id,t.project_id,t.deleted_at INTO next_parent,parent_project,parent_deleted
      FROM public.tasks t WHERE t.id=parent;
    IF NOT FOUND OR parent_project IS DISTINCT FROM NEW.project_id OR parent_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'Parent must be an active task in the same project';
    END IF;
    visited:=array_append(visited,parent); parent:=next_parent;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_parent() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_task_parent ON public.tasks;
CREATE TRIGGER guard_task_parent BEFORE INSERT OR UPDATE OF parent_id,project_id,deleted_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_parent();

CREATE OR REPLACE FUNCTION public.tombstone_task_subtree()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  WITH RECURSIVE subtree(id) AS (
    SELECT t.id FROM public.tasks t WHERE t.parent_id=NEW.id
    UNION SELECT t.id FROM public.tasks t JOIN subtree s ON t.parent_id=s.id
  ) UPDATE public.tasks SET deleted_at=NEW.deleted_at,
      updated_at=greatest(updated_at,NEW.updated_at)
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tombstone_task_subtree() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tombstone_task_subtree ON public.tasks;
CREATE TRIGGER tombstone_task_subtree AFTER INSERT OR UPDATE OF deleted_at ON public.tasks
  FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION public.tombstone_task_subtree();
