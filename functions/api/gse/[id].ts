/**
 * GET /api/gse/:id
 * Study detail: series row + normalised study metadata + all samples (with
 * parsed GEO characteristics and a plain-words status) + conditions summary +
 * linked publications. `qc_flag` is never returned.
 */
import { corsOk, corsErr, handleOptions } from "../../_shared/cors";
import { cachedJson } from "../../_shared/cache";
import { safeList } from "../../_shared/json";
import { parseCharacteristics, summarizeConditions } from "../../_shared/conditions";
import { isSuspectCellCount } from "../../_shared/suspect-cells";
import { statusText } from "../../_shared/search-core";
import { organismToCommon } from "../../_shared/vocab";

interface Env {
  DB: D1Database;
}

const DETAIL_TTL = 300;

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) =>
  cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const id = ((params.id as string) ?? "").toUpperCase();
        if (!/^GSE\d+$/.test(id)) return corsErr("Invalid series id", 400);

        const [seriesRow, metaRow, samplesResult, pubsResult] = await Promise.all([
          env.DB.prepare(
            `SELECT id, title, abstract, organism, n_gsm_total, n_gsm_done, n_gsm_failed,
                    n_cells, pubmed_ids, r2_bundle_key, r2_bundle_bytes, submitted_date, last_updated
               FROM gse WHERE id = ?`
          )
            .bind(id)
            .first<Record<string, unknown>>(),

          env.DB.prepare(
            `SELECT gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
                    tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year
               FROM gse_meta WHERE gse_id = ?`
          )
            .bind(id)
            .first<Record<string, unknown>>()
            .catch(() => null),

          env.DB.prepare(
            `SELECT gsm_id, gse_id, organism, organism_primary, protocol, assay_family, modality,
                    tissue, tissue_group, cell_type, donor_id, disease, disease_group, sex, n_cells,
                    mapping_rate, median_genes, median_umis, mt_pct, status, failure_category,
                    failure_detail, singlet_version, pipeline_date, pz_size_bytes, title, source,
                    srr_ids, characteristics, last_updated
               FROM gsm WHERE gse_id = ? ORDER BY gsm_id ASC`
          )
            .bind(id)
            .all<Record<string, unknown>>(),

          env.DB.prepare(
            `SELECT p.pmid, p.title, p.doi, p.abstract, p.year, p.journal
               FROM publications p
               JOIN gse_publication gp ON gp.pmid = p.pmid
              WHERE gp.gse_id = ?`
          )
            .bind(id)
            .all<Record<string, unknown>>()
            .catch(() => ({ results: [] as Record<string, unknown>[] })),
        ]);

        if (!seriesRow) return corsErr(`Series ${id} not found`, 404);

        const samples = samplesResult.results.map((r) => {
          const nCells = r.n_cells != null ? Number(r.n_cells) : null;
          return {
            ...r,
            n_cells: nCells,
            srr_ids: safeList(r.srr_ids),
            characteristics: parseCharacteristics(r.characteristics),
            characteristics_raw: typeof r.characteristics === "string" ? r.characteristics : null,
            status_text: statusText(r.status as string, r.failure_category as string | null),
            suspect_cells: isSuspectCellCount(r.protocol as string | null, r.assay_family as string | null, nCells),
            organism_label: organismToCommon((r.organism_primary as string | null) ?? (r.organism as string | null)),
          };
        });

        const summary = summarizeConditions(samples.map((s) => ({ characteristics: s.characteristics_raw })));

        const series = {
          ...seriesRow,
          pubmed_ids: safeList(seriesRow.pubmed_ids),
          organism_label: organismToCommon(
            (metaRow?.organism_primary as string | null) ?? (seriesRow.organism as string | null)
          ),
        };

        const meta = metaRow
          ? {
              organism_primary: metaRow.organism_primary as string | null,
              organisms: safeList(metaRow.organisms),
              tissue_groups: safeList(metaRow.tissue_groups),
              disease_groups: safeList(metaRow.disease_groups),
              assay_families: safeList(metaRow.assay_families),
              tissues_raw: safeList(metaRow.tissues_raw),
              cell_types_raw: safeList(metaRow.cell_types_raw),
              n_done: Number(metaRow.n_done ?? 0),
              n_total: Number(metaRow.n_total ?? 0),
              n_cells: Number(metaRow.n_cells ?? 0),
              has_bundle: Number(metaRow.has_bundle ?? 0) === 1,
              year: metaRow.year != null ? Number(metaRow.year) : null,
            }
          : null;

        return corsOk({
          series,
          meta,
          samples,
          conditions: summary.conditions,
          conditions_label: summary.label,
          publications: pubsResult.results,
        });
      } catch (e) {
        return corsErr(String(e));
      }
    },
    DETAIL_TTL
  );

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
