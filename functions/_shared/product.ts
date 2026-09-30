/**
 * Private projects, files, cohorts and workspaces ("Stage 12") on D1
 * (schema/011_product.sql): the actions behind POST /api/product, with their
 * request bodies, response shapes, caps and messages.
 *
 * D1 has no row-level security, so every access rule lives here:
 *   - projects, files, studies, samples: the owner; also workspace members
 *     when the project's visibility is 'workspace'. Only the owner writes.
 *   - private file downloads: the above, or the project's read token (spr_…).
 *   - cohorts: the owner; workspace members when visibility is 'workspace';
 *     anyone holding the share token (sco_…) when visibility is 'link'.
 *   - workspaces: members read; only the owner invites.
 * Tokens are random (24 bytes); only sha256(token) is stored.
 *
 * Callers resolve the user first (identity.ts requireUser / resolveIdentity)
 * and pass the user id in. Two ways in:
 *   - runProductAction: the actions POST /api/product may run;
 *   - the named exports: also used in-process by /api/projects/* for uploads,
 *     indexing and downloads. beginFile, setMultipart, getMultipart,
 *     finishIndex, markFileFailed and authorizePrivateFile are deliberately
 *     not reachable over HTTP — a client must never choose an R2 object key,
 *     hand in its own index, or read a stored file without the checks there.
 *
 * Failures throw ProductError (code, message, HTTP status, extra fields); the
 * routes turn it into {error, message, ...extra}. Anything else is a 500.
 */
import { CORS_HEADERS } from "./cors";
import { sha256Hex, timingSafeEqual } from "./hash";
import { nowIso } from "./session";

export const PROJECT_CAP = 5;
export const WORKSPACE_CAP = 3;
export const MEMBER_CAP = 10;
export const COHORT_CAP = 50;
export const FILE_CAP = 20;
export const ACCOUNT_BYTES_CAP = 10 * 1024 ** 3;
export const GLOBAL_BYTES_CAP = 2 * 1024 ** 4;
export const FILE_BYTES_CAP = 2 * 1024 ** 3;
/** Most samples one private .singlet may index. */
export const MAX_INDEX_SAMPLES = 5000;
/** Catalog snapshot pinned on every new cohort. */
export const CATALOG_VERSION = "2026.09";

const SIGN_IN_MESSAGE = "Sign in to use private projects, cohorts and workspaces.";
const URL_RE = /^https:\/\//i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/;
const GSE_ID_RE = /^GSE\d+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VISIBILITIES = ["private", "workspace", "link"] as const;
const USAGE_KINDS = ["mcp", "api", "download", "partial_download"] as const;
/** Files that hold (or are about to hold) stored bytes. */
const LIVE_STATUSES = "('ready', 'uploading', 'indexing')";
/** Rows per json_each() insert, and the JSON size of one bound parameter (D1 caps a value at 2 MB). */
const JSON_CHUNK_ROWS = 400;
const JSON_CHUNK_CHARS = 500_000;
/** manifest / study_meta larger than this lose gsm_meta (then everything) so the row fits D1. */
const MAX_JSON_COLUMN_CHARS = 600_000;

export type Visibility = (typeof VISIBILITIES)[number];
type ActivityKind = "project_created" | "file_uploaded" | "file_registered" | "cohort_saved" | "comment_added" | "member_joined";

export interface ProductCtx {
  db: D1Database;
  /** Origin for links in responses (https://singlet.bio in production). */
  origin: string;
}

export type ProductBody = Record<string, unknown>;

export class ProductError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ProductError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const fail = (code: string, message: string, status = 400, extra: Record<string, unknown> = {}) =>
  new ProductError(code, message, status, extra);

/** JSON response in the shape every product endpoint uses. */
export function productJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}

/** ProductError → {error, message, ...extra} with its status; anything else → logged 500. */
export function productErrorResponse(e: unknown, action: string): Response {
  if (e instanceof ProductError) return productJson({ error: e.code, message: e.message, ...e.extra }, e.status);
  console.error("[product]", action, String(e));
  return productJson({ error: "server_error", message: "Could not complete that request right now." }, 500);
}

// ── Row shapes ──────────────────────────────────────────────────────────────

type ProjectRow = {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  visibility: Visibility;
  read_token_hash: string;
  read_token_prefix: string;
  created_at: string;
  updated_at: string;
};

type CohortRow = {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  notes: string;
  query: string;
  filters: string;
  catalog_version: string;
  visibility: Visibility;
  share_token_hash: string | null;
  share_token_prefix: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRow = { id: string; owner_id: string; name: string; slug: string; created_at: string; updated_at: string };

type InviteRow = { id: string; workspace_id: string; email: string | null };

export type UserFileRow = {
  id: string;
  project_id: string;
  owner_id: string;
  kind: "upload" | "url";
  filename: string;
  object_key: string | null;
  source_url: string | null;
  bytes: number;
  etag: string | null;
  status: "uploading" | "indexing" | "ready" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type MultipartState = {
  id: string;
  file_id: string;
  owner_id: string;
  r2_upload_id: string;
  object_key: string;
  expected_bytes: number;
  reserved_bytes: number;
  expires_at: string;
  created_at: string;
  user_files: { project_id: string; filename: string; owner_id: string };
};

type MultipartRow = Omit<MultipartState, "user_files"> & { file_project_id: string; file_filename: string; file_owner_id: string };

/** An R2 multipart upload that was started but never completed; the caller aborts it. */
export type PendingUpload = { object_key: string; r2_upload_id: string };

export type AuthorizedFile = {
  project: { id: string; name: string };
  study: { id: string; study_id: string; file_id: string };
  file: {
    id: string;
    filename: string;
    kind: "upload" | "url";
    object_key: string | null;
    source_url: string | null;
    bytes: number;
    etag: string | null;
    status: string;
  };
};

// ── Small validators (the original used zod) ────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Whitespace-collapsed, trimmed, truncated string; "" for non-strings. */
function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function uuid(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** z.string().trim().min(1).max(max): the trimmed string, or null. */
function requiredName(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

/** z.string().max(max).default(""): undefined → "", non-string or too long → null. */
function optionalText(v: unknown, max: number): string | null {
  if (v === undefined) return "";
  return typeof v === "string" && v.length <= max ? v : null;
}

function boundedString(v: unknown, min: number, max: number): string | null {
  return typeof v === "string" && v.length >= min && v.length <= max ? v : null;
}

function visibility(v: unknown): Visibility | null {
  return typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v) ? (v as Visibility) : null;
}

/** UUID.nullable().optional(): undefined/null → null, a uuid → it, anything else → false. */
function optionalUuid(v: unknown): string | null | false {
  if (v === undefined || v === null) return null;
  return uuid(v) ?? false;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function floorOrNull(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.floor(n);
}

function sliceOrNull(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

function arrayOrEmpty(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function validUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    new URL(v);
    return v;
  } catch {
    return null;
  }
}

/** undefined → []; otherwise an array (≤ max) whose every item is a string passing `ok`, or null. */
function stringList(v: unknown, max: number, ok: (s: string) => boolean): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || !ok(item)) return null;
    out.push(item);
  }
  return out;
}

function recordArray(v: unknown, max: number): Record<string, unknown>[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: Record<string, unknown>[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    out.push(item);
  }
  return out;
}

// ── JSON columns, tokens, helpers ───────────────────────────────────────────

function jsonText(v: unknown, fallback: string): string {
  try {
    const s = JSON.stringify(v);
    return typeof s === "string" ? s : fallback;
  } catch {
    return fallback;
  }
}

function parseJson(v: unknown, fallback: unknown): unknown {
  if (typeof v !== "string") return v ?? fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** JSON text for a jsonb-style column that must fit a D1 row. */
function boundedJson(v: unknown): string {
  let s = jsonText(v, "{}");
  if (s.length > MAX_JSON_COLUMN_CHARS && isRecord(v) && "gsm_meta" in v) {
    const { gsm_meta: _dropped, ...rest } = v;
    s = jsonText(rest, "{}");
  }
  return s.length > MAX_JSON_COLUMN_CHARS ? "{}" : s;
}

/** Split rows into JSON arrays, each small enough to bind as one json_each() parameter. */
function jsonChunks(items: readonly unknown[]): string[] {
  const out: string[] = [];
  let parts: string[] = [];
  let chars = 2;
  for (const row of items) {
    const s = jsonText(row, "null");
    if (parts.length && (parts.length >= JSON_CHUNK_ROWS || chars + s.length + 1 > JSON_CHUNK_CHARS)) {
      out.push(`[${parts.join(",")}]`);
      parts = [];
      chars = 2;
    }
    parts.push(s);
    chars += s.length + 1;
  }
  if (parts.length) out.push(`[${parts.join(",")}]`);
  return out;
}

function newToken(prefix: string): string {
  let hex = "";
  for (const b of crypto.getRandomValues(new Uint8Array(24))) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

function rows<T>(r: D1Result<unknown>): T[] {
  return (r.results ?? []) as T[];
}

async function countOf(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

const STUDY_ARRAY_COLUMNS = ["organisms", "tissue_groups", "disease_groups", "assay_families", "cell_types_raw"] as const;
const STUDY_OBJECT_COLUMNS = ["manifest", "study_meta"] as const;

function studyOut(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const c of STUDY_ARRAY_COLUMNS) out[c] = parseJson(row[c], []);
  for (const c of STUDY_OBJECT_COLUMNS) out[c] = parseJson(row[c], {});
  return out;
}

/** Projects and cohorts never leave the server with their token hashes. */
function publicProject(p: ProjectRow): Omit<ProjectRow, "read_token_hash"> {
  const { read_token_hash: _hash, ...rest } = p;
  return rest;
}

function publicCohort(c: CohortRow): Record<string, unknown> {
  const { share_token_hash: _hash, filters, ...rest } = c;
  return { ...rest, filters: parseJson(filters, {}) };
}

function activityStatement(
  db: D1Database,
  workspaceId: string,
  actorId: string,
  kind: ActivityKind,
  subjectId: string | null,
  at: string,
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO activity_events (workspace_id, actor_id, kind, subject_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(workspaceId, actorId, kind, subjectId, at);
}

/** Delete studies (and their samples, QC and cohort references) selected by `studyIdsSql`. */
function deleteStudiesStatements(db: D1Database, studyIdsSql: string, ...binds: unknown[]): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM user_sample_qc WHERE sample_id IN (SELECT id FROM user_samples WHERE study_id IN (${studyIdsSql}))`).bind(...binds),
    db.prepare(`DELETE FROM user_samples WHERE study_id IN (${studyIdsSql})`).bind(...binds),
    db.prepare(`DELETE FROM cohort_items WHERE private_study_id IN (${studyIdsSql})`).bind(...binds),
    db.prepare(`DELETE FROM user_studies WHERE id IN (${studyIdsSql})`).bind(...binds),
  ];
}

// ── Access rules ────────────────────────────────────────────────────────────

async function isMember(db: D1Database, workspaceId: string, uid: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2`)
    .bind(workspaceId, uid)
    .first<{ ok: number }>();
  return row !== null;
}

/** The project if `uid` may read it (write = owner only), else null. */
async function projectAccess(db: D1Database, id: string, uid: string, write = false): Promise<ProjectRow | null> {
  const p = await db.prepare(`SELECT * FROM projects WHERE id = ?1`).bind(id).first<ProjectRow>();
  if (!p) return null;
  if (p.owner_id === uid) return p;
  if (write || p.visibility !== "workspace" || !p.workspace_id) return null;
  return (await isMember(db, p.workspace_id, uid)) ? p : null;
}

/** The cohort if the caller (possibly anonymous, possibly holding a share token) may read it. */
async function cohortAccess(db: D1Database, id: string, uid: string | null, shareToken?: string): Promise<CohortRow | null> {
  const c = await db.prepare(`SELECT * FROM cohorts WHERE id = ?1`).bind(id).first<CohortRow>();
  if (!c) return null;
  if (uid && c.owner_id === uid) return c;
  if (uid && c.visibility === "workspace" && c.workspace_id && (await isMember(db, c.workspace_id, uid))) return c;
  if (c.visibility === "link" && shareToken && c.share_token_hash && timingSafeEqual(c.share_token_hash, await sha256Hex(shareToken))) return c;
  return null;
}

// ── Anonymous-capable reads ─────────────────────────────────────────────────

/**
 * May this caller read one private study's file? Owner, workspace member
 * (visibility 'workspace') or anyone with the project's read token.
 */
export async function authorizePrivateFile(ctx: ProductCtx, uid: string | null, body: ProductBody): Promise<AuthorizedFile> {
  const projectId = uuid(body.project_id);
  const studyId = text(body.study_id, 160);
  if (!projectId || !studyId) throw fail("invalid_id", "Unknown private study.");
  const supplied = text(body.read_token, 200);
  const db = ctx.db;
  const p = await db.prepare(`SELECT * FROM projects WHERE id = ?1`).bind(projectId).first<ProjectRow>();
  let allowed = p !== null && uid !== null && uid === p.owner_id;
  if (!allowed && p && uid && p.visibility === "workspace" && p.workspace_id) allowed = await isMember(db, p.workspace_id, uid);
  if (!allowed && p && supplied) allowed = timingSafeEqual(p.read_token_hash, await sha256Hex(supplied));
  if (!allowed || !p) throw fail("not_found", "That private study is not available with this account or token.", 404);
  const study = await db
    .prepare(`SELECT id, study_id, file_id FROM user_studies WHERE project_id = ?1 AND study_id = ?2`)
    .bind(p.id, studyId)
    .first<AuthorizedFile["study"]>();
  if (!study) throw fail("not_found", "That private study does not exist.", 404);
  const file = await db
    .prepare(`SELECT id, filename, kind, object_key, source_url, bytes, etag, status FROM user_files WHERE id = ?1 AND status = 'ready'`)
    .bind(study.file_id)
    .first<AuthorizedFile["file"]>();
  if (!file) throw fail("not_found", "That private file is not ready.", 404);
  return { project: { id: p.id, name: p.name }, study, file };
}

export async function getCohort(ctx: ProductCtx, uid: string | null, body: ProductBody) {
  const id = uuid(body.id);
  if (!id) throw fail("invalid_id", "Unknown cohort.");
  const db = ctx.db;
  const token = body.token;
  const c = await cohortAccess(db, id, uid, typeof token === "string" ? token : undefined);
  if (!c) throw fail("not_found", "That cohort is private or does not exist.", 404);
  const items = await db
    .prepare(`SELECT id, public_gse_id, private_study_id, position FROM cohort_items WHERE cohort_id = ?1 ORDER BY position, rowid`)
    .bind(c.id)
    .all();
  const comments = c.workspace_id
    ? (
        await db
          .prepare(`SELECT id, author_id, body, created_at, updated_at FROM cohort_comments WHERE cohort_id = ?1 ORDER BY created_at, rowid`)
          .bind(c.id)
          .all()
      ).results
    : [];
  return { cohort: publicCohort(c), items: items.results ?? [], comments: comments ?? [], can_edit: uid !== null && uid === c.owner_id };
}

// ── Signed-in actions ───────────────────────────────────────────────────────

export async function dashboard(ctx: ProductCtx, uid: string) {
  const db = ctx.db;
  const today = nowIso().slice(0, 10);
  const weekStart = nowIso(Date.now() - 6 * 86_400_000).slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [projects, cohorts, workspaces, files, prefs, mcp, downloads, storage] = await db.batch([
    db
      .prepare(
        `SELECT id, name, description, visibility, workspace_id, read_token_prefix, created_at, updated_at
           FROM projects WHERE owner_id = ?1 ORDER BY updated_at DESC, rowid DESC`,
      )
      .bind(uid),
    db
      .prepare(
        `SELECT id, name, notes, query, visibility, workspace_id, catalog_version, created_at, updated_at
           FROM cohorts WHERE owner_id = ?1 ORDER BY updated_at DESC, rowid DESC`,
      )
      .bind(uid),
    db
      .prepare(
        `SELECT w.id, w.name, w.slug, w.owner_id, w.created_at, w.updated_at
           FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
          WHERE m.user_id = ?1 ORDER BY w.updated_at DESC, w.rowid DESC`,
      )
      .bind(uid),
    db
      .prepare(
        `SELECT f.id, f.project_id, f.filename, f.kind, f.bytes, f.status, f.error, f.created_at, f.updated_at
           FROM user_files f JOIN projects p ON p.id = f.project_id
          WHERE p.owner_id = ?1 ORDER BY f.created_at, f.rowid`,
      )
      .bind(uid),
    db.prepare(`SELECT weekly_summary FROM account_preferences WHERE user_id = ?1`).bind(uid),
    db
      .prepare(`SELECT tool, SUM(calls) AS calls FROM usage_events WHERE user_id = ?1 AND kind = 'mcp' AND day >= ?2 GROUP BY tool`)
      .bind(uid, weekStart),
    db
      .prepare(
        `SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(bytes), 0) AS bytes
           FROM usage_events WHERE user_id = ?1 AND kind IN ('download', 'partial_download') AND day >= ?2`,
      )
      .bind(uid, monthStart),
    db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM user_files WHERE owner_id = ?1 AND status = 'ready' AND kind = 'upload'`).bind(uid),
  ]);
  const projectRows = rows<Record<string, unknown>>(projects);
  const cohortRows = rows<Record<string, unknown>>(cohorts);
  const mcpWeek: Record<string, number> = {};
  for (const r of rows<{ tool: string; calls: number }>(mcp)) mcpWeek[r.tool] = Number(r.calls) || 0;
  const dl = rows<{ calls: number; bytes: number }>(downloads)[0];
  const stored = rows<{ bytes: number }>(storage)[0];
  const pref = rows<{ weekly_summary: number }>(prefs)[0];
  return {
    projects: projectRows,
    files: rows(files),
    cohorts: cohortRows,
    workspaces: rows(workspaces),
    usage: {
      mcp_week: mcpWeek,
      downloads_month: Number(dl?.calls ?? 0),
      download_bytes_month: Number(dl?.bytes ?? 0),
      storage_bytes: Number(stored?.bytes ?? 0),
      projects: projectRows.length,
      cohorts: cohortRows.length,
    },
    weekly_summary: pref?.weekly_summary === 1,
    limits: {
      projects: PROJECT_CAP,
      files_per_project: FILE_CAP,
      storage_bytes: ACCOUNT_BYTES_CAP,
      workspaces: WORKSPACE_CAP,
      members_per_workspace: MEMBER_CAP,
      cohorts: COHORT_CAP,
      file_bytes: FILE_BYTES_CAP,
    },
  };
}

const projectLimit = () =>
  fail("project_limit", `You can have up to ${PROJECT_CAP} private projects. Delete one before creating another.`, 409, { limit: PROJECT_CAP });

export async function createProject(ctx: ProductCtx, uid: string, body: ProductBody) {
  const name = requiredName(body.name, 100);
  const description = optionalText(body.description, 4000);
  const vis = visibility(body.visibility);
  const workspaceId = optionalUuid(body.workspace_id);
  if (name === null || description === null || vis === null || workspaceId === false) {
    throw fail("invalid_project", "Give the project a name and valid visibility.");
  }
  const db = ctx.db;
  if ((await countOf(db, `SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?1`, uid)) >= PROJECT_CAP) throw projectLimit();
  if (workspaceId && !(await isMember(db, workspaceId, uid))) throw fail("workspace_access", "You are not a member of that workspace.", 403);
  const readToken = newToken("spr");
  const now = nowIso();
  // The cap is re-checked inside the INSERT so two tabs cannot both squeeze past it.
  const project = await db
    .prepare(
      `INSERT INTO projects (id, owner_id, workspace_id, name, description, visibility, read_token_hash, read_token_prefix, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9
        WHERE (SELECT COUNT(*) FROM projects WHERE owner_id = ?2) < ?10
       RETURNING *`,
    )
    .bind(crypto.randomUUID(), uid, workspaceId, name, description, vis, await sha256Hex(readToken), readToken.slice(0, 12), now, PROJECT_CAP)
    .first<ProjectRow>();
  if (!project) throw projectLimit();
  if (project.workspace_id) await activityStatement(db, project.workspace_id, uid, "project_created", project.id, now).run();
  return { project: publicProject(project), read_token: readToken };
}

/**
 * Summary rows for the Browse "Your private studies" list. manifest and
 * study_meta (up to ~600k characters each) are left out, so 200 rows stay
 * small; get_private_study returns the full row. The abstract is read only
 * for the text filter and is not returned.
 */
export async function listPrivateStudies(ctx: ProductCtx, uid: string, body: ProductBody) {
  const q = text(body.query, 500).toLowerCase();
  const res = await ctx.db
    .prepare(
      `SELECT s.id, s.project_id, s.file_id, s.owner_id, s.study_id, s.title, s.abstract, s.organism_primary, s.organisms,
              s.tissue_groups, s.disease_groups, s.assay_families, s.cell_types_raw, s.n_samples, s.n_cells, s.bytes,
              s.reference_build, s.singlet_version, s.year, s.indexed_at,
              p.name AS project_name, p.visibility AS project_visibility, p.workspace_id AS project_workspace_id
         FROM user_studies s JOIN projects p ON p.id = s.project_id
        WHERE p.owner_id = ?1
           OR (p.visibility = 'workspace' AND p.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?1))
        ORDER BY s.indexed_at DESC, s.rowid DESC
        LIMIT 200`,
    )
    .bind(uid)
    .all<Record<string, unknown>>();
  const studies = (res.results ?? [])
    .map((r): Record<string, unknown> => {
      const { project_name, project_visibility, project_workspace_id, ...row } = r;
      const out: Record<string, unknown> = { ...row };
      for (const c of STUDY_ARRAY_COLUMNS) out[c] = parseJson(row[c], []);
      return { ...out, projects: { name: project_name, visibility: project_visibility, workspace_id: project_workspace_id } };
    })
    .filter(
      (s) =>
        !q ||
        [s.study_id, s.title, s.abstract, s.organism_primary, JSON.stringify(s.tissue_groups), JSON.stringify(s.disease_groups), JSON.stringify(s.cell_types_raw)]
          .join(" ")
          .toLowerCase()
          .includes(q),
    )
    .map(({ abstract: _abstract, ...s }) => s);
  return { studies };
}

export async function getProject(ctx: ProductCtx, uid: string, body: ProductBody) {
  const id = uuid(body.id);
  if (!id) throw fail("invalid_id", "Unknown project.");
  const db = ctx.db;
  const p = await projectAccess(db, id, uid);
  if (!p) throw fail("not_found", "That project is private or does not exist.", 404);
  const [files, studies] = await db.batch([
    db.prepare(`SELECT * FROM user_files WHERE project_id = ?1 ORDER BY created_at, rowid`).bind(p.id),
    db.prepare(`SELECT * FROM user_studies WHERE project_id = ?1 ORDER BY indexed_at, rowid`).bind(p.id),
  ]);
  return {
    project: publicProject(p),
    files: rows(files),
    studies: rows<Record<string, unknown>>(studies).map(studyOut),
    can_edit: p.owner_id === uid,
    loader_base: `${ctx.origin}/p/${p.id}`,
  };
}

export async function getPrivateStudy(ctx: ProductCtx, uid: string, body: ProductBody) {
  const pid = uuid(body.project_id);
  const studyId = body.study_id;
  if (!pid || typeof studyId !== "string") throw fail("invalid_id", "Unknown private study.");
  const db = ctx.db;
  const p = await projectAccess(db, pid, uid);
  if (!p) throw fail("not_found", "That private study does not exist.", 404);
  const study = await db
    .prepare(`SELECT * FROM user_studies WHERE project_id = ?1 AND study_id = ?2`)
    .bind(p.id, studyId)
    .first<Record<string, unknown>>();
  if (!study) throw fail("not_found", "That private study does not exist.", 404);
  const sid = String(study.id);
  const [samples, qc] = await db.batch([
    db.prepare(`SELECT * FROM user_samples WHERE study_id = ?1 ORDER BY sample_id`).bind(sid),
    db.prepare(`SELECT q.* FROM user_sample_qc q JOIN user_samples s ON s.id = q.sample_id WHERE s.study_id = ?1`).bind(sid),
  ]);
  const qcBySample = new Map<string, Record<string, unknown>>();
  for (const r of rows<Record<string, unknown>>(qc)) qcBySample.set(String(r.sample_id), { ...r, summary: parseJson(r.summary, {}) });
  return {
    project: publicProject(p),
    study: studyOut(study),
    samples: rows<Record<string, unknown>>(samples).map((s) => ({
      ...s,
      characteristics: parseJson(s.characteristics, {}),
      user_sample_qc: qcBySample.get(String(s.id)) ?? null,
    })),
    can_edit: p.owner_id === uid,
  };
}

const fileLimit = () => fail("file_limit", `A project can contain up to ${FILE_CAP} files.`, 409, { limit: FILE_CAP });

/** Why storing `bytes` more for `uid` would break the account or the global cap, or null when it fits. */
async function storageRefusal(db: D1Database, uid: string, bytes: number): Promise<ProductError | null> {
  const [own, all] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM user_files WHERE owner_id = ?1 AND kind = 'upload' AND status IN ${LIVE_STATUSES}`).bind(uid),
    db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM user_files WHERE kind = 'upload' AND status IN ${LIVE_STATUSES}`),
  ]);
  const ownBytes = Number(rows<{ n: number }>(own)[0]?.n ?? 0);
  const allBytes = Number(rows<{ n: number }>(all)[0]?.n ?? 0);
  if (ownBytes + bytes > ACCOUNT_BYTES_CAP) {
    return fail(
      "storage_limit",
      "This file would exceed the 10 GB account storage limit. Delete a stored file or register a public URL instead.",
      409,
      { used: ownBytes, limit: ACCOUNT_BYTES_CAP },
    );
  }
  if (allBytes + bytes > GLOBAL_BYTES_CAP) {
    return fail("storage_paused", "Private file storage is temporarily full. Register a public HTTPS URL instead; it uses no storage.", 503, {
      limit: GLOBAL_BYTES_CAP,
    });
  }
  return null;
}

/**
 * Reserve a file row (status 'uploading') before any bytes move. Storage caps
 * apply to stored uploads only: a registered public URL uses no storage.
 */
export async function beginFile(ctx: ProductCtx, uid: string, body: ProductBody): Promise<{ file: UserFileRow; object_key: string | null }> {
  const projectId = uuid(body.project_id);
  const filename = requiredName(body.filename, 255);
  const bytes = int(body.bytes);
  const kind: "upload" | "url" | null = body.kind === "upload" ? "upload" : body.kind === "url" ? "url" : null;
  const sourceUrl = body.source_url === undefined ? undefined : validUrl(body.source_url);
  if (!projectId || filename === null || bytes === null || bytes <= 0 || bytes > FILE_BYTES_CAP || kind === null || sourceUrl === null) {
    throw fail("invalid_file", "Choose a .singlet file up to 2 GB.");
  }
  const db = ctx.db;
  const p = await projectAccess(db, projectId, uid, true);
  if (!p) throw fail("not_found", "That project does not exist.", 404);
  if (!filename.toLowerCase().endsWith(".singlet")) throw fail("file_type", "Only .singlet files can be added.");
  if (kind === "url" && (!sourceUrl || !URL_RE.test(sourceUrl))) throw fail("invalid_url", "Register a public HTTPS URL ending in .singlet.");
  if ((await countOf(db, `SELECT COUNT(*) AS n FROM user_files WHERE project_id = ?1`, p.id)) >= FILE_CAP) throw fileLimit();
  if (kind === "upload") {
    const refused = await storageRefusal(db, uid, bytes);
    if (refused) throw refused;
  }
  const fileId = crypto.randomUUID();
  const objectKey = kind === "upload" ? `users/${uid}/projects/${p.id}/${fileId}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}` : null;
  const now = nowIso();
  // Every cap is re-checked inside the INSERT, so parallel requests cannot all
  // pass the reads above and together overshoot the file count or byte caps.
  const file = await db
    .prepare(
      `INSERT INTO user_files (id, project_id, owner_id, kind, filename, object_key, source_url, bytes, status, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'uploading', ?9, ?9
        WHERE (SELECT COUNT(*) FROM user_files WHERE project_id = ?2) < ?10
          AND (?4 <> 'upload' OR (
                (SELECT COALESCE(SUM(bytes), 0) FROM user_files WHERE owner_id = ?3 AND kind = 'upload' AND status IN ${LIVE_STATUSES}) + ?8 <= ?11
            AND (SELECT COALESCE(SUM(bytes), 0) FROM user_files WHERE kind = 'upload' AND status IN ${LIVE_STATUSES}) + ?8 <= ?12))
       RETURNING *`,
    )
    .bind(fileId, p.id, uid, kind, filename, objectKey, kind === "url" ? (sourceUrl ?? null) : null, bytes, now, FILE_CAP, ACCOUNT_BYTES_CAP, GLOBAL_BYTES_CAP)
    .first<UserFileRow>();
  if (!file) throw (kind === "upload" ? await storageRefusal(db, uid, bytes) : null) ?? fileLimit();
  return { file, object_key: objectKey };
}

/** Remember the R2 multipart upload for a reserved file (24 h). The key must be the one beginFile chose. */
export async function setMultipart(ctx: ProductCtx, uid: string, body: ProductBody) {
  const fileId = uuid(body.file_id);
  const uploadId = boundedString(body.upload_id, 1, 1000);
  const objectKey = boundedString(body.object_key, 1, 1000);
  const expected = int(body.expected_bytes);
  if (!fileId || !uploadId || !objectKey || expected === null || expected <= 0 || expected > FILE_BYTES_CAP) {
    throw fail("invalid_upload", "Upload state is invalid.");
  }
  const db = ctx.db;
  const f = await db
    .prepare(`SELECT object_key FROM user_files WHERE id = ?1 AND owner_id = ?2`)
    .bind(fileId, uid)
    .first<{ object_key: string | null }>();
  if (!f) throw fail("not_found", "That upload does not exist.", 404);
  if (f.object_key !== objectKey) throw fail("invalid_upload", "Upload state is invalid.");
  await db
    .prepare(
      `INSERT INTO multipart_uploads (id, file_id, owner_id, r2_upload_id, object_key, expected_bytes, reserved_bytes, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)
       ON CONFLICT (file_id) DO UPDATE SET
         owner_id = excluded.owner_id, r2_upload_id = excluded.r2_upload_id, object_key = excluded.object_key,
         expected_bytes = excluded.expected_bytes, reserved_bytes = excluded.reserved_bytes, expires_at = excluded.expires_at`,
    )
    .bind(crypto.randomUUID(), fileId, uid, uploadId, objectKey, expected, nowIso(Date.now() + 24 * 3_600_000), nowIso())
    .run();
  return { ok: true };
}

export async function getMultipart(ctx: ProductCtx, uid: string, body: ProductBody): Promise<{ upload: MultipartState }> {
  const id = uuid(body.file_id);
  if (!id) throw fail("invalid_upload", "Upload id is invalid.");
  const row = await ctx.db
    .prepare(
      `SELECT m.*, f.project_id AS file_project_id, f.filename AS file_filename, f.owner_id AS file_owner_id
         FROM multipart_uploads m JOIN user_files f ON f.id = m.file_id
        WHERE m.file_id = ?1 AND m.owner_id = ?2 AND m.expires_at > ?3`,
    )
    .bind(id, uid, nowIso())
    .first<MultipartRow>();
  if (!row) throw fail("not_found", "That upload does not exist or expired.", 404);
  const { file_project_id, file_filename, file_owner_id, ...upload } = row;
  return { upload: { ...upload, user_files: { project_id: file_project_id, filename: file_filename, owner_id: file_owner_id } } };
}

/**
 * Claim up to `limit` expired multipart reservations (any owner): their files
 * are marked failed, which releases the storage they reserved, and their rows
 * are removed. The caller aborts the returned uploads in R2 so their parts
 * stop taking space. Run opportunistically; concurrent sweeps are harmless.
 */
export async function takeStaleUploads(ctx: ProductCtx, limit = 5): Promise<PendingUpload[]> {
  const db = ctx.db;
  const now = nowIso();
  const res = await db
    .prepare(`SELECT file_id, object_key, r2_upload_id FROM multipart_uploads WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2`)
    .bind(now, limit)
    .all<PendingUpload & { file_id: string }>();
  const stale = res.results ?? [];
  if (!stale.length) return [];
  await db.batch(
    stale.flatMap((u) => [
      db
        .prepare(`UPDATE user_files SET status = 'failed', error = 'The upload expired before it was completed.', updated_at = ?2 WHERE id = ?1 AND status = 'uploading'`)
        .bind(u.file_id, now),
      db.prepare(`DELETE FROM multipart_uploads WHERE file_id = ?1 AND r2_upload_id = ?2`).bind(u.file_id, u.r2_upload_id),
    ]),
  );
  return stale.map((u) => ({ object_key: u.object_key, r2_upload_id: u.r2_upload_id }));
}

export async function getFile(ctx: ProductCtx, uid: string, body: ProductBody) {
  const id = uuid(body.file_id);
  if (!id) throw fail("invalid_file", "Unknown file.");
  const file = await ctx.db.prepare(`SELECT * FROM user_files WHERE id = ?1 AND owner_id = ?2`).bind(id, uid).first<UserFileRow>();
  if (!file) throw fail("not_found", "That file does not exist.", 404);
  return { file };
}

const SAMPLES_INSERT = `INSERT OR IGNORE INTO user_samples
    (id, study_id, project_id, owner_id, sample_id, organism, tissue, tissue_group, disease, disease_group, protocol, assay_family, cell_type, characteristics)
  SELECT json_extract(j.value, '$.id'), ?2, ?3, ?4, json_extract(j.value, '$.sample_id'),
         json_extract(j.value, '$.organism'), json_extract(j.value, '$.tissue'), json_extract(j.value, '$.tissue_group'),
         json_extract(j.value, '$.disease'), json_extract(j.value, '$.disease_group'), json_extract(j.value, '$.protocol'),
         json_extract(j.value, '$.assay_family'), json_extract(j.value, '$.cell_type'), json_extract(j.value, '$.characteristics')
    FROM json_each(?1) AS j`;

const QC_INSERT = `INSERT OR IGNORE INTO user_sample_qc
    (sample_id, project_id, owner_id, n_input_reads, uniquely_mapped_pct, n_cells_called, median_umi, median_genes, mapping_rate,
     median_mito_fraction, fraction_reads_in_cells, reference_build, singlet_version, summary, updated_at)
  SELECT s.id, ?3, ?4, json_extract(j.value, '$.n_input_reads'), json_extract(j.value, '$.uniquely_mapped_pct'),
         json_extract(j.value, '$.n_cells_called'), json_extract(j.value, '$.median_umi'), json_extract(j.value, '$.median_genes'),
         json_extract(j.value, '$.mapping_rate'), json_extract(j.value, '$.median_mito_fraction'),
         json_extract(j.value, '$.fraction_reads_in_cells'), json_extract(j.value, '$.reference_build'),
         json_extract(j.value, '$.singlet_version'), json_extract(j.value, '$.summary'), ?5
    FROM json_each(?1) AS j
    JOIN user_samples AS s ON s.study_id = ?2 AND s.sample_id = json_extract(j.value, '$.sample_id')`;

/**
 * Store the index read out of a .singlet (private-indexer.ts) and mark the
 * file ready. Re-indexing a file replaces its study. Everything is one D1
 * batch (one transaction); samples and QC go in through json_each() so even a
 * 5,000-sample study is a handful of statements.
 */
export async function finishIndex(ctx: ProductCtx, uid: string, body: ProductBody): Promise<{ study: Record<string, unknown> }> {
  const fileId = uuid(body.file_id);
  const bytes = int(body.bytes);
  const rawEtag = body.etag;
  const etagOk = rawEtag === undefined || rawEtag === null || (typeof rawEtag === "string" && rawEtag.length <= 500);
  const etag = typeof rawEtag === "string" ? rawEtag : null;
  const rawStudy = body.study;
  const s = isRecord(rawStudy) ? rawStudy : null;
  const samples = recordArray(body.samples, MAX_INDEX_SAMPLES);
  const qc = recordArray(body.qc, MAX_INDEX_SAMPLES);
  if (!fileId || bytes === null || bytes < 0 || !etagOk || !s || !samples || !qc) throw fail("invalid_index", "The .singlet index was not valid.");
  if (bytes > FILE_BYTES_CAP) throw fail("invalid_index", "The .singlet file is larger than 2 GB.");
  const db = ctx.db;
  const f = await db
    .prepare(
      `SELECT f.*, p.workspace_id AS project_workspace_id
         FROM user_files f JOIN projects p ON p.id = f.project_id
        WHERE f.id = ?1 AND f.owner_id = ?2`,
    )
    .bind(fileId, uid)
    .first<UserFileRow & { project_workspace_id: string | null }>();
  if (!f) throw fail("not_found", "That file does not exist.", 404);

  const studyId = (text(s.study_id, 120) || f.filename.replace(/\.singlet$/i, "") || "private-study").slice(0, 120);
  const clash = await db
    .prepare(`SELECT 1 AS n FROM user_studies WHERE project_id = ?1 AND study_id = ?2 AND file_id <> ?3`)
    .bind(f.project_id, studyId, f.id)
    .first();
  if (clash) throw fail("duplicate_study", `This project already has a study called ${studyId}. Delete that file before adding another copy.`, 409);

  const now = nowIso();
  const manifest = boundedJson(s.manifest ?? {});
  const studyMeta = boundedJson(s.study_meta ?? {});
  const study = {
    id: crypto.randomUUID(),
    project_id: f.project_id,
    file_id: f.id,
    owner_id: uid,
    study_id: studyId,
    title: text(s.title, 1000) || null,
    abstract: sliceOrNull(s.abstract, 100_000),
    organism_primary: text(s.organism_primary, 300) || null,
    organisms: arrayOrEmpty(s.organisms),
    tissue_groups: arrayOrEmpty(s.tissue_groups),
    disease_groups: arrayOrEmpty(s.disease_groups),
    assay_families: arrayOrEmpty(s.assay_families),
    cell_types_raw: arrayOrEmpty(s.cell_types_raw),
    n_samples: samples.length,
    n_cells: floorOrNull(s.n_cells),
    bytes,
    reference_build: text(s.reference_build, 300) || null,
    singlet_version: text(s.singlet_version, 300) || null,
    year: floorOrNull(s.year),
    manifest: parseJson(manifest, {}),
    study_meta: parseJson(studyMeta, {}),
    indexed_at: now,
  };
  const sampleRows = samples
    .map((r) => ({
      id: crypto.randomUUID(),
      sample_id: text(r.sample_id, 160),
      organism: text(r.organism, 300) || null,
      tissue: text(r.tissue, 1000) || null,
      tissue_group: text(r.tissue_group, 300) || null,
      disease: text(r.disease, 1000) || null,
      disease_group: text(r.disease_group, 300) || null,
      protocol: text(r.protocol, 1000) || null,
      assay_family: text(r.assay_family, 300) || null,
      cell_type: text(r.cell_type, 1000) || null,
      characteristics: jsonText(r.characteristics ?? {}, "{}"),
    }))
    .filter((r) => r.sample_id);
  const qcRows = qc
    .map((r) => ({
      sample_id: text(r.sample_id, 160),
      n_input_reads: num(r.n_input_reads),
      uniquely_mapped_pct: num(r.uniquely_mapped_pct),
      n_cells_called: num(r.n_cells_called),
      median_umi: num(r.median_umi),
      median_genes: num(r.median_genes),
      mapping_rate: num(r.mapping_rate),
      median_mito_fraction: num(r.median_mito_fraction),
      fraction_reads_in_cells: num(r.fraction_reads_in_cells),
      reference_build: text(r.reference_build, 300) || null,
      singlet_version: text(r.singlet_version, 300) || null,
      summary: jsonText(r, "{}"),
    }))
    .filter((r) => r.sample_id);

  const statements: D1PreparedStatement[] = [
    ...deleteStudiesStatements(db, `SELECT id FROM user_studies WHERE file_id = ?1`, f.id),
    db
      .prepare(
        `INSERT INTO user_studies (id, project_id, file_id, owner_id, study_id, title, abstract, organism_primary, organisms, tissue_groups,
           disease_groups, assay_families, cell_types_raw, n_samples, n_cells, bytes, reference_build, singlet_version, year, manifest, study_meta, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`,
      )
      .bind(
        study.id,
        study.project_id,
        study.file_id,
        uid,
        study.study_id,
        study.title,
        study.abstract,
        study.organism_primary,
        jsonText(study.organisms, "[]"),
        jsonText(study.tissue_groups, "[]"),
        jsonText(study.disease_groups, "[]"),
        jsonText(study.assay_families, "[]"),
        jsonText(study.cell_types_raw, "[]"),
        study.n_samples,
        study.n_cells,
        study.bytes,
        study.reference_build,
        study.singlet_version,
        study.year,
        manifest,
        studyMeta,
        now,
      ),
  ];
  for (const chunk of jsonChunks(sampleRows)) statements.push(db.prepare(SAMPLES_INSERT).bind(chunk, study.id, f.project_id, uid));
  for (const chunk of jsonChunks(qcRows)) statements.push(db.prepare(QC_INSERT).bind(chunk, study.id, f.project_id, uid, now));
  statements.push(
    db.prepare(`UPDATE user_files SET bytes = ?2, etag = ?3, status = 'ready', error = NULL, updated_at = ?4 WHERE id = ?1`).bind(f.id, bytes, etag, now),
    db.prepare(`DELETE FROM multipart_uploads WHERE file_id = ?1`).bind(f.id),
  );
  if (f.project_workspace_id) {
    statements.push(activityStatement(db, f.project_workspace_id, uid, f.kind === "url" ? "file_registered" : "file_uploaded", f.id, now));
  }
  await db.batch(statements);
  return { study };
}

export async function markFileFailed(ctx: ProductCtx, uid: string, body: ProductBody) {
  const id = uuid(body.file_id);
  if (!id) throw fail("invalid_file", "Unknown file.");
  const db = ctx.db;
  await db.batch([
    db
      .prepare(`UPDATE user_files SET status = 'failed', error = ?3, updated_at = ?4 WHERE id = ?1 AND owner_id = ?2`)
      .bind(id, uid, text(body.error, 1000) || "Could not index this file.", nowIso()),
    db.prepare(`DELETE FROM multipart_uploads WHERE file_id = ?1 AND owner_id = ?2`).bind(id, uid),
  ]);
  return { ok: true };
}

/**
 * Delete one of the caller's files and everything indexed from it. The caller
 * removes `object_key` from R2 and aborts `uploads` (an unfinished multipart
 * upload whose parts would otherwise outlive the file).
 */
export async function deleteFile(
  ctx: ProductCtx,
  uid: string,
  body: ProductBody,
): Promise<{ ok: true; object_key: string | null; uploads: PendingUpload[] }> {
  const id = uuid(body.id);
  if (!id) throw fail("invalid_id", "Unknown item.");
  const db = ctx.db;
  const f = await db
    .prepare(
      `SELECT f.id, f.object_key, m.object_key AS upload_key, m.r2_upload_id
         FROM user_files f LEFT JOIN multipart_uploads m ON m.file_id = f.id
        WHERE f.id = ?1 AND f.owner_id = ?2`,
    )
    .bind(id, uid)
    .first<{ id: string; object_key: string | null; upload_key: string | null; r2_upload_id: string | null }>();
  if (!f) throw fail("not_found", "That file does not exist.", 404);
  await db.batch([
    ...deleteStudiesStatements(db, `SELECT id FROM user_studies WHERE file_id = ?1`, f.id),
    db.prepare(`DELETE FROM multipart_uploads WHERE file_id = ?1`).bind(f.id),
    db.prepare(`DELETE FROM user_files WHERE id = ?1 AND owner_id = ?2`).bind(f.id, uid),
  ]);
  const uploads = f.upload_key && f.r2_upload_id ? [{ object_key: f.upload_key, r2_upload_id: f.r2_upload_id }] : [];
  return { ok: true, object_key: f.object_key, uploads };
}

/**
 * Delete one of the caller's projects with all its files and studies. The
 * caller removes `object_keys` from R2 and aborts `uploads`.
 */
export async function deleteProject(
  ctx: ProductCtx,
  uid: string,
  body: ProductBody,
): Promise<{ ok: true; object_keys: string[]; uploads: PendingUpload[] }> {
  const id = uuid(body.id);
  if (!id) throw fail("invalid_id", "Unknown item.");
  const db = ctx.db;
  const p = await projectAccess(db, id, uid, true);
  if (!p) throw fail("not_found", "That project does not exist.", 404);
  const [files, pending] = await db.batch([
    db.prepare(`SELECT object_key FROM user_files WHERE project_id = ?1`).bind(p.id),
    db.prepare(`SELECT object_key, r2_upload_id FROM multipart_uploads WHERE file_id IN (SELECT id FROM user_files WHERE project_id = ?1)`).bind(p.id),
  ]);
  await db.batch([
    ...deleteStudiesStatements(db, `SELECT id FROM user_studies WHERE project_id = ?1`, p.id),
    db.prepare(`DELETE FROM multipart_uploads WHERE file_id IN (SELECT id FROM user_files WHERE project_id = ?1)`).bind(p.id),
    db.prepare(`DELETE FROM user_files WHERE project_id = ?1`).bind(p.id),
    db.prepare(`DELETE FROM projects WHERE id = ?1 AND owner_id = ?2`).bind(p.id, uid),
  ]);
  return {
    ok: true,
    object_keys: rows<{ object_key: string | null }>(files).map((f) => f.object_key).filter((k): k is string => !!k),
    uploads: rows<PendingUpload>(pending),
  };
}

export async function createWorkspace(ctx: ProductCtx, uid: string, body: ProductBody) {
  const name = requiredName(body.name, 80);
  const rawSlug = body.slug;
  const slug = typeof rawSlug === "string" && SLUG_RE.test(rawSlug) ? rawSlug : null;
  if (name === null || slug === null) throw fail("invalid_workspace", "Use a name and a 3–50 character lowercase slug.");
  const db = ctx.db;
  const ownedSql = `SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?1 AND role = 'owner'`;
  const workspaceLimit = () => fail("workspace_limit", `You can create up to ${WORKSPACE_CAP} workspaces.`, 409, { limit: WORKSPACE_CAP });
  if ((await countOf(db, ownedSql, uid)) >= WORKSPACE_CAP) throw workspaceLimit();
  const id = crypto.randomUUID();
  const now = nowIso();
  // A taken slug or a full quota (re-checked inside the INSERT, so parallel
  // requests cannot all squeeze past it) inserts nothing, and so no owner row;
  // the reads below tell which.
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, owner_id, name, slug, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?5
          WHERE (SELECT COUNT(*) FROM workspace_members WHERE user_id = ?2 AND role = 'owner') < ?6
         ON CONFLICT (slug) DO NOTHING`,
      )
      .bind(id, uid, name, slug, now, WORKSPACE_CAP),
    db
      .prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         SELECT ?1, ?2, 'owner', ?3 WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?1)`,
      )
      .bind(id, uid, now),
  ]);
  const workspace = await db.prepare(`SELECT * FROM workspaces WHERE id = ?1`).bind(id).first<WorkspaceRow>();
  if (!workspace) {
    if ((await countOf(db, ownedSql, uid)) >= WORKSPACE_CAP) throw workspaceLimit();
    throw fail("slug_taken", "That workspace address is already in use.", 409);
  }
  return { workspace };
}

/**
 * A workspace as its members see it. Projects and cohorts are listed when
 * they are shared with the workspace (visibility 'workspace') or belong to
 * the caller; a private project merely filed under the workspace stays
 * private.
 */
export async function getWorkspace(ctx: ProductCtx, uid: string, body: ProductBody) {
  const slug = text(body.slug, 50);
  const db = ctx.db;
  const w = await db.prepare(`SELECT * FROM workspaces WHERE slug = ?1`).bind(slug).first<WorkspaceRow>();
  if (!w) throw fail("not_found", "That workspace does not exist.", 404);
  const membership = await db
    .prepare(`SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2`)
    .bind(w.id, uid)
    .first<{ role: "owner" | "member" }>();
  if (!membership) throw fail("not_found", "That workspace is private.", 404);
  const [members, projects, cohorts, activity] = await db.batch([
    db
      .prepare(
        `SELECT m.user_id, m.role, m.joined_at, u.id AS profile_id, u.display_name, u.email, u.avatar_url
           FROM workspace_members m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ?1 ORDER BY m.joined_at, m.rowid`,
      )
      .bind(w.id),
    db
      .prepare(
        `SELECT id, name, description, visibility, updated_at FROM projects
          WHERE workspace_id = ?1 AND (visibility = 'workspace' OR owner_id = ?2) ORDER BY updated_at DESC, rowid DESC`,
      )
      .bind(w.id, uid),
    db
      .prepare(
        `SELECT id, name, notes, visibility, catalog_version, updated_at FROM cohorts
          WHERE workspace_id = ?1 AND (visibility = 'workspace' OR owner_id = ?2) ORDER BY updated_at DESC, rowid DESC`,
      )
      .bind(w.id, uid),
    // Only events about things this member can read: a private project or
    // cohort filed under the workspace (and its files and comments) stays
    // out of everyone else's feed, as it does from the lists above.
    db
      .prepare(
        `SELECT a.id, a.workspace_id, a.actor_id, a.kind, a.subject_id, a.detail, a.created_at FROM activity_events a
          WHERE a.workspace_id = ?1
            AND (a.kind = 'member_joined'
              OR (a.kind = 'project_created' AND EXISTS (
                    SELECT 1 FROM projects p WHERE p.id = a.subject_id
                       AND (p.owner_id = ?2 OR (p.visibility = 'workspace' AND p.workspace_id = ?1))))
              OR (a.kind IN ('file_uploaded', 'file_registered') AND EXISTS (
                    SELECT 1 FROM user_files f JOIN projects p ON p.id = f.project_id WHERE f.id = a.subject_id
                       AND (p.owner_id = ?2 OR (p.visibility = 'workspace' AND p.workspace_id = ?1))))
              OR (a.kind = 'cohort_saved' AND EXISTS (
                    SELECT 1 FROM cohorts c WHERE c.id = a.subject_id
                       AND (c.owner_id = ?2 OR (c.visibility = 'workspace' AND c.workspace_id = ?1))))
              OR (a.kind = 'comment_added' AND EXISTS (
                    SELECT 1 FROM cohort_comments k JOIN cohorts c ON c.id = k.cohort_id WHERE k.id = a.subject_id
                       AND (c.owner_id = ?2 OR (c.visibility = 'workspace' AND c.workspace_id = ?1)))))
          ORDER BY a.created_at DESC, a.id DESC LIMIT 30`,
      )
      .bind(w.id, uid),
  ]);
  type MemberRow = {
    user_id: string;
    role: string;
    joined_at: string;
    profile_id: string | null;
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
  return {
    workspace: w,
    role: membership.role,
    members: rows<MemberRow>(members).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      profile: m.profile_id ? { id: m.profile_id, display_name: m.display_name, email: m.email, avatar_url: m.avatar_url } : null,
    })),
    projects: rows(projects),
    cohorts: rows(cohorts),
    activity: rows<Record<string, unknown>>(activity).map((a) => ({ ...a, detail: parseJson(a.detail, {}) })),
    limits: { members: MEMBER_CAP },
  };
}

export async function inviteWorkspace(ctx: ProductCtx, uid: string, body: ProductBody) {
  const workspaceId = uuid(body.workspace_id);
  const rawEmail = body.email;
  const email =
    rawEmail === undefined ? null : typeof rawEmail === "string" && rawEmail.length <= 320 && EMAIL_RE.test(rawEmail) ? rawEmail.toLowerCase() : false;
  if (!workspaceId || email === false) throw fail("invalid_invite", "Enter a valid email address or create a link invite.");
  const db = ctx.db;
  const w = await db.prepare(`SELECT id FROM workspaces WHERE id = ?1 AND owner_id = ?2`).bind(workspaceId, uid).first();
  if (!w) throw fail("forbidden", "Only the workspace owner can invite members.", 403);
  if ((await countOf(db, `SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?1`, workspaceId)) >= MEMBER_CAP) {
    throw fail("member_limit", `A workspace can have up to ${MEMBER_CAP} members.`, 409, { limit: MEMBER_CAP });
  }
  const token = newToken("swi");
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = nowIso(now + 7 * 86_400_000);
  await db
    .prepare(`INSERT INTO workspace_invites (id, workspace_id, created_by, email, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, workspaceId, uid, email, await sha256Hex(token), expiresAt, nowIso(now))
    .run();
  return { invite: { id, expires_at: expiresAt }, token, url: `${ctx.origin}/join/${token}` };
}

export async function acceptInvite(ctx: ProductCtx, uid: string, body: ProductBody) {
  const token = text(body.token, 200);
  const db = ctx.db;
  const now = nowIso();
  const inv = token
    ? await db
        .prepare(`SELECT id, workspace_id, email FROM workspace_invites WHERE token_hash = ?1 AND accepted_at IS NULL AND expires_at > ?2`)
        .bind(await sha256Hex(token), now)
        .first<InviteRow>()
    : null;
  if (!inv) throw fail("invalid_invite", "This invite is invalid, expired or already used.", 410);
  const me = await db.prepare(`SELECT email FROM users WHERE id = ?1`).bind(uid).first<{ email: string | null }>();
  // An account without an email (see oauth.ts findOrCreateUser) cannot take an invite addressed to one.
  if (inv.email && (!me?.email || inv.email.toLowerCase() !== me.email.toLowerCase())) {
    throw fail("wrong_account", `This invite was sent to ${inv.email}. Sign in with that email address.`, 403);
  }
  const memberLimit = () => fail("member_limit", `This workspace already has ${MEMBER_CAP} members.`, 409);
  const already = await isMember(db, inv.workspace_id, uid);
  if (!already && (await countOf(db, `SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?1`, inv.workspace_id)) >= MEMBER_CAP) {
    throw memberLimit();
  }
  // One transaction: the invite is claimed first (single use, and only while
  // the workspace has room or the caller is already in it); the membership
  // and the activity event land only if this request made that claim.
  // DO NOTHING on an existing membership: an owner opening their own link keeps the owner role.
  const claimedByMe = `EXISTS (SELECT 1 FROM workspace_invites WHERE id = ?4 AND accepted_by = ?2 AND accepted_at = ?3)`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE workspace_invites SET accepted_at = ?2, accepted_by = ?3
          WHERE id = ?1 AND accepted_at IS NULL AND expires_at > ?2
            AND (EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ?4 AND user_id = ?3)
                 OR (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?4) < ?5)`,
      )
      .bind(inv.id, now, uid, inv.workspace_id, MEMBER_CAP),
    db
      .prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         SELECT ?1, ?2, 'member', ?3 WHERE ${claimedByMe}
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      )
      .bind(inv.workspace_id, uid, now, inv.id),
  ];
  if (!already) {
    statements.push(
      db
        .prepare(
          `INSERT INTO activity_events (workspace_id, actor_id, kind, subject_id, created_at)
           SELECT ?1, ?2, 'member_joined', NULL, ?3 WHERE ${claimedByMe}`,
        )
        .bind(inv.workspace_id, uid, now, inv.id),
    );
  }
  const [claim] = await db.batch(statements);
  if (!(Number(claim?.meta.changes) || 0) && !(await isMember(db, inv.workspace_id, uid))) {
    // Someone else used the invite first, or the workspace filled up meanwhile.
    const open = await db.prepare(`SELECT 1 AS n FROM workspace_invites WHERE id = ?1 AND accepted_at IS NULL`).bind(inv.id).first();
    if (open) throw memberLimit();
    throw fail("invalid_invite", "This invite is invalid, expired or already used.", 410);
  }
  const w = await db.prepare(`SELECT slug FROM workspaces WHERE id = ?1`).bind(inv.workspace_id).first<{ slug: string }>();
  return { ok: true, slug: w?.slug ?? null };
}

const cohortLimit = () =>
  fail("cohort_limit", `You can save up to ${COHORT_CAP} cohorts. Delete one before saving another.`, 409, { limit: COHORT_CAP });

const COHORT_ITEMS_INSERT = `INSERT INTO cohort_items (id, cohort_id, public_gse_id, private_study_id, position, created_at)
  SELECT json_extract(j.value, '$.id'), ?2, json_extract(j.value, '$.g'), json_extract(j.value, '$.p'), json_extract(j.value, '$.n'), ?3
    FROM json_each(?1) AS j
   WHERE EXISTS (SELECT 1 FROM cohorts WHERE id = ?2)`;

export async function saveCohort(ctx: ProductCtx, uid: string, body: ProductBody) {
  const name = requiredName(body.name, 120);
  const notes = optionalText(body.notes, 20000);
  const query = optionalText(body.query, 500);
  const rawFilters = body.filters;
  const filters = rawFilters === undefined ? {} : isRecord(rawFilters) ? rawFilters : null;
  const vis = visibility(body.visibility);
  const workspaceId = optionalUuid(body.workspace_id);
  const gseIds = stringList(body.public_gse_ids, 2000, (v) => GSE_ID_RE.test(v));
  const privateIds = stringList(body.private_study_ids, 2000, (v) => UUID_RE.test(v));
  if (
    name === null ||
    notes === null ||
    query === null ||
    filters === null ||
    vis === null ||
    workspaceId === false ||
    gseIds === null ||
    privateIds === null ||
    gseIds.length + privateIds.length === 0
  ) {
    throw fail("invalid_cohort", "Name the cohort and include at least one study (up to 2,000).");
  }
  const db = ctx.db;
  if (workspaceId && !(await isMember(db, workspaceId, uid))) throw fail("workspace_access", "You are not a member of that workspace.", 403);
  if ((await countOf(db, `SELECT COUNT(*) AS n FROM cohorts WHERE owner_id = ?1`, uid)) >= COHORT_CAP) throw cohortLimit();
  const gse = [...new Set(gseIds)];
  const priv = [...new Set(privateIds.map((v) => v.toLowerCase()))];
  if (priv.length) {
    const readable = await countOf(
      db,
      `SELECT COUNT(*) AS n FROM user_studies s JOIN projects p ON p.id = s.project_id
        WHERE s.id IN (SELECT value FROM json_each(?1))
          AND (p.owner_id = ?2 OR (p.visibility = 'workspace' AND p.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?2)))`,
      JSON.stringify(priv),
      uid,
    );
    if (readable !== priv.length) throw fail("invalid_cohort", "One or more private studies are not available to your account.");
  }
  const shareToken = vis === "link" ? newToken("sco") : null;
  const shareHash = shareToken ? await sha256Hex(shareToken) : null;
  const id = crypto.randomUUID();
  const now = nowIso();
  const items = [
    ...gse.map((g, i) => ({ id: crypto.randomUUID(), g, p: null, n: i })),
    ...priv.map((p, i) => ({ id: crypto.randomUUID(), g: null, p, n: gse.length + i })),
  ];
  // The cap is re-checked inside the INSERT; items and activity only land if the cohort did.
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO cohorts (id, owner_id, workspace_id, name, notes, query, filters, catalog_version, visibility, share_token_hash, share_token_prefix, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
          WHERE (SELECT COUNT(*) FROM cohorts WHERE owner_id = ?2) < ?13`,
      )
      .bind(
        id,
        uid,
        workspaceId,
        name,
        notes,
        query,
        jsonText(filters, "{}"),
        CATALOG_VERSION,
        vis,
        shareHash,
        shareToken ? shareToken.slice(0, 12) : null,
        now,
        COHORT_CAP,
      ),
  ];
  for (const chunk of jsonChunks(items)) statements.push(db.prepare(COHORT_ITEMS_INSERT).bind(chunk, id, now));
  if (workspaceId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO activity_events (workspace_id, actor_id, kind, subject_id, created_at)
           SELECT ?1, ?2, 'cohort_saved', ?3, ?4 WHERE EXISTS (SELECT 1 FROM cohorts WHERE id = ?3)`,
        )
        .bind(workspaceId, uid, id, now),
    );
  }
  await db.batch(statements);
  const c = await db.prepare(`SELECT * FROM cohorts WHERE id = ?1`).bind(id).first<CohortRow>();
  if (!c) throw cohortLimit();
  return { cohort: publicCohort(c), share_token: shareToken, url: `${ctx.origin}/c/${c.id}${shareToken ? `?token=${shareToken}` : ""}` };
}

export async function commentCohort(ctx: ProductCtx, uid: string, body: ProductBody) {
  const cohortId = uuid(body.cohort_id);
  const message = requiredName(body.body, 4000);
  if (!cohortId || message === null) throw fail("invalid_comment", "Comments must be 1–4,000 characters.");
  const db = ctx.db;
  const c = await cohortAccess(db, cohortId, uid);
  if (!c || !c.workspace_id) throw fail("forbidden", "Comments are available to workspace cohorts.", 403);
  const now = nowIso();
  const comment = { id: crypto.randomUUID(), cohort_id: c.id, author_id: uid, body: message, created_at: now, updated_at: now };
  await db.batch([
    db
      .prepare(`INSERT INTO cohort_comments (id, cohort_id, author_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
      .bind(comment.id, c.id, uid, message, now),
    activityStatement(db, c.workspace_id, uid, "comment_added", comment.id, now),
  ]);
  return { comment };
}

export async function setWeeklySummary(ctx: ProductCtx, uid: string, body: ProductBody) {
  const enabled = body.enabled === true;
  await ctx.db
    .prepare(
      `INSERT INTO account_preferences (user_id, weekly_summary, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET weekly_summary = excluded.weekly_summary, updated_at = excluded.updated_at`,
    )
    .bind(uid, enabled ? 1 : 0, nowIso())
    .run();
  return { weekly_summary: enabled };
}

/** Append one usage event for the caller (MCP tool calls, API calls, private downloads). */
export async function logUsage(ctx: ProductCtx, uid: string, body: ProductBody) {
  const tool = boundedString(body.tool, 1, 80);
  const rawKind = body.kind;
  const kind = typeof rawKind === "string" && (USAGE_KINDS as readonly string[]).includes(rawKind) ? rawKind : null;
  const calls = body.calls === undefined ? 1 : int(body.calls);
  const bytes = body.bytes === undefined ? 0 : int(body.bytes);
  const ms = body.ms === undefined ? 0 : int(body.ms);
  const rawPrefix = body.key_prefix;
  const prefixOk = rawPrefix === undefined || rawPrefix === null || (typeof rawPrefix === "string" && rawPrefix.length <= 40);
  if (tool === null || kind === null || calls === null || calls <= 0 || calls > 1000 || bytes === null || bytes < 0 || ms === null || ms < 0 || !prefixOk) {
    throw fail("invalid_usage", "Usage event is invalid.");
  }
  const now = nowIso();
  await ctx.db
    .prepare(`INSERT INTO usage_events (user_id, key_prefix, tool, kind, calls, bytes, ms, day, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(uid, typeof rawPrefix === "string" ? rawPrefix : null, tool, kind, calls, bytes, ms, now.slice(0, 10), now)
    .run();
  return { ok: true };
}

// ── Dispatch for POST /api/product ──────────────────────────────────────────

type UserAction = (ctx: ProductCtx, uid: string, body: ProductBody) => Promise<unknown>;

/**
 * Actions any signed-in caller may run over HTTP. delete_file / delete_project
 * are routed by functions/api/product.ts itself (they must also remove R2
 * objects); the upload/index steps are in-process only (see the header).
 */
const USER_ACTIONS = new Map<string, UserAction>([
  ["dashboard", (ctx, uid) => dashboard(ctx, uid)],
  ["create_project", createProject],
  ["list_private_studies", listPrivateStudies],
  ["get_project", getProject],
  ["get_private_study", getPrivateStudy],
  ["get_file", getFile],
  ["create_workspace", createWorkspace],
  ["get_workspace", getWorkspace],
  ["invite_workspace", inviteWorkspace],
  ["accept_invite", acceptInvite],
  ["save_cohort", saveCohort],
  ["comment_cohort", commentCohort],
  ["set_weekly_summary", setWeeklySummary],
  ["log_usage", logUsage],
]);

export function isProductAction(action: string): boolean {
  return action === "get_cohort" || USER_ACTIONS.has(action);
}

/**
 * Run one action for a resolved caller (`uid` null = anonymous). Only
 * get_cohort works anonymously (it then needs the cohort's share token).
 */
export async function runProductAction(ctx: ProductCtx, uid: string | null, action: string, body: ProductBody): Promise<unknown> {
  if (action === "get_cohort") return getCohort(ctx, uid, body);
  const run = USER_ACTIONS.get(action);
  if (!run) throw fail("unknown_action", `Unknown action '${action.slice(0, 80)}'.`);
  if (uid === null) throw fail("sign_in_required", SIGN_IN_MESSAGE, 401);
  return run(ctx, uid, body);
}
