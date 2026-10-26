ALTER TABLE public.projects ADD COLUMN archive_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.preserve_project_archive_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.archive_updated_at IS NOT NULL
     AND (NEW.archive_updated_at IS NULL OR NEW.archive_updated_at <= OLD.archive_updated_at) THEN
    NEW.is_archived := OLD.is_archived;
    NEW.archive_updated_at := OLD.archive_updated_at;
  END IF;
  NEW.updated_at := greatest(OLD.updated_at, NEW.updated_at, NEW.archive_updated_at);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_project_archive_version() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_project_archive_version
BEFORE UPDATE OF is_archived, archive_updated_at ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.preserve_project_archive_version();
