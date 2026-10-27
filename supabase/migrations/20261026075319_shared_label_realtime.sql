-- Project-filtered label events, including renames of referenced definitions.
ALTER TABLE public.project_labels ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.notify_project_label_definition_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.project_labels SET updated_at = clock_timestamp()
  WHERE label_id = NEW.id AND deleted_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_label_definition_changed ON public.user_labels;
CREATE TRIGGER project_label_definition_changed
AFTER UPDATE OF name, color ON public.user_labels
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.color IS DISTINCT FROM NEW.color)
EXECUTE FUNCTION public.notify_project_label_definition_change();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                 AND schemaname = 'public' AND tablename = 'project_labels') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_labels;
  END IF;
END;
$$;
