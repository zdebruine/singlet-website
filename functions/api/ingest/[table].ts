/**
 * POST /api/ingest/:table — authenticated bulk upsert into catalog maintenance
 * tables, so the HPC packing job can write manifests / GEO metadata into D1
 * without the Cloudflare dashboard.
 *
 * Auth: header `X-Ingest-Token`. Only the SHA-256 hex digest of the token is
 * ever known to this repo — the plaintext token is NEVER stored here. Setting
 * `INGEST_TOKEN_SHA256` as a Cloudflare Pages environment variable overrides
 * the baked-in digest below and therefore rotates the token.
 *
 * Cache note: functions/_shared/cache.ts is TTL-only (Cache API + meta_cache),
 * with no per-key invalidation, so an ingested change becomes visible to
 * /api/gse/:id after its 300 s TTL expires. If per-key purge is added later,
 * bust `/api/gse/<id>` for every id in the batch here.
 */

const DEFAULT_TOKEN_SHA256 = "b37e6cb5277791ff7d0de2550f0944ea39e580ec4f94e9f4c3b8dcd842a8aaab";

const MAX_ROWS = 2000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_STRING_BYTES = 64 * 1024;
const BATCH_SIZE = 100;

const GSE_RE = /^GSE\d+$/;

const ALLOWED_ORIGIN_RE = /^https:\/\/(singlet\.bio|[a-z0-9-]+\.singlet-4gc\.pages\.dev)$/i;

interface Env {
  DB: D1Database;
  INGEST_TOKEN_SHA256?: string;
}

type ColKind = "text" | "int";

interface TableSpec {
  columns: Record<string, ColKind>;
  /** Columns that are set to the current timestamp on every write. */
  stamp: string;
}

const TABLES: Record<string, TableSpec> = {
  bundle_manifest: {
    columns: {
      gse_id: "text",
      bytes: "int",
      n_files: "int",
      n_gsms_in_bundle: "int",
      manifest_n_gsms: "int",
      gsm_ids: "text",
      manifest_created_at: "text",
      reference_build: "text",
      singlet_version: "text",
    },
    stamp: "audited_at",
  },
  geo_enrich: {
    columns: {
      gse_id: "text",
      pdat: "text",
      pubmed_ids: "text",
      n_samples_geo: "int",
      gdstype: "text",
    },
    stamp: "fetched_at",
  },
};

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGIN_RE.test(origin) ? origin : "https://singlet.bio";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: cors(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  const started = Date.now();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = request.headers.get("X-Ingest-Token") ?? "";
  if (!token) return json({ error: "Missing X-Ingest-Token" }, 401, origin);
  const expected = (env.INGEST_TOKEN_SHA256 || DEFAULT_TOKEN_SHA256).trim().toLowerCase();
  if (!timingSafeEqual(await sha256Hex(token), expected)) {
    return json({ error: "Invalid ingest token" }, 401, origin);
  }

  // ── Table allow-list ──────────────────────────────────────────────────────
  const table = String(params.table ?? "");
  const spec = TABLES[table];
  if (!spec) {
    return json({ error: `Unknown table '${table}'. Allowed: ${Object.keys(TABLES).join(", ")}` }, 400, origin);
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Body exceeds 4 MB" }, 413, origin);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Body must be JSON" }, 400, origin);
  }
  const rows = (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return json({ error: "Body must be { rows: [...] }" }, 400, origin);
  if (rows.length === 0) return json({ error: "rows is empty" }, 400, origin);
  if (rows.length > MAX_ROWS) return json({ error: `Too many rows (max ${MAX_ROWS})` }, 400, origin);

  // ── Validate ──────────────────────────────────────────────────────────────
  const clean: Record<string, string | number | null>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return json({ error: `Row ${i} is not an object` }, 400, origin);
    }
    const rec = row as Record<string, unknown>;
    const out: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(rec)) {
      const kind = spec.columns[key];
      if (!kind) return json({ error: `Row ${i}: unknown key '${key}' for table '${table}'` }, 400, origin);
      if (value === null || value === undefined) {
        out[key] = null;
        continue;
      }
      if (kind === "int") {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          return json({ error: `Row ${i}: '${key}' must be an integer` }, 400, origin);
        }
        out[key] = value;
      } else {
        const s = typeof value === "string" ? value : Array.isArray(value) ? JSON.stringify(value) : null;
        if (s === null) return json({ error: `Row ${i}: '${key}' must be a string` }, 400, origin);
        if (s.length > MAX_STRING_BYTES) return json({ error: `Row ${i}: '${key}' exceeds 64 KB` }, 400, origin);
        out[key] = s;
      }
    }
    const gseId = out.gse_id;
    if (typeof gseId !== "string" || !GSE_RE.test(gseId)) {
      return json({ error: `Row ${i}: gse_id must match /^GSE\\d+$/` }, 400, origin);
    }
    clean.push(out);
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  const stamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const row of clean) {
    const cols = Object.keys(row);
    const allCols = [...cols, spec.stamp];
    const placeholders = allCols.map(() => "?").join(", ");
    const updates = [...cols.filter((c) => c !== "gse_id"), spec.stamp].map((c) => `${c} = excluded.${c}`).join(", ");
    const sql =
      `INSERT INTO ${table} (${allCols.join(", ")}) VALUES (${placeholders}) ` +
      `ON CONFLICT(gse_id) DO UPDATE SET ${updates}`;
    statements.push(env.DB.prepare(sql).bind(...cols.map((c) => row[c]), stamp));
  }

  let written = 0;
  try {
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      await env.DB.batch(chunk);
      written += chunk.length;
    }

    // ── Derived catalog columns for the ids in this batch ───────────────────
    const ids = clean.map((r) => String(r.gse_id));
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const inList = chunk.map(() => "?").join(", ");
      if (table === "bundle_manifest") {
        await env.DB.prepare(
          `UPDATE gse SET r2_bundle_n_gsms = (SELECT n_gsms_in_bundle FROM bundle_manifest b WHERE b.gse_id = gse.id)
           WHERE id IN (${inList})`
        )
          .bind(...chunk)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE gse SET
             submitted_date = COALESCE(submitted_date, (SELECT pdat FROM geo_enrich g WHERE g.gse_id = gse.id)),
             pubmed_ids = (SELECT CASE WHEN g.pubmed_ids IS NULL OR g.pubmed_ids = '' THEN NULL
                                       ELSE '["' || replace(g.pubmed_ids, ';', '","') || '"]' END
                           FROM geo_enrich g WHERE g.gse_id = gse.id)
           WHERE id IN (${inList})`
        )
          .bind(...chunk)
          .run();
        await env.DB.prepare(
          `UPDATE gse_meta SET year = CAST(substr((SELECT submitted_date FROM gse WHERE gse.id = gse_meta.gse_id), 1, 4) AS INTEGER)
           WHERE gse_id IN (${inList}) AND year IS NULL`
        )
          .bind(...chunk)
          .run();
      }
    }
  } catch (e) {
    return json({ error: String(e), table, received: rows.length, written }, 500, origin);
  }

  return json({ ok: true, table, received: rows.length, written, ms: Date.now() - started }, 200, origin);
};
