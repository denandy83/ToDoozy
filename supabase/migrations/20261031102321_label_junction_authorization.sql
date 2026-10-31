CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.authorize_label_junction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_project uuid;
BEGIN
  IF CURRENT_USER IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Label association not authorized' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'project_labels' THEN
    target_project := NEW.project_id;
    IF NEW.deleted_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.project_labels p WHERE p.project_id = NEW.project_id AND p.label_id = NEW.label_id
    ) THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT t.project_id INTO target_project FROM public.tasks t WHERE t.id = NEW.task_id AND t.deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = target_project AND m.user_id = auth.uid())
    OR NOT EXISTS (
      SELECT 1 FROM public.user_labels l WHERE l.id = NEW.label_id AND l.deleted_at IS NULL
        AND (l.user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_labels p WHERE p.project_id = target_project AND p.label_id = NEW.label_id
            AND (p.deleted_at IS NULL OR TG_TABLE_NAME = 'project_labels')
        ))
    ) THEN
    RAISE EXCEPTION 'Label association not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.authorize_label_junction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS authorize_label_junction ON public.project_labels;
CREATE TRIGGER authorize_label_junction BEFORE INSERT OR UPDATE ON public.project_labels
FOR EACH ROW EXECUTE FUNCTION private.authorize_label_junction();
DROP TRIGGER IF EXISTS authorize_label_junction ON public.task_labels;
CREATE TRIGGER authorize_label_junction BEFORE INSERT OR UPDATE ON public.task_labels
FOR EACH ROW EXECUTE FUNCTION private.authorize_label_junction();
