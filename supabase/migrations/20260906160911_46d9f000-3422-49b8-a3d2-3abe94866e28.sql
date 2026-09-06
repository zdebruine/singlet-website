CREATE TYPE public.workspace_role AS ENUM ('owner', 'member');
CREATE TYPE public.share_visibility AS ENUM ('private', 'workspace', 'link');
CREATE TYPE public.user_file_kind AS ENUM ('upload', 'url');
CREATE TYPE public.user_file_status AS ENUM ('uploading', 'indexing', 'ready', 'failed');

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
GRANT SELECT ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = _workspace_id AND m.user_id = _user_id)
$$;
CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = _workspace_id AND m.user_id = _user_id AND m.role = 'owner')
$$;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid), public.is_workspace_owner(uuid, uuid) TO authenticated, service_role;

CREATE POLICY workspaces_read_member ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id));
CREATE POLICY workspace_members_read_member ON public.workspace_members FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  email text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_invites_read_owner ON public.workspace_invites FOR SELECT TO authenticated USING (public.is_workspace_owner(workspace_id));

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  visibility public.share_visibility NOT NULL DEFAULT 'private',
  read_token_hash text NOT NULL UNIQUE,
  read_token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_read_allowed ON public.projects FOR SELECT TO authenticated USING (
  owner_id = auth.uid() OR (visibility = 'workspace' AND workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
);

CREATE TABLE public.user_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  kind public.user_file_kind NOT NULL,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  object_key text,
  source_url text,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0 AND bytes <= 2147483648),
  etag text,
  status public.user_file_status NOT NULL DEFAULT 'uploading',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'upload' AND object_key IS NOT NULL AND source_url IS NULL) OR (kind = 'url' AND source_url IS NOT NULL AND object_key IS NULL))
);
GRANT SELECT ON public.user_files TO authenticated;
GRANT ALL ON public.user_files TO service_role;
ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_files_read_allowed ON public.user_files FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id))))
);

CREATE TABLE public.multipart_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL UNIQUE REFERENCES public.user_files(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  r2_upload_id text NOT NULL,
  object_key text NOT NULL,
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0 AND expected_bytes <= 2147483648),
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.multipart_uploads TO authenticated;
GRANT ALL ON public.multipart_uploads TO service_role;
ALTER TABLE public.multipart_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY multipart_uploads_read_own ON public.multipart_uploads FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.user_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.user_files(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  study_id text NOT NULL CHECK (char_length(study_id) BETWEEN 1 AND 120),
  title text,
  abstract text,
  organism_primary text,
  organisms jsonb NOT NULL DEFAULT '[]'::jsonb,
  tissue_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  disease_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  assay_families jsonb NOT NULL DEFAULT '[]'::jsonb,
  cell_types_raw jsonb NOT NULL DEFAULT '[]'::jsonb,
  n_samples integer NOT NULL DEFAULT 0 CHECK (n_samples >= 0),
  n_cells bigint,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  reference_build text,
  singlet_version text,
  year integer,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  study_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, study_id)
);
GRANT SELECT ON public.user_studies TO authenticated;
GRANT ALL ON public.user_studies TO service_role;
ALTER TABLE public.user_studies ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_studies_read_allowed ON public.user_studies FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id))))
);

CREATE TABLE public.user_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES public.user_studies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  sample_id text NOT NULL CHECK (char_length(sample_id) BETWEEN 1 AND 160),
  organism text,
  tissue text,
  tissue_group text,
  disease text,
  disease_group text,
  protocol text,
  assay_family text,
  cell_type text,
  characteristics jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (study_id, sample_id)
);
GRANT SELECT ON public.user_samples TO authenticated;
GRANT ALL ON public.user_samples TO service_role;
ALTER TABLE public.user_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_samples_read_allowed ON public.user_samples FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id))))
);

CREATE TABLE public.user_sample_qc (
  sample_id uuid PRIMARY KEY REFERENCES public.user_samples(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  n_input_reads bigint,
  uniquely_mapped_pct real,
  n_cells_called integer,
  median_umi real,
  median_genes real,
  mapping_rate real,
  median_mito_fraction real,
  fraction_reads_in_cells real,
  reference_build text,
  singlet_version text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_sample_qc TO authenticated;
GRANT ALL ON public.user_sample_qc TO service_role;
ALTER TABLE public.user_sample_qc ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_sample_qc_read_allowed ON public.user_sample_qc FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR (p.visibility = 'workspace' AND p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id))))
);

CREATE TABLE public.cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 20000),
  query text NOT NULL DEFAULT '' CHECK (char_length(query) <= 500),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  catalog_version text NOT NULL,
  visibility public.share_visibility NOT NULL DEFAULT 'private',
  share_token_hash text UNIQUE,
  share_token_prefix text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cohorts TO authenticated;
GRANT ALL ON public.cohorts TO service_role;
ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cohorts_read_allowed ON public.cohorts FOR SELECT TO authenticated USING (
  owner_id = auth.uid() OR (visibility = 'workspace' AND workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
);

CREATE TABLE public.cohort_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  public_gse_id text,
  private_study_id uuid REFERENCES public.user_studies(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((public_gse_id IS NOT NULL)::integer + (private_study_id IS NOT NULL)::integer = 1),
  UNIQUE NULLS NOT DISTINCT (cohort_id, public_gse_id, private_study_id)
);
GRANT SELECT ON public.cohort_items TO authenticated;
GRANT ALL ON public.cohort_items TO service_role;
ALTER TABLE public.cohort_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY cohort_items_read_allowed ON public.cohort_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND (c.owner_id = auth.uid() OR (c.visibility = 'workspace' AND c.workspace_id IS NOT NULL AND public.is_workspace_member(c.workspace_id))))
);

CREATE TABLE public.cohort_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cohort_comments TO authenticated;
GRANT ALL ON public.cohort_comments TO service_role;
ALTER TABLE public.cohort_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY cohort_comments_read_allowed ON public.cohort_comments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND (c.owner_id = auth.uid() OR (c.visibility = 'workspace' AND c.workspace_id IS NOT NULL AND public.is_workspace_member(c.workspace_id))))
);

CREATE TABLE public.activity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid,
  kind text NOT NULL CHECK (kind IN ('project_created','file_uploaded','file_registered','cohort_saved','comment_added','member_joined')),
  subject_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activity_events TO authenticated;
GRANT ALL ON public.activity_events TO service_role;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_events_read_member ON public.activity_events FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE TABLE public.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  key_prefix text,
  tool text NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('mcp','api','download','partial_download')),
  calls integer NOT NULL DEFAULT 1 CHECK (calls > 0),
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  ms bigint NOT NULL DEFAULT 0 CHECK (ms >= 0),
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_events_read_own ON public.usage_events FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.account_preferences (
  user_id uuid PRIMARY KEY,
  weekly_summary boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.account_preferences TO authenticated;
GRANT ALL ON public.account_preferences TO service_role;
ALTER TABLE public.account_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_preferences_read_own ON public.account_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY account_preferences_insert_own ON public.account_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY account_preferences_update_own ON public.account_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX workspace_members_user_idx ON public.workspace_members(user_id, workspace_id);
CREATE INDEX workspace_invites_workspace_idx ON public.workspace_invites(workspace_id, expires_at DESC);
CREATE INDEX projects_owner_idx ON public.projects(owner_id, created_at DESC);
CREATE INDEX projects_workspace_idx ON public.projects(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX user_files_owner_idx ON public.user_files(owner_id, created_at DESC);
CREATE INDEX user_files_project_idx ON public.user_files(project_id, created_at DESC);
CREATE INDEX user_studies_owner_idx ON public.user_studies(owner_id, indexed_at DESC);
CREATE INDEX user_studies_project_idx ON public.user_studies(project_id, study_id);
CREATE INDEX user_samples_study_idx ON public.user_samples(study_id, sample_id);
CREATE INDEX user_samples_facets_idx ON public.user_samples(project_id, organism, tissue_group, disease_group, assay_family);
CREATE INDEX cohorts_owner_idx ON public.cohorts(owner_id, updated_at DESC);
CREATE INDEX cohorts_workspace_idx ON public.cohorts(workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX cohort_items_cohort_idx ON public.cohort_items(cohort_id, position);
CREATE INDEX cohort_comments_cohort_idx ON public.cohort_comments(cohort_id, created_at);
CREATE INDEX activity_workspace_idx ON public.activity_events(workspace_id, created_at DESC);
CREATE INDEX usage_events_user_day_idx ON public.usage_events(user_id, day DESC, kind, tool);

CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_files_set_updated_at BEFORE UPDATE ON public.user_files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER cohorts_set_updated_at BEFORE UPDATE ON public.cohorts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER cohort_comments_set_updated_at BEFORE UPDATE ON public.cohort_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER account_preferences_set_updated_at BEFORE UPDATE ON public.account_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_api_key_owner(_key_hash text)
RETURNS TABLE(key_id uuid, user_id uuid, key_prefix text, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.user_id, k.key_prefix, k.expires_at, k.revoked_at, k.last_used_at FROM public.api_keys k WHERE k.key_hash = _key_hash
$$;
REVOKE ALL ON FUNCTION public.resolve_api_key_owner(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_api_key_owner(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_product_usage()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'mcp_week', COALESCE((SELECT jsonb_object_agg(tool, calls) FROM (SELECT tool, sum(calls)::integer calls FROM public.usage_events WHERE user_id = auth.uid() AND kind = 'mcp' AND day >= ((now() AT TIME ZONE 'utc')::date - 6) GROUP BY tool) x), '{}'::jsonb),
    'downloads_month', COALESCE((SELECT sum(calls) FROM public.usage_events WHERE user_id = auth.uid() AND kind IN ('download','partial_download') AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date), 0),
    'download_bytes_month', COALESCE((SELECT sum(bytes) FROM public.usage_events WHERE user_id = auth.uid() AND kind IN ('download','partial_download') AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date), 0),
    'storage_bytes', COALESCE((SELECT sum(bytes) FROM public.user_files WHERE owner_id = auth.uid() AND status = 'ready' AND kind = 'upload'), 0),
    'projects', (SELECT count(*) FROM public.projects WHERE owner_id = auth.uid()),
    'cohorts', (SELECT count(*) FROM public.cohorts WHERE owner_id = auth.uid())
  )
$$;
REVOKE ALL ON FUNCTION public.my_product_usage() FROM public;
GRANT EXECUTE ON FUNCTION public.my_product_usage() TO authenticated;
