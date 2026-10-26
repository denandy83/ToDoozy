CREATE OR REPLACE FUNCTION public.notify_task_label_addition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    UPDATE public.tasks SET updated_at = updated_at WHERE id = NEW.task_id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_task_label_addition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER notify_task_label_addition
AFTER INSERT OR UPDATE ON public.task_labels
FOR EACH ROW EXECUTE FUNCTION public.notify_task_label_addition();
