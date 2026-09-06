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
 * GET /api/ingest/index-next?n=25 — UNAUTHENTICATED backfill crank. It only
 * reads public `.singlet` files and fills the cache tables `bundle_index` and
 * `sample_qc`, so no token is needed, but it is hard rate-limited with a single
 * D1 row (`meta_cache` key `index-next:lock`): one run in flight at a time and
 * at least one second between runs globally — otherwise 429. Each call picks
 * the next `n` studies from `bundle_manifest` that have no `bundle_index` row
 * or no `sample_qc` rows and returns
 * `{ indexed: [...], failed: [{gse_id, error}], remaining }`. Loop until
 * `remaining` is 0.
 *
 * Cache note: functions/_shared/cache.ts is TTL-only (Cache API + meta_cache),
 * with no per-key invalidation, so an ingested change becomes visible to
 * /api/gse/:id after its 300 s TTL expires. If per-key purge is added later,
 * bust `/api/gse/<id>` for every id in the batch here.
 */


import { getBundleIndex, ensureSampleQcTable } from "../../_shared/bundle-reader";
import { readSampleSummaries, upsertSampleQcStatement } from "../../_shared/bundle-core";

const DEFAULT_TOKEN_SHA256 = "b37e6cb5277791ff7d0de2550f0944ea39e580ec4f94e9f4c3b8dcd842a8aaab";

const MAX_ROWS = 2000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_STRING_BYTES = 64 * 1024;
const BATCH_SIZE = 100;

const GSE_RE = /^GSE\d+$/;
const GSM_RE = /^GSM\d+$/;

/** Studies indexed per POST /api/ingest/index-bundle call. */
const MAX_INDEX_PER_CALL = 25;

const ALLOWED_ORIGIN_RE = /^https:\/\/(singlet\.bio|[a-z0-9-]+\.singlet-4gc\.pages\.dev)$/i;

interface Env {
  DB: D1Database;
  INGEST_TOKEN_SHA256?: string;
}

type ColKind = "text" | "int" | "real";

interface TableSpec {
  columns: Record<string, ColKind>;
  /** Columns that are set to the current timestamp on every write. */
  stamp: string;
  /** Primary key column (also the ON CONFLICT target). */
  pk?: string;
  /** Created on demand — the table is not part of the original catalog schema. */
  ensure?: (db: D1Database) => Promise<void>;
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
  sample_qc: {
    pk: "gsm_id",
    columns: {
      gsm_id: "text",
      gse_id: "text",
      protocol: "text",
      reference_build: "text",
      n_input_reads: "int",
      uniquely_mapped_pct: "real",
      n_cells_called: "int",
      median_umi: "real",
      median_genes: "real",
      mapping_rate: "real",
      exonic_fraction: "real",
      intronic_fraction: "real",
      sequencing_saturation: "real",
      median_mito_fraction: "real",
      fraction_reads_in_cells: "real",
      total_genes_detected: "int",
      singlet_version: "text",
    },
    stamp: "updated_at",
    ensure: ensureSampleQcTable,
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

  // ── POST /api/ingest/index-bundle?gse=GSE…&gse=… ─────────────────────────
  // Reads each study's .singlet central directory and its per-sample
  // summary.json files, and persists both (bundle_index + sample_qc). Tolerant:
  // a study that cannot be read is reported, never fatal.
  if (String(params.table ?? "") === "index-bundle") {
    const url = new URL(request.url);
    const wanted = [...new Set(url.searchParams.getAll("gse").flatMap((v) => v.split(",")))]
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
    if (!wanted.length) return json({ error: "At least one ?gse=GSE… is required" }, 400, origin);
    if (wanted.length > MAX_INDEX_PER_CALL) {
      return json({ error: `Too many studies (max ${MAX_INDEX_PER_CALL} per call)` }, 400, origin);
    }
    await ensureSampleQcTable(env.DB).catch(() => undefined);
    const results: Record<string, unknown>[] = [];
    for (const gse of wanted) {
      if (!GSE_RE.test(gse)) {
        results.push({ gse_id: gse, ok: false, error: "not a GSE accession" });
        continue;
      }
      try {
        const index = await getBundleIndex(env.DB, gse, { refresh: true });
        const samples = await readSampleSummaries(gse, index);
        const st = nowIso();
        const statements = samples.map((s) => upsertSampleQcStatement(env.DB, s as unknown as Record<string, unknown>, st));
        for (let i = 0; i < statements.length; i += BATCH_SIZE) await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
        results.push({ gse_id: gse, ok: true, bytes: index.bytes, entries: index.entries.length, samples_qc: samples.length });
      } catch (e) {
        results.push({ gse_id: gse, ok: false, error: String(e) });
      }
    }
    return json(
      {
        ok: true,
        table: "index-bundle",
        received: wanted.length,
        written: results.filter((r) => r.ok).length,
        ms: Date.now() - started,
        results,
      },
      200,
      origin
    );
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
      if (kind === "int" || kind === "real") {
        if (typeof value !== "number" || !Number.isFinite(value) || (kind === "int" && !Number.isInteger(value))) {
          return json({ error: `Row ${i}: '${key}' must be ${kind === "int" ? "an integer" : "a number"}` }, 400, origin);
        }
        out[key] = value;
      } else {
        const s = typeof value === "string" ? value : Array.isArray(value) ? JSON.stringify(value) : null;
        if (s === null) return json({ error: `Row ${i}: '${key}' must be a string` }, 400, origin);
        if (s.length > MAX_STRING_BYTES) return json({ error: `Row ${i}: '${key}' exceeds 64 KB` }, 400, origin);
        out[key] = s;
      }
    }
    if (spec.pk === "gsm_id") {
      const gsmId = out.gsm_id;
      if (typeof gsmId !== "string" || !GSM_RE.test(gsmId)) {
        return json({ error: `Row ${i}: gsm_id must match /^GSM\\d+$/` }, 400, origin);
      }
      if (out.gse_id != null && (typeof out.gse_id !== "string" || !GSE_RE.test(out.gse_id))) {
        return json({ error: `Row ${i}: gse_id must match /^GSE\\d+$/` }, 400, origin);
      }
    } else {
      const gseId = out.gse_id;
      if (typeof gseId !== "string" || !GSE_RE.test(gseId)) {
        return json({ error: `Row ${i}: gse_id must match /^GSE\\d+$/` }, 400, origin);
      }
    }
    clean.push(out);
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  const stamp = nowIso();
  const pk = spec.pk ?? "gse_id";
  if (spec.ensure) await spec.ensure(env.DB).catch(() => undefined);
  const statements: D1PreparedStatement[] = [];
  for (const row of clean) {
    const cols = Object.keys(row);
    const allCols = [...cols, spec.stamp];
    const placeholders = allCols.map(() => "?").join(", ");
    const updates = [...cols.filter((c) => c !== pk), spec.stamp].map((c) => `${c} = excluded.${c}`).join(", ");
    const sql =
      `INSERT INTO ${table} (${allCols.join(", ")}) VALUES (${placeholders}) ` +
      `ON CONFLICT(${pk}) DO UPDATE SET ${updates}`;
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
    const ids = table === "sample_qc" ? [] : clean.map((r) => String(r.gse_id));
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
