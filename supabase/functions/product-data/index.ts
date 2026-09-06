import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { resolveSubject } from "../_shared/quota.ts";
import { service, sha256Hex } from "../_shared/service.ts";

const PROJECT_CAP = 5;
const WORKSPACE_CAP = 3;
const MEMBER_CAP = 25;
const FILE_CAP = 20;
const ACCOUNT_BYTES_CAP = 10 * 1024 ** 3;
const GLOBAL_BYTES_CAP = 2 * 1024 ** 4;
const FILE_BYTES_CAP = 2 * 1024 ** 3;
const URL_RE = /^https:\/\//i;
const UUID = z.string().uuid();
const VISIBILITY = z.enum(["private", "workspace", "link"]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (error: string, message: string, status = 400, extra: Record<string, unknown> = {}) => json({ error, message, ...extra }, status);
const text = (v: unknown, max: number) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
const token = (prefix: string) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

async function user(req: Request) {
  const subject = await resolveSubject(req);
  if (subject.invalidKey) return { error: fail("invalid_api_key", subject.invalidKey.message, 401) };
  if (!subject.userId) return { error: fail("sign_in_required", "Sign in to use private projects, cohorts and workspaces.", 401) };
  return { id: subject.userId, email: subject.email, via: subject.via };
}

async function projectAccess(id: string, uid: string, write = false) {
  const db = service();
  const { data: p } = await db.from("projects").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  if (p.owner_id === uid) return p;
  if (write || p.visibility !== "workspace" || !p.workspace_id) return null;
  const { data: m } = await db.from("workspace_members").select("user_id").eq("workspace_id", p.workspace_id).eq("user_id", uid).maybeSingle();
  return m ? p : null;
}

async function cohortAccess(id: string, uid: string | null, shareToken?: string) {
  const db = service();
  const { data: c } = await db.from("cohorts").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  if (uid && c.owner_id === uid) return c;
  if (uid && c.visibility === "workspace" && c.workspace_id) {
    const { data: m } = await db.from("workspace_members").select("user_id").eq("workspace_id", c.workspace_id).eq("user_id", uid).maybeSingle();
    if (m) return c;
  }
  if (c.visibility === "link" && shareToken && c.share_token_hash === await sha256Hex(shareToken)) return c;
  return null;
}

async function catalogVersion(): Promise<string> {
  return Deno.env.get("CATALOG_VERSION") || "2026.09";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method", "POST only.", 405);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return fail("invalid_body", "action is required.");
  const action = body.action;
  const db = service();

  try {
    if (action === "authorize_private_file") {
      const projectId = UUID.safeParse(body.project_id);
      const studyId = text(body.study_id, 160);
      if (!projectId.success || !studyId) return fail("invalid_id", "Unknown private study.");
      const subject = await resolveSubject(req);
      const supplied = text(body.read_token, 200);
      const { data: p } = await db.from("projects").select("*").eq("id", projectId.data).maybeSingle();
      let allowed = !!p && subject.userId === p.owner_id;
      if (!allowed && p && subject.userId && p.visibility === "workspace" && p.workspace_id) {
        const { data: member } = await db.from("workspace_members").select("user_id").eq("workspace_id", p.workspace_id).eq("user_id", subject.userId).maybeSingle();
        allowed = !!member;
      }
      if (!allowed && p && supplied) allowed = p.read_token_hash === await sha256Hex(supplied);
      if (!allowed || !p) return fail("not_found", "That private study is not available with this account or token.", 404);
      const { data: study } = await db.from("user_studies").select("id, study_id, file_id").eq("project_id", p.id).eq("study_id", studyId).maybeSingle();
      if (!study) return fail("not_found", "That private study does not exist.", 404);
      const { data: file } = await db.from("user_files").select("id, filename, kind, object_key, source_url, bytes, etag, status").eq("id", study.file_id).eq("status", "ready").maybeSingle();
      if (!file) return fail("not_found", "That private file is not ready.", 404);
      return json({ project: { id: p.id, name: p.name }, study, file });
    }

    if (action === "get_cohort") {
      const id = UUID.safeParse(body.id);
      if (!id.success) return fail("invalid_id", "Unknown cohort.");
      const maybe = await resolveSubject(req);
      const c = await cohortAccess(id.data, maybe.userId, typeof body.token === "string" ? body.token : undefined);
      if (!c) return fail("not_found", "That cohort is private or does not exist.", 404);
      const { data: items } = await db.from("cohort_items").select("id, public_gse_id, private_study_id, position").eq("cohort_id", c.id).order("position");
      const { data: comments } = c.workspace_id ? await db.from("cohort_comments").select("id, author_id, body, created_at, updated_at").eq("cohort_id", c.id).order("created_at") : { data: [] };
      return json({ cohort: c, items: items ?? [], comments: comments ?? [], can_edit: maybe.userId === c.owner_id });
    }

    const who = await user(req);
    if ("error" in who) return who.error;
    const uid = who.id;

    if (action === "dashboard") {
      const { data: memberships } = await db.from("workspace_members").select("workspace_id").eq("user_id", uid);
      const workspaceIds = (memberships ?? []).map((m: { workspace_id: string }) => m.workspace_id);
      const [{ data: projects }, { data: cohorts }, workspaceResult, { data: usage }, { data: preferences }] = await Promise.all([
        db.from("projects").select("id, name, description, visibility, workspace_id, read_token_prefix, created_at, updated_at").eq("owner_id", uid).order("updated_at", { ascending: false }),
        db.from("cohorts").select("id, name, notes, query, visibility, workspace_id, catalog_version, created_at, updated_at").eq("owner_id", uid).order("updated_at", { ascending: false }),
        workspaceIds.length ? db.from("workspaces").select("id, name, slug, owner_id, created_at, updated_at").in("id", workspaceIds).order("updated_at", { ascending: false }) : Promise.resolve({ data: [] }),
        db.rpc("my_product_usage"),
        db.from("account_preferences").select("weekly_summary").eq("user_id", uid).maybeSingle(),
      ]);
      const projectIds = (projects ?? []).map((p: { id: string }) => p.id);
      const { data: files } = projectIds.length ? await db.from("user_files").select("id, project_id, filename, kind, bytes, status, error, created_at, updated_at").in("project_id", projectIds).order("created_at") : { data: [] };
      return json({ projects: projects ?? [], files: files ?? [], cohorts: cohorts ?? [], workspaces: workspaceResult.data ?? [], usage: usage ?? {}, weekly_summary: preferences?.weekly_summary ?? false, limits: { projects: PROJECT_CAP, files_per_project: FILE_CAP, storage_bytes: ACCOUNT_BYTES_CAP, workspaces: WORKSPACE_CAP, members_per_workspace: MEMBER_CAP, file_bytes: FILE_BYTES_CAP } });
    }

    if (action === "create_project") {
      const parsed = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(4000).default(""), visibility: VISIBILITY, workspace_id: UUID.nullable().optional() }).safeParse(body);
      if (!parsed.success) return fail("invalid_project", "Give the project a name and valid visibility.");
      const { count } = await db.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", uid);
      if ((count ?? 0) >= PROJECT_CAP) return fail("project_limit", `You can have up to ${PROJECT_CAP} private projects. Delete one before creating another.`, 409, { limit: PROJECT_CAP });
      if (parsed.data.workspace_id) {
        const { data: m } = await db.from("workspace_members").select("role").eq("workspace_id", parsed.data.workspace_id).eq("user_id", uid).maybeSingle();
        if (!m) return fail("workspace_access", "You are not a member of that workspace.", 403);
      }
      const readToken = token("spr");
      const { data, error } = await db.from("projects").insert({ owner_id: uid, name: parsed.data.name, description: parsed.data.description, visibility: parsed.data.visibility, workspace_id: parsed.data.workspace_id ?? null, read_token_hash: await sha256Hex(readToken), read_token_prefix: readToken.slice(0, 12) }).select("*").single();
      if (error) throw error;
      if (data.workspace_id) await db.from("activity_events").insert({ workspace_id: data.workspace_id, actor_id: uid, kind: "project_created", subject_id: data.id });
      return json({ project: data, read_token: readToken });
    }

    if (action === "list_private_studies") {
      const q = text(body.query, 500).toLowerCase();
      const [{ data: owned }, { data: memberships }] = await Promise.all([db.from("projects").select("id").eq("owner_id", uid), db.from("workspace_members").select("workspace_id").eq("user_id", uid)]);
      const workspaceIds = (memberships ?? []).map((m: { workspace_id: string }) => m.workspace_id);
      const { data: shared } = workspaceIds.length ? await db.from("projects").select("id").eq("visibility", "workspace").in("workspace_id", workspaceIds) : { data: [] };
      const projectIds = [...new Set([...(owned ?? []), ...(shared ?? [])].map((p: { id: string }) => p.id))];
      const { data } = projectIds.length ? await db.from("user_studies").select("*, projects!inner(name, visibility, workspace_id)").in("project_id", projectIds).order("indexed_at", { ascending: false }).limit(200) : { data: [] };
      const rows = (data ?? []).filter((s: Record<string, unknown>) => !q || [s.study_id, s.title, s.abstract, s.organism_primary, JSON.stringify(s.tissue_groups), JSON.stringify(s.disease_groups), JSON.stringify(s.cell_types_raw)].join(" ").toLowerCase().includes(q));
      return json({ studies: rows });
    }

    if (action === "get_project") {
      const id = UUID.safeParse(body.id);
      if (!id.success) return fail("invalid_id", "Unknown project.");
      const p = await projectAccess(id.data, uid);
      if (!p) return fail("not_found", "That project is private or does not exist.", 404);
      const [{ data: files }, { data: studies }] = await Promise.all([db.from("user_files").select("*").eq("project_id", p.id).order("created_at"), db.from("user_studies").select("*").eq("project_id", p.id).order("indexed_at")]);
      return json({ project: p, files: files ?? [], studies: studies ?? [], can_edit: p.owner_id === uid, loader_base: `https://singlet.bio/p/${p.id}` });
    }

    if (action === "get_private_study") {
      const pid = UUID.safeParse(body.project_id);
      if (!pid.success || typeof body.study_id !== "string") return fail("invalid_id", "Unknown private study.");
      const p = await projectAccess(pid.data, uid);
      if (!p) return fail("not_found", "That private study does not exist.", 404);
      const { data: study } = await db.from("user_studies").select("*").eq("project_id", p.id).eq("study_id", body.study_id).maybeSingle();
      if (!study) return fail("not_found", "That private study does not exist.", 404);
      const { data: samples } = await db.from("user_samples").select("*, user_sample_qc(*)").eq("study_id", study.id).order("sample_id");
      return json({ project: p, study, samples: samples ?? [], can_edit: p.owner_id === uid });
    }

    if (action === "begin_file") {
      const parsed = z.object({ project_id: UUID, filename: z.string().trim().min(1).max(255), bytes: z.number().int().positive().max(FILE_BYTES_CAP), kind: z.enum(["upload", "url"]), source_url: z.string().url().optional() }).safeParse(body);
      if (!parsed.success) return fail("invalid_file", `Choose a .singlet file up to 2 GB.`);
      const p = await projectAccess(parsed.data.project_id, uid, true);
      if (!p) return fail("not_found", "That project does not exist.", 404);
      if (!parsed.data.filename.toLowerCase().endsWith(".singlet")) return fail("file_type", "Only .singlet files can be added.");
      if (parsed.data.kind === "url" && (!parsed.data.source_url || !URL_RE.test(parsed.data.source_url))) return fail("invalid_url", "Register a public HTTPS URL ending in .singlet.");
      const { count } = await db.from("user_files").select("id", { count: "exact", head: true }).eq("project_id", p.id);
      if ((count ?? 0) >= FILE_CAP) return fail("file_limit", `A project can contain up to ${FILE_CAP} files.`, 409, { limit: FILE_CAP });
      const [{ data: own }, { data: all }] = await Promise.all([db.from("user_files").select("bytes").eq("owner_id", uid).in("status", ["ready", "uploading", "indexing"]), db.from("user_files").select("bytes").in("status", ["ready", "uploading", "indexing"])]);
      const ownBytes = (own ?? []).reduce((n: number, r: { bytes: number }) => n + Number(r.bytes || 0), 0);
      const allBytes = (all ?? []).reduce((n: number, r: { bytes: number }) => n + Number(r.bytes || 0), 0);
      if (ownBytes + parsed.data.bytes > ACCOUNT_BYTES_CAP) return fail("storage_limit", "This file would exceed the 10 GB account storage limit. Delete a stored file or register a public URL instead.", 409, { used: ownBytes, limit: ACCOUNT_BYTES_CAP });
      if (allBytes + parsed.data.bytes > GLOBAL_BYTES_CAP) return fail("storage_paused", "Private file storage is temporarily full. Register a public HTTPS URL instead; it uses no storage.", 503, { limit: GLOBAL_BYTES_CAP });
      const fileId = crypto.randomUUID();
      const objectKey = parsed.data.kind === "upload" ? `users/${uid}/projects/${p.id}/${fileId}-${parsed.data.filename.replace(/[^A-Za-z0-9._-]/g, "_")}` : null;
      const { data, error } = await db.from("user_files").insert({ id: fileId, project_id: p.id, owner_id: uid, kind: parsed.data.kind, filename: parsed.data.filename, object_key: objectKey, source_url: parsed.data.source_url ?? null, bytes: parsed.data.bytes, status: "uploading" }).select("*").single();
      if (error) throw error;
      return json({ file: data, object_key: objectKey });
    }

    if (action === "set_multipart") {
      const parsed = z.object({ file_id: UUID, upload_id: z.string().min(1).max(1000), object_key: z.string().min(1).max(1000), expected_bytes: z.number().int().positive().max(FILE_BYTES_CAP) }).safeParse(body);
      if (!parsed.success) return fail("invalid_upload", "Upload state is invalid.");
      const { data: f } = await db.from("user_files").select("owner_id").eq("id", parsed.data.file_id).eq("owner_id", uid).maybeSingle();
      if (!f) return fail("not_found", "That upload does not exist.", 404);
      const { error } = await db.from("multipart_uploads").upsert({ file_id: parsed.data.file_id, owner_id: uid, r2_upload_id: parsed.data.upload_id, object_key: parsed.data.object_key, expected_bytes: parsed.data.expected_bytes, reserved_bytes: parsed.data.expected_bytes, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() }, { onConflict: "file_id" });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "get_multipart") {
      const id = UUID.safeParse(body.file_id);
      if (!id.success) return fail("invalid_upload", "Upload id is invalid.");
      const { data } = await db.from("multipart_uploads").select("*, user_files!inner(project_id, filename, owner_id)").eq("file_id", id.data).eq("owner_id", uid).maybeSingle();
      if (!data) return fail("not_found", "That upload does not exist or expired.", 404);
      return json({ upload: data });
    }

    if (action === "get_file") {
      const id = UUID.safeParse(body.file_id);
      if (!id.success) return fail("invalid_file", "Unknown file.");
      const { data } = await db.from("user_files").select("*").eq("id", id.data).eq("owner_id", uid).maybeSingle();
      if (!data) return fail("not_found", "That file does not exist.", 404);
      return json({ file: data });
    }

    if (action === "finish_index") {
      const parsed = z.object({ file_id: UUID, bytes: z.number().int().nonnegative(), etag: z.string().max(500).nullable().optional(), study: z.record(z.unknown()), samples: z.array(z.record(z.unknown())).max(5000), qc: z.array(z.record(z.unknown())).max(5000) }).safeParse(body);
      if (!parsed.success) return fail("invalid_index", "The .singlet index was not valid.");
      const { data: f } = await db.from("user_files").select("*, projects!inner(workspace_id)").eq("id", parsed.data.file_id).eq("owner_id", uid).maybeSingle();
      if (!f) return fail("not_found", "That file does not exist.", 404);
      await db.from("user_studies").delete().eq("file_id", f.id);
      const s = parsed.data.study;
      const { data: study, error } = await db.from("user_studies").insert({ file_id: f.id, project_id: f.project_id, owner_id: uid, study_id: text(s.study_id, 120) || f.filename.replace(/\.singlet$/i, ""), title: text(s.title, 1000) || null, abstract: typeof s.abstract === "string" ? s.abstract.slice(0, 100000) : null, organism_primary: text(s.organism_primary, 300) || null, organisms: Array.isArray(s.organisms) ? s.organisms : [], tissue_groups: Array.isArray(s.tissue_groups) ? s.tissue_groups : [], disease_groups: Array.isArray(s.disease_groups) ? s.disease_groups : [], assay_families: Array.isArray(s.assay_families) ? s.assay_families : [], cell_types_raw: Array.isArray(s.cell_types_raw) ? s.cell_types_raw : [], n_samples: parsed.data.samples.length, n_cells: typeof s.n_cells === "number" ? Math.floor(s.n_cells) : null, bytes: parsed.data.bytes, reference_build: text(s.reference_build, 300) || null, singlet_version: text(s.singlet_version, 300) || null, year: typeof s.year === "number" ? Math.floor(s.year) : null, manifest: s.manifest ?? {}, study_meta: s.study_meta ?? {} }).select("*").single();
      if (error) throw error;
      const sampleRows = parsed.data.samples.map((r) => ({ study_id: study.id, project_id: f.project_id, owner_id: uid, sample_id: text(r.sample_id, 160), organism: text(r.organism, 300) || null, tissue: text(r.tissue, 1000) || null, tissue_group: text(r.tissue_group, 300) || null, disease: text(r.disease, 1000) || null, disease_group: text(r.disease_group, 300) || null, protocol: text(r.protocol, 1000) || null, assay_family: text(r.assay_family, 300) || null, cell_type: text(r.cell_type, 1000) || null, characteristics: r.characteristics ?? {} })).filter((r) => r.sample_id);
      for (let i = 0; i < sampleRows.length; i += 500) { const { error: e } = await db.from("user_samples").insert(sampleRows.slice(i, i + 500)); if (e) throw e; }
      const { data: savedSamples } = await db.from("user_samples").select("id, sample_id").eq("study_id", study.id);
      const ids = new Map((savedSamples ?? []).map((r: { id: string; sample_id: string }) => [r.sample_id, r.id]));
      const qcRows = parsed.data.qc.map((r) => ({ sample_id: ids.get(text(r.sample_id, 160)), project_id: f.project_id, owner_id: uid, n_input_reads: r.n_input_reads ?? null, uniquely_mapped_pct: r.uniquely_mapped_pct ?? null, n_cells_called: r.n_cells_called ?? null, median_umi: r.median_umi ?? null, median_genes: r.median_genes ?? null, mapping_rate: r.mapping_rate ?? null, median_mito_fraction: r.median_mito_fraction ?? null, fraction_reads_in_cells: r.fraction_reads_in_cells ?? null, reference_build: text(r.reference_build, 300) || null, singlet_version: text(r.singlet_version, 300) || null, summary: r })).filter((r) => r.sample_id);
      for (let i = 0; i < qcRows.length; i += 500) { const { error: e } = await db.from("user_sample_qc").insert(qcRows.slice(i, i + 500)); if (e) throw e; }
      await Promise.all([db.from("user_files").update({ bytes: parsed.data.bytes, etag: parsed.data.etag ?? null, status: "ready", error: null }).eq("id", f.id), db.from("multipart_uploads").delete().eq("file_id", f.id)]);
      const workspaceId = (f.projects as { workspace_id?: string } | null)?.workspace_id;
      if (workspaceId) await db.from("activity_events").insert({ workspace_id: workspaceId, actor_id: uid, kind: f.kind === "url" ? "file_registered" : "file_uploaded", subject_id: f.id });
      return json({ study });
    }

    if (action === "mark_file_failed") {
      const id = UUID.safeParse(body.file_id);
      if (!id.success) return fail("invalid_file", "Unknown file.");
      await db.from("user_files").update({ status: "failed", error: text(body.error, 1000) || "Could not index this file." }).eq("id", id.data).eq("owner_id", uid);
      await db.from("multipart_uploads").delete().eq("file_id", id.data).eq("owner_id", uid);
      return json({ ok: true });
    }

    if (action === "delete_file" || action === "delete_project") {
      const id = UUID.safeParse(body.id);
      if (!id.success) return fail("invalid_id", "Unknown item.");
      if (action === "delete_file") {
        const { data: f } = await db.from("user_files").select("*").eq("id", id.data).eq("owner_id", uid).maybeSingle();
        if (!f) return fail("not_found", "That file does not exist.", 404);
        await db.from("user_files").delete().eq("id", f.id).eq("owner_id", uid);
        return json({ ok: true, object_key: f.object_key });
      }
      const p = await projectAccess(id.data, uid, true);
      if (!p) return fail("not_found", "That project does not exist.", 404);
      const { data: files } = await db.from("user_files").select("object_key").eq("project_id", p.id);
      await db.from("projects").delete().eq("id", p.id).eq("owner_id", uid);
      return json({ ok: true, object_keys: (files ?? []).map((f: { object_key: string | null }) => f.object_key).filter(Boolean) });
    }

    if (action === "create_workspace") {
      const parsed = z.object({ name: z.string().trim().min(1).max(80), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/) }).safeParse(body);
      if (!parsed.success) return fail("invalid_workspace", "Use a name and a 3–50 character lowercase slug.");
      const { count } = await db.from("workspace_members").select("workspace_id", { count: "exact", head: true }).eq("user_id", uid).eq("role", "owner");
      if ((count ?? 0) >= WORKSPACE_CAP) return fail("workspace_limit", `You can create up to ${WORKSPACE_CAP} workspaces.`, 409, { limit: WORKSPACE_CAP });
      const { data: w, error } = await db.from("workspaces").insert({ owner_id: uid, name: parsed.data.name, slug: parsed.data.slug }).select("*").single();
      if (error) return error.code === "23505" ? fail("slug_taken", "That workspace address is already in use.", 409) : Promise.reject(error);
      await db.from("workspace_members").insert({ workspace_id: w.id, user_id: uid, role: "owner" });
      return json({ workspace: w });
    }

    if (action === "get_workspace") {
      const slug = text(body.slug, 50);
      const { data: w } = await db.from("workspaces").select("*").eq("slug", slug).maybeSingle();
      if (!w) return fail("not_found", "That workspace does not exist.", 404);
      const { data: membership } = await db.from("workspace_members").select("role").eq("workspace_id", w.id).eq("user_id", uid).maybeSingle();
      if (!membership) return fail("not_found", "That workspace is private.", 404);
      const [{ data: members }, { data: projects }, { data: cohorts }, { data: activity }] = await Promise.all([db.from("workspace_members").select("user_id, role, joined_at").eq("workspace_id", w.id), db.from("projects").select("id, name, description, visibility, updated_at").eq("workspace_id", w.id), db.from("cohorts").select("id, name, notes, visibility, catalog_version, updated_at").eq("workspace_id", w.id), db.from("activity_events").select("*").eq("workspace_id", w.id).order("created_at", { ascending: false }).limit(30)]);
      const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
      const { data: profiles } = memberIds.length ? await db.from("profiles").select("id, display_name, email, avatar_url").in("id", memberIds) : { data: [] };
      const profileById = new Map((profiles ?? []).map((p: { id: string }) => [p.id, p]));
      return json({ workspace: w, role: membership.role, members: (members ?? []).map((m: { user_id: string }) => ({ ...m, profile: profileById.get(m.user_id) ?? null })), projects: projects ?? [], cohorts: cohorts ?? [], activity: activity ?? [], limits: { members: MEMBER_CAP } });
    }

    if (action === "invite_workspace") {
      const parsed = z.object({ workspace_id: UUID, email: z.string().email().optional() }).safeParse(body);
      if (!parsed.success) return fail("invalid_invite", "Enter a valid email address or create a link invite.");
      const { data: w } = await db.from("workspaces").select("owner_id").eq("id", parsed.data.workspace_id).eq("owner_id", uid).maybeSingle();
      if (!w) return fail("forbidden", "Only the workspace owner can invite members.", 403);
      const { count } = await db.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", parsed.data.workspace_id);
      if ((count ?? 0) >= MEMBER_CAP) return fail("member_limit", `A workspace can have up to ${MEMBER_CAP} members.`, 409, { limit: MEMBER_CAP });
      const inviteToken = token("swi");
      const { data, error } = await db.from("workspace_invites").insert({ workspace_id: parsed.data.workspace_id, created_by: uid, email: parsed.data.email?.toLowerCase() ?? null, token_hash: await sha256Hex(inviteToken), expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() }).select("id, expires_at").single();
      if (error) throw error;
      return json({ invite: data, token: inviteToken, url: `https://singlet.bio/join/${inviteToken}` });
    }

    if (action === "accept_invite") {
      const inviteToken = text(body.token, 200);
      const { data: inv } = await db.from("workspace_invites").select("*").eq("token_hash", await sha256Hex(inviteToken)).is("accepted_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!inv) return fail("invalid_invite", "This invite is invalid, expired or already used.", 410);
      if (inv.email && who.email && inv.email.toLowerCase() !== who.email.toLowerCase()) return fail("wrong_account", `This invite was sent to ${inv.email}. Sign in with that email address.`, 403);
      const { count } = await db.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", inv.workspace_id);
      if ((count ?? 0) >= MEMBER_CAP) return fail("member_limit", `This workspace already has ${MEMBER_CAP} members.`, 409);
      await db.from("workspace_members").upsert({ workspace_id: inv.workspace_id, user_id: uid, role: "member" });
      await db.from("workspace_invites").update({ accepted_at: new Date().toISOString(), accepted_by: uid }).eq("id", inv.id);
      await db.from("activity_events").insert({ workspace_id: inv.workspace_id, actor_id: uid, kind: "member_joined" });
      const { data: w } = await db.from("workspaces").select("slug").eq("id", inv.workspace_id).single();
      return json({ ok: true, slug: w.slug });
    }

    if (action === "save_cohort") {
      const parsed = z.object({ name: z.string().trim().min(1).max(120), notes: z.string().max(20000).default(""), query: z.string().max(500).default(""), filters: z.record(z.unknown()).default({}), visibility: VISIBILITY, workspace_id: UUID.nullable().optional(), public_gse_ids: z.array(z.string().regex(/^GSE\d+$/)).max(2000).default([]), private_study_ids: z.array(UUID).max(2000).default([]) }).safeParse(body);
      if (!parsed.success || parsed.data.public_gse_ids.length + parsed.data.private_study_ids.length === 0) return fail("invalid_cohort", "Name the cohort and include at least one study (up to 2,000).");
      if (parsed.data.workspace_id) {
        const { data: m } = await db.from("workspace_members").select("role").eq("workspace_id", parsed.data.workspace_id).eq("user_id", uid).maybeSingle();
        if (!m) return fail("workspace_access", "You are not a member of that workspace.", 403);
      }
      const shareToken = parsed.data.visibility === "link" ? token("sco") : null;
      const { data: c, error } = await db.from("cohorts").insert({ owner_id: uid, workspace_id: parsed.data.workspace_id ?? null, name: parsed.data.name, notes: parsed.data.notes, query: parsed.data.query, filters: parsed.data.filters, catalog_version: await catalogVersion(), visibility: parsed.data.visibility, share_token_hash: shareToken ? await sha256Hex(shareToken) : null, share_token_prefix: shareToken?.slice(0, 12) ?? null }).select("*").single();
      if (error) throw error;
      const items = [...parsed.data.public_gse_ids.map((g, i) => ({ cohort_id: c.id, public_gse_id: g, position: i })), ...parsed.data.private_study_ids.map((id, i) => ({ cohort_id: c.id, private_study_id: id, position: parsed.data.public_gse_ids.length + i }))];
      for (let i = 0; i < items.length; i += 500) { const { error: e } = await db.from("cohort_items").insert(items.slice(i, i + 500)); if (e) throw e; }
      if (c.workspace_id) await db.from("activity_events").insert({ workspace_id: c.workspace_id, actor_id: uid, kind: "cohort_saved", subject_id: c.id });
      return json({ cohort: c, share_token: shareToken, url: `https://singlet.bio/c/${c.id}${shareToken ? `?token=${shareToken}` : ""}` });
    }

    if (action === "comment_cohort") {
      const parsed = z.object({ cohort_id: UUID, body: z.string().trim().min(1).max(4000) }).safeParse(body);
      if (!parsed.success) return fail("invalid_comment", "Comments must be 1–4,000 characters.");
      const c = await cohortAccess(parsed.data.cohort_id, uid);
      if (!c || !c.workspace_id) return fail("forbidden", "Comments are available to workspace cohorts.", 403);
      const { data, error } = await db.from("cohort_comments").insert({ cohort_id: c.id, author_id: uid, body: parsed.data.body }).select("*").single();
      if (error) throw error;
      await db.from("activity_events").insert({ workspace_id: c.workspace_id, actor_id: uid, kind: "comment_added", subject_id: data.id });
      return json({ comment: data });
    }

    if (action === "set_weekly_summary") {
      const enabled = body.enabled === true;
      await db.from("account_preferences").upsert({ user_id: uid, weekly_summary: enabled }, { onConflict: "user_id" });
      return json({ weekly_summary: enabled });
    }

    if (action === "log_usage") {
      const parsed = z.object({ tool: z.string().min(1).max(80), kind: z.enum(["mcp", "api", "download", "partial_download"]), calls: z.number().int().positive().max(1000).default(1), bytes: z.number().int().nonnegative().default(0), ms: z.number().int().nonnegative().default(0), key_prefix: z.string().max(40).nullable().optional() }).safeParse(body);
      if (!parsed.success) return fail("invalid_usage", "Usage event is invalid.");
      await db.from("usage_events").insert({ user_id: uid, ...parsed.data });
      return json({ ok: true });
    }

    return fail("unknown_action", `Unknown action '${action}'.`);
  } catch (e) {
    console.error("[product-data]", action, String(e));
    return fail("server_error", "Could not complete that request right now.", 500);
  }
});
