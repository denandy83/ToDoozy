CREATE OR REPLACE FUNCTION public.notify_task_label_addition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE public.tasks SET updated_at = updated_at WHERE id = OLD.task_id AND deleted_at IS NULL;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      UPDATE public.tasks SET updated_at = updated_at WHERE id = NEW.task_id AND deleted_at IS NULL;
    END IF;
  ELSIF OLD.task_id IS DISTINCT FROM NEW.task_id OR OLD.label_id IS DISTINCT FROM NEW.label_id THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE public.tasks SET updated_at = updated_at WHERE id = OLD.task_id AND deleted_at IS NULL;
    END IF;
    IF NEW.deleted_at IS NULL AND (OLD.deleted_at IS NOT NULL OR OLD.task_id IS DISTINCT FROM NEW.task_id) THEN
      UPDATE public.tasks SET updated_at = updated_at WHERE id = NEW.task_id AND deleted_at IS NULL;
    END IF;
  ELSIF (OLD.deleted_at IS NULL) IS DISTINCT FROM (NEW.deleted_at IS NULL) THEN
    UPDATE public.tasks SET updated_at = updated_at WHERE id = NEW.task_id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_task_label_addition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER notify_task_label_addition
AFTER INSERT OR UPDATE OR DELETE ON public.task_labels
FOR EACH ROW EXECUTE FUNCTION public.notify_task_label_addition();
