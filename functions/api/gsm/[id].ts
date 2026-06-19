/**
 * GET /api/gsm/:id
 * Sample detail: sample row + parent series (summary) + siblings (same GSE, up to 20).
 */
import { corsOk, corsErr, handleOptions } from "../../_shared/cors";
import { safeJson, safeList } from "../../_shared/json";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  try {
    const id = (params.id as string ?? "").toUpperCase();
    if (!id) return corsErr("Missing id", 400);

    const sample = await env.DB.prepare(
      `SELECT gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id,
              disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct,
              status, qc_flag, failure_category, failure_detail, singlet_version,
              pipeline_date, pz_size_bytes, title, source, srr_ids, characteristics, last_updated
       FROM gsm WHERE gsm_id = ?`
    ).bind(id).first<Record<string, unknown>>();

    if (!sample) return corsErr(`Sample ${id} not found`, 404);

    const gseId = sample.gse_id as string;

    const [seriesRow, siblingsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT id, title, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells, submitted_date
         FROM gse WHERE id = ?`
      ).bind(gseId).first<Record<string, unknown>>(),

      env.DB.prepare(
        `SELECT gsm_id, status, n_cells, title, qc_flag
         FROM gsm WHERE gse_id = ? AND gsm_id != ?
         ORDER BY gsm_id ASC LIMIT 20`
      ).bind(gseId, id).all<Record<string, unknown>>(),
    ]);

    return corsOk({
      sample: {
        ...sample,
        srr_ids: safeList(sample.srr_ids),
        characteristics: safeJson(sample.characteristics, sample.characteristics ?? null),
      },
      series: seriesRow ?? null,
      siblings: siblingsResult.results,
    });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
