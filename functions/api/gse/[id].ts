/**
 * GET /api/gse/:id
 * Series detail: series row + all samples + linked publications.
 */
import { corsOk, corsErr, handleOptions } from "../../_shared/cors";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  try {
    const id = (params.id as string ?? "").toUpperCase();
    if (!id) return corsErr("Missing id", 400);

    const [seriesRow, samplesResult, pubsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT id, title, abstract, organism, n_gsm_total, n_gsm_done, n_gsm_failed,
                n_cells, pubmed_ids, r2_bundle_key, r2_bundle_bytes, submitted_date, last_updated
         FROM gse WHERE id = ?`
      ).bind(id).first<Record<string, unknown>>(),

      env.DB.prepare(
        `SELECT gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id,
                disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct,
                status, qc_flag, failure_category, failure_detail, singlet_version,
                pipeline_date, pz_size_bytes, title, source, srr_ids, last_updated
         FROM gsm WHERE gse_id = ? ORDER BY gsm_id ASC`
      ).bind(id).all<Record<string, unknown>>(),

      env.DB.prepare(
        `SELECT p.pmid, p.title, p.doi, p.abstract, p.year, p.journal
         FROM publications p
         JOIN gse_publication gp ON gp.pmid = p.pmid
         WHERE gp.gse_id = ?`
      ).bind(id).all<Record<string, unknown>>(),
    ]);

    if (!seriesRow) return corsErr(`Series ${id} not found`, 404);

    const series = {
      ...seriesRow,
      pubmed_ids: seriesRow.pubmed_ids ? JSON.parse(seriesRow.pubmed_ids as string) : [],
    };

    const samples = samplesResult.results.map(r => ({
      ...r,
      srr_ids: r.srr_ids ? JSON.parse(r.srr_ids as string) : [],
      characteristics: r.characteristics ? JSON.parse(r.characteristics as string) : null,
    }));

    return corsOk({
      series,
      samples,
      publications: pubsResult.results,
    });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
