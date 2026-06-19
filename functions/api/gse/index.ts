/**
 * GET /api/gse
 * List series with filters: organism, q (FTS), min_cells, max_cells
 * Pagination: page (0-based), page_size (default 25, max 500)
 * Sorting: sort (column name), asc (1 = ascending, default desc)
 */
import { corsOk, corsErr, handleOptions, intParam, clampPageSize } from "../../_shared/cors";

interface Env {
  DB: D1Database;
}

const ALLOWED_SORT_COLS = new Set([
  "id", "title", "organism", "n_gsm_total", "n_gsm_done",
  "n_cells", "submitted_date", "last_updated"
]);

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const organism = url.searchParams.get("organism") ?? "";
    const minCells = url.searchParams.get("min_cells") ? parseInt(url.searchParams.get("min_cells")!, 10) : null;
    const maxCells = url.searchParams.get("max_cells") ? parseInt(url.searchParams.get("max_cells")!, 10) : null;
    const page = Math.max(0, intParam(url, "page", 0));
    const pageSize = clampPageSize(intParam(url, "page_size", 25));
    const sortRaw = url.searchParams.get("sort");
    const hasSort = !!sortRaw && ALLOWED_SORT_COLS.has(sortRaw);
    const sort = hasSort ? (sortRaw as string) : null;
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
      pubmed_ids: r.pubmed_ids ? JSON.parse(r.pubmed_ids as string) : [],
    }));

    return corsOk({ total, page, page_size: pageSize, data });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
