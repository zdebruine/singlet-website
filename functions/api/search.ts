/**
 * GET /api/search
 *
 * Structured + ranked free-text catalog search. Explicit rail filters remain
 * hard constraints; interpreted facets and keyword evidence are scored.
 *
 * Params
 *   q              free text; GEO accessions (GSE…/GSM…) short-circuit to lookup
 *   level          gse (default) | gsm
 *   organism       repeatable; common or scientific names accepted
 *   tissue_group   repeatable; canonical group or any synonym in vocab_rules
 *   disease_group  repeatable
 *   assay_family   repeatable
 *   cell_type      repeatable free text (matched on gsm.cell_type OR characteristics)
 *   min_cells      integer
 *   has_bundle     1 (default) | 0 — 0 also shows studies/samples whose .singlet file is not built yet
 *   year_min / year_max
 *   sort           relevance (default) | cells | samples | year | accession
 *   page           1-based, default 1
 *   limit          ≤ 200, default 20
 *   format         json (default) | accessions  → text/plain, one id per line, ≤ 5000
 *
 * Response (json)
 *   { level, total, totals: {studies, samples, cells}, page, limit,
 *     data: StudyRow[] | SampleRow[], accessions: string[], applied, dropped, note? }
 *
 * Cached at the edge for CATALOG_CACHE_TTL seconds keyed on the normalised params.
 */
import { CORS_HEADERS, corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson, CATALOG_CACHE_TTL } from "../_shared/cache";
import { type CloudEnv } from "../_shared/cloud";
import { resolveIdentity } from "../_shared/identity";
import { loadRules } from "../_shared/vocab";
import {
  canonicalQuery,
  exportStudyAccessions,
  normalizeFilters,
  parseSearchParams,
  pickFilters,
  runSampleSearch,
  runStudySearch,
  tokenizeQuery,
  MAX_EXPORT,
} from "../_shared/search-core";

interface Env extends CloudEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const started = Date.now();
  // Keys are optional here (no AI budget is spent), but a key that is sent
  // must be a real one — a revoked key never quietly works.
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;

  const url = new URL(request.url);
  const params = parseSearchParams(url);
  const rules = await loadRules(env.DB, waitUntil);
  const { filters, dropped } = normalizeFilters(params, rules);
  const key = canonicalQuery(filters);
  const ctx = { db: env.DB, rules, waitUntil };

  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        if (filters.format === "accessions") {
          if (filters.level !== "gse") return corsErr("format=accessions is only available at level=gse", 400);
          const { total, accessions } = await exportStudyAccessions(ctx, filters);
          return new Response(accessions.join("\n") + (accessions.length ? "\n" : ""), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "text/plain; charset=utf-8",
              "Content-Disposition": `attachment; filename="singlet-accessions.txt"`,
              "X-Total-Count": String(total),
              "X-Export-Limit": String(MAX_EXPORT),
            },
          });
        }

        const result =
          filters.level === "gse" ? await runStudySearch(ctx, filters) : await runSampleSearch(ctx, filters);

        let note: string | undefined;
        if (filters.q) {
          const fts = tokenizeQuery(filters.q);
          if (!fts.terms.length && !result.accession_lookup) note = "The text query contained no searchable terms.";
          else if (result.total === 0) note = "No studies match every term; try fewer words or remove a filter.";
          else if (result.any_word) note = "No study mentions every word, so these match any of the words instead.";
        }
        // Unrecognised filter values are reported structurally in `dropped`; the UI renders them itself.

        return corsOk({
          level: filters.level,
          total: result.total,
          totals: result.totals,
          page: result.page,
          limit: result.limit,
          data: result.data,
          accessions: result.accessions,
          applied: pickFilters(filters),
          dropped,
          ...(result.accession_lookup ? { accession_lookup: result.accession_lookup } : {}),
          ...(result.any_word ? { any_word: true } : {}),
          ...(result.groups ? { groups: result.groups } : {}),
          ms: Date.now() - started,
          ...(note ? { note } : {}),
        });
      } catch (e) {
        return corsErr(String(e));
      }
    },
    { ttl: CATALOG_CACHE_TTL, key }
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
