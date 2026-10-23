/**
 * GET /api/ontology/terms?filter=tissue|cell_type|development_stage|disease|ancestry|sex[&q=lun][&values=a|b][&limit=20]
 *
 * Terms for the ontology filters (`<filter>_term` on /api/search and /api/nl-search), with the downloadable
 * samples and studies under each term, descendants included (ontology_term_count, the headline basis).
 *
 *   no q      the terms samples are mapped to directly, most studies first
 *   q         terms whose label or exact synonym contains q (an id finds itself), exact and prefix matches first;
 *             ancestors with no direct samples are included ("T cell" when samples say "CD4 T cell")
 *   values    resolve filter values (ids or labels) to terms, in order; unresolved values come back with id null
 *
 * Response: { filter, ontologies, terms: [{id, label, ontology, n_samples, n_studies}], resolved?: [...] }.
 * Until schema/034 is applied and filled the lists are empty and `available` is false.
 */
import { serverError } from "../../_shared/errors";
import { corsOk, corsErr, handleOptions } from "../../_shared/cors";
import { cachedJson, FACETS_CACHE_TTL } from "../../_shared/cache";
import { resolveIdentity } from "../../_shared/identity";
import { TERM_FILTERS, TERM_FILTER_NAMES, canonicalTermId, normLabel, termKey, type TermFilter } from "../../_shared/ontology";

interface Env {
  DB: D1Database;
}

interface TermRow {
  id: string;
  label: string;
  ontology: string;
  n_samples: number;
  n_studies: number;
}

const COLS = "t.term_id AS id, t.label, t.ontology, c.n_samples, c.n_studies";

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") as TermFilter | null;
  if (!filter || !TERM_FILTER_NAMES.includes(filter)) return corsErr(`filter must be one of ${TERM_FILTER_NAMES.join(", ")}`, 400);
  const spec = TERM_FILTERS[filter];
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const values = (url.searchParams.get("values") ?? "").split("|").map((v) => v.trim()).filter(Boolean).slice(0, 50);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const onto = spec.ontologies.map((o) => `'${o}'`).join(",");
  const key = `filter=${filter}&q=${normLabel(q)}&values=${values.map(termKey).join("|")}&limit=${limit}`;

  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        let terms: TermRow[];
        if (!q) {
          terms = (await env.DB.prepare(
            `SELECT ${COLS} FROM ontology_term_count c JOIN ontology_term t ON t.term_id = c.term_id
             WHERE c.attr = ?1 AND c.n_direct > 0 ORDER BY c.n_studies DESC, c.n_samples DESC, t.label LIMIT ?2`
          ).bind(spec.attr, limit).all<TermRow>()).results;
        } else {
          const asId = canonicalTermId(q);
          const needle = asId ? asId.toLowerCase() : normLabel(q);
          terms = (await env.DB.prepare(
            `SELECT ${COLS}, MIN(CASE WHEN l.label_norm = ?2 THEN 0 WHEN l.label_norm LIKE ?2 || '%' THEN 1 ELSE 2 END) AS rank
             FROM ontology_label l
             JOIN ontology_term t ON t.term_id = l.term_id
             JOIN ontology_term_count c ON c.term_id = l.term_id AND c.attr = ?1
             WHERE l.ontology IN (${onto}) AND ${asId ? "l.label_norm = ?2" : "l.kind != 'id' AND l.label_norm LIKE '%' || ?2 || '%'"}
             GROUP BY t.term_id ORDER BY rank, c.n_studies DESC, c.n_samples DESC, t.label LIMIT ?3`
          ).bind(spec.attr, needle, limit).all<TermRow & { rank: number }>()).results.map(({ rank: _rank, ...t }) => t);
        }
        let resolved: (TermRow | { id: null; value: string })[] | undefined;
        if (values.length) {
          const keys = values.map(termKey);
          const rows = (await env.DB.prepare(
            `SELECT l.label_norm AS k, ${COLS.replace("c.n_samples", "COALESCE(c.n_samples, 0) AS n_samples").replace("c.n_studies", "COALESCE(c.n_studies, 0) AS n_studies")}
             FROM ontology_label l JOIN ontology_term t ON t.term_id = l.term_id
             LEFT JOIN ontology_term_count c ON c.term_id = l.term_id AND c.attr = ?1
             WHERE l.ontology IN (${onto}) AND l.label_norm IN (SELECT value FROM json_each(?2))`
          ).bind(spec.attr, JSON.stringify(keys)).all<TermRow & { k: string }>()).results;
          resolved = values.map((value, i) => {
            const hit = rows.find((r) => r.k === keys[i]);
            if (!hit) return { id: null, value };
            const { k: _k, ...t } = hit;
            return { ...t, value };
          });
        }
        return corsOk({ filter, ontologies: spec.ontologies, available: true, terms, ...(resolved ? { resolved } : {}) });
      } catch (e) {
        if (/no such table/i.test(String(e))) return corsOk({ filter, ontologies: spec.ontologies, available: false, terms: [] });
        return serverError(e, "ontology-terms");
      }
    },
    { ttl: FACETS_CACHE_TTL, key }
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
