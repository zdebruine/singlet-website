/**
 * GET /api/gsm
 * List samples with filters:
 *   organism, protocol, tissue, cell_type, disease, sex, status, qc_flag,
 *   failure_category, min_cells, max_cells, q (FTS)
 * Pagination: page (0-based), page_size (default 50, max 500)
 * Sorting: sort (column), asc (1=asc)
 */
import { corsOk, corsErr, handleOptions, intParam, clampPageSize } from "../../_shared/cors";

interface Env {
  DB: D1Database;
}

const ALLOWED_SORT_COLS = new Set([
  "gsm_id", "gse_id", "organism", "protocol", "tissue", "cell_type",
  "n_cells", "mapping_rate", "median_genes", "median_umis", "mt_pct",
  "status", "qc_flag", "pipeline_date", "pz_size_bytes", "last_updated"
]);

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const url = new URL(request.url);

    // Filters
    const organism        = url.searchParams.get("organism") ?? "";
    const protocol        = url.searchParams.get("protocol") ?? "";
    const tissue          = url.searchParams.get("tissue") ?? "";
    const cell_type       = url.searchParams.get("cell_type") ?? "";
    const disease         = url.searchParams.get("disease") ?? "";
    const sex             = url.searchParams.get("sex") ?? "";
    const status          = url.searchParams.get("status") ?? "";
    const qc_flag         = url.searchParams.get("qc_flag") ?? "";
    const failure_category = url.searchParams.get("failure_category") ?? "";
    const q               = url.searchParams.get("q")?.trim() ?? "";
    const minCells = url.searchParams.get("min_cells") ? parseInt(url.searchParams.get("min_cells")!, 10) : null;
    const maxCells = url.searchParams.get("max_cells") ? parseInt(url.searchParams.get("max_cells")!, 10) : null;

    // Pagination / sorting
    const page     = Math.max(0, intParam(url, "page", 0));
    const pageSize = clampPageSize(intParam(url, "page_size", 50));
    const sortRaw  = url.searchParams.get("sort");
    const hasSort  = !!sortRaw && ALLOWED_SORT_COLS.has(sortRaw);
    const sort     = hasSort ? (sortRaw as string) : null;
    const asc      = url.searchParams.get("asc") === "1";
    const dir      = asc ? "ASC" : "DESC";
    const offset   = page * pageSize;

    // Default ordering: successful rows with real data first.
    // (SQLite sorts NULLs first on ASC, so `n_cells DESC` places NULLs last.)
    const orderBy = sort
      ? `${sort} ${dir} NULLS LAST`
      : `(status = 'DONE') DESC, n_cells DESC`;

    const conditions: string[] = [];
    const bindParams: (string | number)[] = [];

    if (q) {
      conditions.push("gsm_id IN (SELECT gsm_id FROM fts_gsm WHERE fts_gsm MATCH ?)");
      bindParams.push(q + "*");
    }
    if (organism)         { conditions.push("organism = ?");          bindParams.push(organism); }
    if (protocol)         { conditions.push("protocol = ?");          bindParams.push(protocol); }
    if (tissue)           { conditions.push("tissue = ?");            bindParams.push(tissue); }
    if (cell_type)        { conditions.push("cell_type = ?");         bindParams.push(cell_type); }
    if (disease)          { conditions.push("disease = ?");           bindParams.push(disease); }
    if (sex)              { conditions.push("sex = ?");               bindParams.push(sex); }
    if (status)           { conditions.push("status = ?");            bindParams.push(status); }
    if (qc_flag)          { conditions.push("qc_flag = ?");           bindParams.push(qc_flag); }
    if (failure_category) { conditions.push("failure_category = ?");  bindParams.push(failure_category); }
    if (minCells != null && !isNaN(minCells)) { conditions.push("n_cells >= ?"); bindParams.push(minCells); }
    if (maxCells != null && !isNaN(maxCells)) { conditions.push("n_cells <= ?"); bindParams.push(maxCells); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRow, rows] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as n FROM gsm ${where}`)
        .bind(...bindParams).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id,
                disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct,
                status, qc_flag, failure_category, singlet_version, pipeline_date,
                pz_size_bytes, title, source, srr_ids, last_updated
         FROM gsm ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      ).bind(...bindParams, pageSize, offset).all<Record<string, unknown>>(),
    ]);

    const data = rows.results.map(r => ({
      ...r,
      srr_ids: r.srr_ids ? JSON.parse(r.srr_ids as string) : [],
    }));

    return corsOk({ total: countRow?.n ?? 0, page, page_size: pageSize, data });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
