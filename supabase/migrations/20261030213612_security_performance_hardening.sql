-- Explicit API privileges and authorization. No user-data rewrite is performed.
BEGIN;
DROP FUNCTION IF EXISTS public.share_project(uuid,text,text,text,text);

CREATE OR REPLACE FUNCTION public.share_project(
  p_id uuid, p_name text, p_description text DEFAULT NULL,
  p_color text DEFAULT '#888888', p_icon text DEFAULT 'folder', p_owner_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  owner uuid;
  existing_owner uuid;
BEGIN
  -- SECURITY DEFINER changes current_user, so use the actual SET ROLE of the
  -- invoking connection for the trusted server path, not current_user.
  IF current_setting('role', true) = 'service_role' THEN
    actor := p_owner_id;
  ELSIF actor IS NULL OR (p_owner_id IS NOT NULL AND p_owner_id IS DISTINCT FROM actor) THEN
    RAISE EXCEPTION 'Authenticated project owner required' USING ERRCODE = '42501';
  END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'Project owner required' USING ERRCODE = '42501'; END IF;
  -- Serialize the absent-row case as well as existing project updates.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  SELECT owner_id INTO existing_owner FROM public.projects WHERE id = p_id FOR UPDATE;
  IF FOUND AND existing_owner IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Only the project owner can share this project' USING ERRCODE = '42501';
  END IF;
  owner := coalesce(existing_owner, actor);
  INSERT INTO public.projects(id,owner_id,name,description,color,icon,created_at,updated_at)
  VALUES(p_id,owner,p_name,p_description,p_color,p_icon,now(),now())
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
    color=excluded.color,icon=excluded.icon,updated_at=now();
  INSERT INTO public.project_members(project_id,user_id,role,joined_at)
  VALUES(p_id,owner,'owner',now()) ON CONFLICT(project_id,user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.share_project(uuid,text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.share_project(uuid,text,text,text,text,uuid) TO authenticated,service_role;

-- Use the stored auth email, never a caller-supplied email or user_metadata.
CREATE OR REPLACE FUNCTION public.get_pending_invites_for_email(user_email text)
RETURNS TABLE(token uuid,project_id uuid,project_name text,owner_email text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller_email text;
BEGIN
  SELECT lower(btrim(u.email)) INTO caller_email FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF caller_email IS NULL OR lower(btrim(user_email)) IS DISTINCT FROM caller_email THEN
    RAISE EXCEPTION 'Only your own pending invitations are accessible' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT i.token,i.project_id,p.name,u.email::text,i.expires_at
  FROM public.project_invites i JOIN public.projects p ON p.id=i.project_id
  JOIN auth.users u ON u.id=p.owner_id
  WHERE lower(btrim(i.target_email))=caller_email AND i.status='pending' AND i.expires_at>now();
END;
$$;
REVOKE ALL ON FUNCTION public.get_pending_invites_for_email(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pending_invites_for_email(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invite(invite_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE invitation public.project_invites%ROWTYPE; caller uuid:=auth.uid(); caller_email text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in to accept an invitation' USING ERRCODE='42501'; END IF;
  SELECT * INTO invitation FROM public.project_invites WHERE token=invite_token FOR UPDATE;
  IF NOT FOUND OR invitation.status <> 'pending' OR invitation.expires_at<=now() THEN
    RAISE EXCEPTION 'Invitation is unavailable or expired';
  END IF;
  SELECT lower(btrim(u.email)) INTO caller_email FROM auth.users u WHERE u.id=caller AND u.email_confirmed_at IS NOT NULL;
  IF invitation.target_email IS NOT NULL AND (caller_email IS NULL OR lower(btrim(invitation.target_email)) IS DISTINCT FROM caller_email) THEN
    RAISE EXCEPTION 'Invitation is addressed to another user' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.project_members(project_id,user_id,role,joined_at)
  VALUES(invitation.project_id,caller,'member',now()) ON CONFLICT(project_id,user_id) DO NOTHING;
  UPDATE public.project_invites SET status='accepted',accepted_by=caller WHERE token=invite_token;
  RETURN invitation.project_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_profiles(p_user_ids uuid[])
RETURNS TABLE(id uuid,email text,display_name text,avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id,u.email::text,
    coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name'),
    coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture')
  FROM auth.users u WHERE auth.uid() IS NOT NULL AND u.id=ANY(p_user_ids)
    AND (u.id=auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_members mine JOIN public.project_members peer USING(project_id)
      WHERE mine.user_id=auth.uid() AND peer.user_id=u.id));
$$;
REVOKE ALL ON FUNCTION public.get_user_profiles(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_profiles(uuid[]) TO authenticated;

-- Invite consumption is an atomic RPC. Direct updates are owner management only.
DROP POLICY IF EXISTS "Authenticated users can read invites" ON public.project_invites;
DROP POLICY IF EXISTS "Invite can be accepted" ON public.project_invites;
CREATE POLICY "Owners manage their invitations" ON public.project_invites
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id=project_invites.project_id AND p.owner_id=(SELECT auth.uid())));
CREATE POLICY "Owners update their invitations" ON public.project_invites
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id=project_invites.project_id AND p.owner_id=(SELECT auth.uid())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id=project_invites.project_id AND p.owner_id=(SELECT auth.uid())));

-- RLS is separate from object grants, particularly on clean resets after the
-- October 2026 default-privilege change. Grant only the named app tables.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projects','tasks','statuses','project_members','project_invites','activity_log',
    'user_settings','user_labels','user_saved_views','user_project_areas','user_themes','task_labels','project_labels','api_keys'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO authenticated,service_role',t);
    END IF;
  END LOOP;
  IF to_regclass('public.release_notes') IS NOT NULL THEN
    GRANT SELECT ON public.release_notes TO anon,authenticated;
    GRANT ALL ON public.release_notes TO service_role;
  END IF;
END $$;

-- Membership identities/roles are not profile preferences. A member may edit
-- only their own per-project display columns, never promote themselves.
DROP POLICY IF EXISTS "Members can update display settings" ON public.project_members;
CREATE POLICY "Members update own display settings" ON public.project_members
  FOR UPDATE TO authenticated USING (user_id=(SELECT auth.uid()))
  WITH CHECK (user_id=(SELECT auth.uid()));
REVOKE UPDATE ON public.project_members FROM PUBLIC,anon,authenticated;
GRANT UPDATE(display_color,display_initials) ON public.project_members TO authenticated;

-- Cache only row-independent auth lookups; project-dependent membership helpers
-- keep their row input. Preserve each policy's logical expression and role list.
DO $$ DECLARE p record; q text; c text; stmt text; BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname='public' LOOP
    q:=p.qual; c:=p.with_check;
    -- Exact simple expression allowlist: never replace tokens inside literals,
    -- identifiers or complex policies. Those need separate measured review.
    IF q IN ('(user_id = auth.uid())','(owner_id = auth.uid())','(auth.uid() = user_id)','(auth.uid() = owner_id)') THEN q:=replace(q,'auth.uid()','(SELECT auth.uid())'); END IF;
    IF c IN ('(user_id = auth.uid())','(owner_id = auth.uid())','(auth.uid() = user_id)','(auth.uid() = owner_id)') THEN c:=replace(c,'auth.uid()','(SELECT auth.uid())'); END IF;
    IF q IS DISTINCT FROM p.qual OR c IS DISTINCT FROM p.with_check THEN
      stmt:=format('ALTER POLICY %I ON public.%I',p.policyname,p.tablename);
      IF q IS NOT NULL THEN stmt:=stmt||' USING ('||q||')'; END IF;
      IF c IS NOT NULL THEN stmt:=stmt||' WITH CHECK ('||c||')'; END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_members_user_project ON public.project_members(user_id,project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status_id);
COMMIT;
