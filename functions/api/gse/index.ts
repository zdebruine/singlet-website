/**
 * GET /api/gse
 * Flat listing of series straight off the `gse` table.
 *
 * Supported: q (FTS), organism, has_bundle, has_pubmed, min_cells, max_cells,
 *            min_samples, min_done, page, page_size, sort, asc
 *
 * Anything this endpoint cannot honour is rejected with 400 rather than
 * silently ignored. Sample-derived facets (tissue_group, disease_group,
 * assay_family, protocol, reference_build, year, cell_type, …) require the
 * `gse_meta` join and live on /api/search.
 */
import { corsOk, corsErr, handleOptions, intParam, clampPageSize } from "../../_shared/cors";
import { safeList } from "../../_shared/json";

interface Env {
  DB: D1Database;
}

const ALLOWED_SORT_COLS = new Set([
  "id", "title", "organism", "n_gsm_total", "n_gsm_done",
  "n_cells", "submitted_date", "last_updated"
]);

/** Every query param this endpoint understands. */
const KNOWN_PARAMS = new Set([
  "q", "organism", "has_bundle", "has_pubmed",
  "min_cells", "max_cells", "min_samples", "min_done",
  "page", "page_size", "sort", "asc",
]);

/** Params that are valid on /api/search but cannot be answered here. */
const SEARCH_ONLY_PARAMS = new Set([
  "tissue_group", "disease_group", "assay_family", "cell_type", "protocol",
  "reference_build", "year", "year_min", "year_max", "min_file_samples",
  "min_file_cells", "max_file_bytes", "has_conditions", "level", "limit", "format",
]);

/** Parse a tri-state boolean param. Returns undefined for absent, null for invalid. */
function boolParam(url: URL, key: string): boolean | null | undefined {
  const raw = url.searchParams.get(key);
  if (raw == null) return undefined;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes"].includes(v)) return true;
  if (["0", "false", "no"].includes(v)) return false;
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const url = new URL(request.url);

    // ── Validate params up front; never silently drop a filter ──────────────
    const unknown: string[] = [];
    const searchOnly: string[] = [];
    for (const key of new Set(url.searchParams.keys())) {
      if (KNOWN_PARAMS.has(key)) continue;
      (SEARCH_ONLY_PARAMS.has(key) ? searchOnly : unknown).push(key);
    }
    if (searchOnly.length) {
      return corsErr(
        `/api/gse cannot filter on: ${searchOnly.sort().join(", ")}. ` +
          `These are sample-derived facets — use /api/search instead.`,
        400
      );
    }
    if (unknown.length) {
      return corsErr(
        `Unknown query parameter(s): ${unknown.sort().join(", ")}. ` +
          `Supported: ${[...KNOWN_PARAMS].sort().join(", ")}.`,
        400
      );
    }

    const q = url.searchParams.get("q")?.trim() ?? "";
    const organism = url.searchParams.get("organism") ?? "";
    const minCells = url.searchParams.get("min_cells") ? parseInt(url.searchParams.get("min_cells")!, 10) : null;
    const maxCells = url.searchParams.get("max_cells") ? parseInt(url.searchParams.get("max_cells")!, 10) : null;
    const minSamples = url.searchParams.get("min_samples") ? parseInt(url.searchParams.get("min_samples")!, 10) : null;
    const minDone = url.searchParams.get("min_done") ? parseInt(url.searchParams.get("min_done")!, 10) : null;
    const page = Math.max(0, intParam(url, "page", 0));
    const pageSize = clampPageSize(intParam(url, "page_size", 25));

    const hasBundle = boolParam(url, "has_bundle");
    if (hasBundle === null) return corsErr(`Invalid has_bundle: expected true or false.`, 400);
    const hasPubmed = boolParam(url, "has_pubmed");
    if (hasPubmed === null) return corsErr(`Invalid has_pubmed: expected true or false.`, 400);

    const sortRaw = url.searchParams.get("sort");
    if (sortRaw && !ALLOWED_SORT_COLS.has(sortRaw)) {
      return corsErr(
        `Invalid sort column "${sortRaw}". Allowed: ${[...ALLOWED_SORT_COLS].sort().join(", ")}.`,
        400
      );
    }
    const sort = sortRaw ?? null;
    const asc = url.searchParams.get("asc") === "1";

    const dir = asc ? "ASC" : "DESC";
    const offset = page * pageSize;

    // Default ordering: series with completed samples and real data first.
    const orderBy = sort
      ? `${sort} ${dir} NULLS LAST`
      : `(n_gsm_done > 0) DESC, n_cells DESC`;

    // Build WHERE clauses
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q) {
      // Use FTS if available, otherwise LIKE
      conditions.push("id IN (SELECT id FROM fts_gse WHERE fts_gse MATCH ?)");
      params.push(q + "*");
    }
    if (organism) {
      conditions.push("organism = ?");
      params.push(organism);
    }
    if (minCells != null && !isNaN(minCells)) {
      conditions.push("n_cells >= ?");
      params.push(minCells);
    }
    if (maxCells != null && !isNaN(maxCells)) {
      conditions.push("n_cells <= ?");
      params.push(maxCells);
    }
    if (minSamples != null && !isNaN(minSamples)) {
      conditions.push("n_gsm_total >= ?");
      params.push(minSamples);
    }
    if (minDone != null && !isNaN(minDone)) {
      conditions.push("n_gsm_done >= ?");
      params.push(minDone);
    }
    if (hasBundle !== undefined) {
      conditions.push(
        hasBundle
          ? "(r2_bundle_key IS NOT NULL AND r2_bundle_key != '')"
          : "(r2_bundle_key IS NULL OR r2_bundle_key = '')"
      );
    }
    if (hasPubmed !== undefined) {
      conditions.push(
        hasPubmed
          ? "(pubmed_ids IS NOT NULL AND pubmed_ids NOT IN ('', '[]'))"
          : "(pubmed_ids IS NULL OR pubmed_ids IN ('', '[]'))"
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM gse ${where}`
    ).bind(...params).first<{ n: number }>();
    const total = countRow?.n ?? 0;

    // Data
    const rows = await env.DB.prepare(
      `SELECT id, title, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells,
              pubmed_ids, r2_bundle_key, r2_bundle_bytes, submitted_date, last_updated
       FROM gse ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, offset).all<Record<string, unknown>>();

    const data = rows.results.map(r => ({
      ...r,
      pubmed_ids: safeList(r.pubmed_ids),
    }));

    return corsOk({ total, page, page_size: pageSize, data });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();

    // Count
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM gse ${where}`
    ).bind(...params).first<{ n: number }>();
    const total = countRow?.n ?? 0;

    // Data
    const rows = await env.DB.prepare(
      `SELECT id, title, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells,
              pubmed_ids, r2_bundle_key, r2_bundle_bytes, submitted_date, last_updated
       FROM gse ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, offset).all<Record<string, unknown>>();

    const data = rows.results.map(r => ({
      ...r,
      pubmed_ids: safeList(r.pubmed_ids),
    }));

    return corsOk({ total, page, page_size: pageSize, data });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
