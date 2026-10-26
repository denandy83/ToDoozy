CREATE OR REPLACE FUNCTION public.enforce_task_status_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  assigned_status public.statuses%ROWTYPE;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO assigned_status FROM public.statuses
    WHERE id = NEW.status_id AND project_id = NEW.project_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Status must be active and belong to the task project'; END IF;
  IF assigned_status.is_done = 1 THEN
    NEW.completed_date := to_char(coalesce(NEW.completed_date::timestamptz, clock_timestamp()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  ELSE
    NEW.completed_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_task_status_assignment() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_task_status_assignment
BEFORE INSERT OR UPDATE OF project_id, status_id, completed_date, deleted_at ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_status_assignment();

CREATE OR REPLACE FUNCTION public.enforce_status_task_consistency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.deleted_at IS NOT NULL OR NEW.project_id IS DISTINCT FROM OLD.project_id)
     AND EXISTS (SELECT 1 FROM public.tasks WHERE status_id = OLD.id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Reassign active tasks before removing or moving their status';
  END IF;
  IF NEW.is_done IS DISTINCT FROM OLD.is_done THEN
    UPDATE public.tasks SET completed_date = CASE WHEN NEW.is_done = 1 THEN
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
      updated_at = clock_timestamp()
    WHERE status_id = NEW.id AND project_id = NEW.project_id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_status_task_consistency() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_status_task_consistency
AFTER UPDATE OF is_done, deleted_at, project_id ON public.statuses
FOR EACH ROW EXECUTE FUNCTION public.enforce_status_task_consistency();
