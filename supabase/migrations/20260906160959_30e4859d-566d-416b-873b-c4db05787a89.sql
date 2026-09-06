CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.is_workspace_member(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = _workspace_id AND m.user_id = _user_id)
$$;
CREATE OR REPLACE FUNCTION app_private.is_workspace_owner(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = _workspace_id AND m.user_id = _user_id AND m.role = 'owner')
$$;
REVOKE ALL ON FUNCTION app_private.is_workspace_member(uuid, uuid), app_private.is_workspace_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_workspace_member(uuid, uuid), app_private.is_workspace_owner(uuid, uuid) TO authenticated, service_role;

DROP POLICY workspaces_read_member ON public.workspaces;
CREATE POLICY workspaces_read_member ON public.workspaces FOR SELECT TO authenticated USING (app_private.is_workspace_member(id));
DROP POLICY workspace_members_read_member ON public.workspace_members;
CREATE POLICY workspace_members_read_member ON public.workspace_members FOR SELECT TO authenticated USING (app_private.is_workspace_member(workspace_id));
DROP POLICY workspace_invites_read_owner ON public.workspace_invites;
CREATE POLICY workspace_invites_read_owner ON public.workspace_invites FOR SELECT TO authenticated USING (app_private.is_workspace_owner(workspace_id));
DROP POLICY projects_read_allowed ON public.projects;
CREATE POLICY projects_read_allowed ON public.projects FOR SELECT TO authenticated USING (owner_id = auth.uid() OR (visibility = 'workspace' AND workspace_id IS NOT NULL AND app_private.is_workspace_member(workspace_id)));
DROP POLICY user_files_read_allowed ON public.user_files;
CREATE POLICY user_files_read_allowed ON public.user_files FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND app_private.is_workspace_member(p.workspace_id)))));
DROP POLICY user_studies_read_allowed ON public.user_studies;
CREATE POLICY user_studies_read_allowed ON public.user_studies FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND app_private.is_workspace_member(p.workspace_id)))));
DROP POLICY user_samples_read_allowed ON public.user_samples;
CREATE POLICY user_samples_read_allowed ON public.user_samples FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND app_private.is_workspace_member(p.workspace_id)))));
DROP POLICY user_sample_qc_read_allowed ON public.user_sample_qc;
CREATE POLICY user_sample_qc_read_allowed ON public.user_sample_qc FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND app_private.is_workspace_member(p.workspace_id)))));
DROP POLICY cohorts_read_allowed ON public.cohorts;
CREATE POLICY cohorts_read_allowed ON public.cohorts FOR SELECT TO authenticated USING (owner_id = auth.uid() OR (visibility = 'workspace' AND workspace_id IS NOT NULL AND app_private.is_workspace_member(workspace_id)));
DROP POLICY cohort_items_read_allowed ON public.cohort_items;
CREATE POLICY cohort_items_read_allowed ON public.cohort_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND (c.owner_id = auth.uid() OR (c.visibility = 'workspace' AND c.workspace_id IS NOT NULL AND app_private.is_workspace_member(c.workspace_id)))));
DROP POLICY cohort_comments_read_allowed ON public.cohort_comments;
CREATE POLICY cohort_comments_read_allowed ON public.cohort_comments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND (c.owner_id = auth.uid() OR (c.visibility = 'workspace' AND c.workspace_id IS NOT NULL AND app_private.is_workspace_member(c.workspace_id)))));
DROP POLICY activity_events_read_member ON public.activity_events;
CREATE POLICY activity_events_read_member ON public.activity_events FOR SELECT TO authenticated USING (app_private.is_workspace_member(workspace_id));

DROP FUNCTION public.is_workspace_member(uuid, uuid);
DROP FUNCTION public.is_workspace_owner(uuid, uuid);
DROP FUNCTION public.resolve_api_key_owner(text);

CREATE OR REPLACE FUNCTION public.my_product_usage()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'mcp_week', COALESCE((SELECT jsonb_object_agg(tool, calls) FROM (SELECT tool, sum(calls)::integer calls FROM public.usage_events WHERE user_id = auth.uid() AND kind = 'mcp' AND day >= ((now() AT TIME ZONE 'utc')::date - 6) GROUP BY tool) x), '{}'::jsonb),
    'downloads_month', COALESCE((SELECT sum(calls) FROM public.usage_events WHERE user_id = auth.uid() AND kind IN ('download','partial_download') AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date), 0),
    'download_bytes_month', COALESCE((SELECT sum(bytes) FROM public.usage_events WHERE user_id = auth.uid() AND kind IN ('download','partial_download') AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date), 0),
    'storage_bytes', COALESCE((SELECT sum(bytes) FROM public.user_files WHERE owner_id = auth.uid() AND status = 'ready' AND kind = 'upload'), 0),
    'projects', (SELECT count(*) FROM public.projects WHERE owner_id = auth.uid()),
    'cohorts', (SELECT count(*) FROM public.cohorts WHERE owner_id = auth.uid())
  )
$$;
REVOKE ALL ON FUNCTION public.my_product_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_product_usage() TO authenticated;
