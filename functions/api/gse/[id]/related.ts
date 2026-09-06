/**
 * GET /api/gse/:id/related — up to 8 related studies.
 *
 * Same publication first (a shared PubMed id), then studies with a published
 * file that share the organism plus a tissue group and disease group, biggest
 * first. Nothing is invented: a study only appears if the catalog says so.
 */
import { corsOk, corsErr, handleOptions } from "../../../_shared/cors";
import { cachedJson } from "../../../_shared/cache";
import { GSE_RE } from "../../../_shared/study-core";
import { safeList } from "../../../_shared/json";
import { organismToCommon } from "../../../_shared/search-core";

interface Env {
  DB: D1Database;
}

const LIMIT = 8;
const TTL = 3600;

export interface RelatedStudy {
  gse_id: string;
  title: string | null;
  organism_label: string;
  tissue_groups: string[];
  disease_groups: string[];
  /** Samples processed in the catalog. */
  n_done: number;
  n_cells: number;
  year: number | null;
  /** Plain-language reason this study is next to the one being viewed. */
  reason: string;
}

function shape(r: Record<string, unknown>, reason: string): RelatedStudy {
  return {
    gse_id: String(r.gse_id),
    title: (r.title as string | null) ?? null,
    organism_label: organismToCommon((r.organism_primary as string | null) ?? null),
    tissue_groups: safeList(r.tissue_groups),
    disease_groups: safeList(r.disease_groups),
    n_done: Number(r.n_done ?? 0),
    n_cells: Number(r.n_cells ?? 0),
    year: r.year != null ? Number(r.year) : null,
    reason,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) => {
  const id = String(params.id ?? "").toUpperCase();
  if (!GSE_RE.test(id)) return corsErr("Invalid series id", 400);

  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const self = await env.DB.prepare(
          `SELECT g.pubmed_ids, m.organism_primary, m.tissue_groups, m.disease_groups
             FROM gse g LEFT JOIN gse_meta m ON m.gse_id = g.id WHERE g.id = ?`
        )
          .bind(id)
          .first<Record<string, unknown>>();
        if (!self) return corsErr(`Series ${id} not found`, 404);

        const pmids = safeList(self.pubmed_ids).slice(0, 4);
        const seen = new Set<string>([id]);
        const out: RelatedStudy[] = [];

        // 1. Same publication.
        for (const pmid of pmids) {
          if (out.length >= LIMIT) break;
          const res = await env.DB.prepare(
            `SELECT g.id AS gse_id, g.title, m.organism_primary, m.tissue_groups, m.disease_groups, m.n_done, m.n_cells, m.year
               FROM gse g LEFT JOIN gse_meta m ON m.gse_id = g.id
              WHERE g.id != ? AND g.pubmed_ids LIKE ?
              ORDER BY m.n_cells DESC LIMIT ?`
          )
            .bind(id, `%"${pmid}"%`, LIMIT)
            .all<Record<string, unknown>>()
            .catch(() => ({ results: [] as Record<string, unknown>[] }));
          for (const r of res.results) {
            const gid = String(r.gse_id);
            if (seen.has(gid)) continue;
            seen.add(gid);
            out.push(shape(r, "same publication"));
            if (out.length >= LIMIT) break;
          }
        }

        // 2. Same organism + tissue group + disease group, with a file.
        const organism = (self.organism_primary as string | null) ?? null;
        const tissue = safeList(self.tissue_groups)[0] ?? null;
        const disease = safeList(self.disease_groups)[0] ?? null;
        if (out.length < LIMIT && organism && tissue) {
          const res = await env.DB.prepare(
            `SELECT m.gse_id, g.title, m.organism_primary, m.tissue_groups, m.disease_groups, m.n_done, m.n_cells, m.year
               FROM gse_meta m JOIN gse g ON g.id = m.gse_id
              WHERE m.gse_id != ? AND m.organism_primary = ? AND m.has_bundle = 1
                AND EXISTS (SELECT 1 FROM json_each(m.tissue_groups) t WHERE t.value = ?)
                ${disease ? `AND EXISTS (SELECT 1 FROM json_each(m.disease_groups) d WHERE d.value = ?)` : ""}
              ORDER BY m.n_cells DESC LIMIT ?`
          )
            .bind(...(disease ? [id, organism, tissue, disease, LIMIT * 2] : [id, organism, tissue, LIMIT * 2]))
            .all<Record<string, unknown>>()
            .catch(() => ({ results: [] as Record<string, unknown>[] }));
          const why = disease ? `same tissue & disease (${tissue}, ${disease})` : `same tissue (${tissue})`;
          for (const r of res.results) {
            const gid = String(r.gse_id);
            if (seen.has(gid)) continue;
            seen.add(gid);
            out.push(shape(r, why));
            if (out.length >= LIMIT) break;
          }
        }

        return corsOk({ gse_id: id, total: out.length, related: out });
      } catch (e) {
        return corsErr(String(e));
      }
    },
    TTL
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
