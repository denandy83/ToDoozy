ALTER TABLE public.projects ADD COLUMN archive_updated_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN archive_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.project_archive_write_kind()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM set_config(coalesce(TG_ARGV[1], 'todoozy.project_archive_write_kind'), TG_ARGV[0], true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.project_archive_write_kind() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER a_project_archive_reset BEFORE UPDATE ON public.projects
FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind('metadata');
CREATE TRIGGER b_project_archive_timestamp BEFORE UPDATE OF updated_at ON public.projects
FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind('legacy');
DO $$
DECLARE metadata_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ',') INTO metadata_columns FROM pg_attribute
    WHERE attrelid = 'public.projects'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname NOT IN ('id', 'is_archived', 'updated_at', 'archive_updated_at');
  EXECUTE 'CREATE TRIGGER c_project_archive_metadata BEFORE UPDATE OF ' || metadata_columns ||
    ' ON public.projects FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind(''metadata'')';
END;
$$;
CREATE TRIGGER d_project_archive_version BEFORE UPDATE OF archive_updated_at ON public.projects
FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind('versioned');

CREATE OR REPLACE FUNCTION public.preserve_project_archive_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE kind text := current_setting('todoozy.project_archive_write_kind', true);
  archive_state integer; archive_version timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text, 0));
  IF kind = 'legacy' AND NEW.updated_at > coalesce(OLD.archive_updated_at, '-infinity'::timestamptz) THEN
    NEW.archive_updated_at := NEW.updated_at;
    NEW.updated_at := OLD.updated_at;
  ELSIF kind <> 'versioned' OR (OLD.archive_updated_at IS NOT NULL
     AND (NEW.archive_updated_at IS NULL OR NEW.archive_updated_at <= OLD.archive_updated_at)) THEN
    NEW.is_archived := OLD.is_archived;
    NEW.archive_updated_at := OLD.archive_updated_at;
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    archive_state := NEW.is_archived;
    archive_version := NEW.archive_updated_at;
    NEW := OLD;
    NEW.is_archived := archive_state;
    NEW.archive_updated_at := archive_version;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_project_archive_version() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_project_archive_version
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.preserve_project_archive_version();

CREATE TRIGGER a_task_archive_reset BEFORE UPDATE ON public.tasks
FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind('archive', 'todoozy.task_archive_write_kind');
CREATE TRIGGER b_task_archive_choice BEFORE UPDATE OF is_archived ON public.tasks
FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind('archive-choice', 'todoozy.task_archive_write_kind');
DO $$
DECLARE metadata_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ',') INTO metadata_columns FROM pg_attribute
    WHERE attrelid = 'public.tasks'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname NOT IN ('id', 'is_archived', 'updated_at', 'archive_updated_at');
  EXECUTE 'CREATE TRIGGER c_task_archive_metadata BEFORE UPDATE OF ' || metadata_columns ||
    ' ON public.tasks FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind(''metadata'', ''todoozy.task_archive_write_kind'')';
END;
$$;

CREATE TRIGGER d_task_archive_version BEFORE UPDATE OF archive_updated_at ON public.tasks
FOR EACH STATEMENT EXECUTE FUNCTION public.project_archive_write_kind('versioned', 'todoozy.task_archive_write_kind');

CREATE OR REPLACE FUNCTION public.preserve_task_archive_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE project_state integer; project_version timestamptz;
  archive_state integer; archive_version timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.project_id::text, 0));
  SELECT is_archived, archive_updated_at INTO project_state, project_version
    FROM public.projects WHERE id = NEW.project_id;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NOT NULL AND current_setting('todoozy.task_archive_write_kind', true) IN ('archive', 'archive-choice') THEN RETURN OLD; END IF;
    IF current_setting('todoozy.task_archive_write_kind', true) = 'archive-choice'
       AND NEW.archive_updated_at IS NOT DISTINCT FROM OLD.archive_updated_at
       AND (project_version IS NULL OR NEW.updated_at > project_version) THEN
      NEW.archive_updated_at := NEW.updated_at;
      NEW.updated_at := OLD.updated_at;
    END IF;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.updated_at <= OLD.updated_at THEN RETURN OLD; END IF;
    IF NEW.deleted_at IS NOT NULL THEN
      IF NEW.updated_at < OLD.updated_at THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    IF NEW.archive_updated_at IS NULL OR (OLD.archive_updated_at IS NOT NULL AND NEW.archive_updated_at <= OLD.archive_updated_at) THEN
      NEW.is_archived := OLD.is_archived;
      NEW.archive_updated_at := OLD.archive_updated_at;
    END IF;
    IF current_setting('todoozy.task_archive_write_kind', true) IN ('archive', 'archive-choice')
       AND project_version IS NOT NULL AND NEW.updated_at <= project_version THEN
      NEW.updated_at := OLD.updated_at;
    END IF;
    IF NEW.updated_at < OLD.updated_at THEN
      archive_state := NEW.is_archived;
      archive_version := NEW.archive_updated_at;
      NEW := OLD;
      NEW.is_archived := archive_state;
      NEW.archive_updated_at := archive_version;
    END IF;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF project_version IS NOT NULL AND (NEW.archive_updated_at IS NULL OR NEW.archive_updated_at <= project_version) THEN
    NEW.is_archived := project_state;
    NEW.archive_updated_at := project_version;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_task_archive_version() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_task_archive_version
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.preserve_task_archive_version();
