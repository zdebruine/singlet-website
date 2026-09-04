/**
 * Contextual facet counts for the Browse rail.
 *
 * Standard faceted-search semantics: each facet's counts respect every OTHER
 * active filter (so ticking "Mouse" updates the tissue counts, and the organism
 * list still shows the alternatives). Study level counts DISTINCT studies via
 * `gse_meta` + json_each; sample level counts `gsm` rows.
 *
 * D1 rejects compound SELECTs with more than 5 terms ("too many terms in
 * compound SELECT"), so the facets are NOT one big UNION ALL. Facets that share
 * the same "all filters except X" base are grouped into statements of at most
 * MAX_COMPOUND_TERMS terms (each statement carries its own copy of the base
 * CTE) and every statement for a request runs in ONE `db.batch()` round trip;
 * the rows are merged afterwards. The unfiltered catalog is precomputed into
 * `meta_cache` (keys `facets:gse:all*` / `facets:gsm:all*`) and refreshed when
 * older than a day, so no request ever runs an unfiltered GROUP BY over `gsm`.
 */
import { metaCached } from "./cache";
import {
  buildSampleWhere,
  buildStudyWhere,
  hasAnyFilter,
  studyHitIds,
  tokenizeQuery,
  extractAccessions,
  type ArrayFilterField,
  type Ctx,
  type Level,
  type SearchFilters,
} from "./search-core";
import { ASSAY_FAMILIES, DISEASE_GROUPS, TISSUE_GROUPS, organismToCommon } from "./vocab";
import { D1_MAX_COMPOUND_TERMS } from "./d1-limits";

/** D1's hard limit is 5 terms per compound SELECT; stay one under it. */
export const MAX_COMPOUND_TERMS = D1_MAX_COMPOUND_TERMS - 1;

export interface FacetOption {
  value: string;
  count: number;
  label?: string;
}

export interface FacetsResponse {
  level: Level;
  organism: FacetOption[];
  tissue_group: FacetOption[];
  disease_group: FacetOption[];
  assay_family: FacetOption[];
  cell_type: FacetOption[];
  year: FacetOption[];
  /** Canonical group lists so the UI never hard-codes them. */
  vocab: {
    tissue_group: readonly string[];
    disease_group: readonly string[];
    assay_family: readonly string[];
  };
  /** Total matching studies/samples under ALL filters (for the header). */
  total: number;
}

const CELL_TYPE_FACET_LIMIT = 40;
const YEAR_FACET_LIMIT = 40;
const DAY_MS = 24 * 3600 * 1000;

type FacetName = ArrayFilterField | "year";

interface FacetRow {
  facet: string;
  value: string | null;
  n: number;
}

/** One SQL statement ready for `db.prepare(sql).bind(...params)`. */
export interface FacetStatement {
  sql: string;
  params: (string | number)[];
  /** Number of compound SELECT terms in `sql` (always ≤ MAX_COMPOUND_TERMS). */
  terms: number;
}

interface Base {
  name: string;
  cte: string;
  params: (string | number)[];
}

/**
 * Group SELECT terms by the base CTE they read from and emit statements with at
 * most MAX_COMPOUND_TERMS terms each. Every statement embeds its own copy of
 * the base CTE so it is self-contained (D1 batches are independent statements).
 */
function chunkIntoStatements(items: { base: Base; select: string }[]): FacetStatement[] {
  const byBase = new Map<string, { base: Base; selects: string[] }>();
  for (const it of items) {
    const g = byBase.get(it.base.name) ?? { base: it.base, selects: [] };
    g.selects.push(it.select);
    byBase.set(it.base.name, g);
  }
  const out: FacetStatement[] = [];
  for (const { base, selects } of byBase.values()) {
    for (let i = 0; i < selects.length; i += MAX_COMPOUND_TERMS) {
      const chunk = selects.slice(i, i + MAX_COMPOUND_TERMS);
      out.push({
        sql: `WITH ${base.cte}\n${chunk.join("\nUNION ALL\n")}`,
        params: [...base.params],
        terms: chunk.length,
      });
    }
  }
  return out;
}

/** Is the constraint for `facet` currently active (so its own counts must exclude it)? */
function facetActive(f: SearchFilters, facet: FacetName): boolean {
  return facet === "year" ? f.year_min != null || f.year_max != null : f[facet].length > 0;
}

// ── Study level ─────────────────────────────────────────────────────────────

const STUDY_FACETS: { name: FacetName; col: string; lower?: boolean; limit?: number }[] = [
  { name: "organism", col: "organisms" },
  { name: "tissue_group", col: "tissue_groups" },
  { name: "disease_group", col: "disease_groups" },
  { name: "assay_family", col: "assay_families" },
  { name: "cell_type", col: "cell_types_raw", lower: true, limit: CELL_TYPE_FACET_LIMIT },
];

export function studyFacetStatements(f: SearchFilters, gseIds: string[] | null): FacetStatement[] {
  const bases = new Map<string, Base>();
  const baseFor = (exclude: FacetName | "none"): Base => {
    const active = exclude !== "none" && facetActive(f, exclude);
    const key = active ? exclude : "all";
    const existing = bases.get(key);
    if (existing) return existing;
    const w = buildStudyWhere(f, { exclude: active ? (exclude as FacetName) : undefined, gseIds });
    const base: Base = {
      name: `b_${key}`,
      cte: `b_${key} AS (SELECT m.gse_id, m.organisms, m.tissue_groups, m.disease_groups, m.assay_families, m.cell_types_raw, m.year
                   FROM gse_meta m${w.clauses.length ? ` WHERE ${w.clauses.join(" AND ")}` : ""})`,
      params: w.params,
    };
    bases.set(key, base);
    return base;
  };

  const items: { base: Base; select: string }[] = [];
  for (const fc of STUDY_FACETS) {
    const base = baseFor(fc.name);
    const valueExpr = fc.lower ? "lower(trim(je.value))" : "je.value";
    const inner = `SELECT '${fc.name}' AS facet, ${valueExpr} AS value, COUNT(DISTINCT b.gse_id) AS n
                     FROM ${base.name} b, json_each(b.${fc.col}) je
                    WHERE je.value IS NOT NULL AND trim(je.value) != ''
                    GROUP BY ${valueExpr}`;
    items.push({ base, select: fc.limit ? `SELECT * FROM (${inner} ORDER BY n DESC LIMIT ${fc.limit})` : inner });
  }
  const by = baseFor("year");
  items.push({
    base: by,
    select: `SELECT * FROM (SELECT 'year' AS facet, CAST(b.year AS TEXT) AS value, COUNT(*) AS n FROM ${by.name} b WHERE b.year IS NOT NULL GROUP BY b.year ORDER BY b.year DESC LIMIT ${YEAR_FACET_LIMIT})`,
  });
  const ball = baseFor("none");
  items.push({ base: ball, select: `SELECT '_total' AS facet, NULL AS value, COUNT(*) AS n FROM ${ball.name}` });

  return chunkIntoStatements(items);
}

// ── Sample level ────────────────────────────────────────────────────────────

const SAMPLE_FACETS: { name: FacetName; expr: string; limit?: number }[] = [
  { name: "organism", expr: "b.organism_primary" },
  { name: "tissue_group", expr: "b.tissue_group" },
  { name: "disease_group", expr: "b.disease_group" },
  { name: "assay_family", expr: "b.assay_family" },
  { name: "cell_type", expr: "lower(trim(b.cell_type))", limit: CELL_TYPE_FACET_LIMIT },
];

export function sampleFacetStatements(f: SearchFilters, gsmIds: string[] | null, gseIds: string[] | null): FacetStatement[] {
  const bases = new Map<string, Base>();
  const baseFor = (exclude: FacetName | "none"): Base => {
    const active = exclude !== "none" && facetActive(f, exclude);
    const key = active ? exclude : "all";
    const existing = bases.get(key);
    if (existing) return existing;
    const w = buildSampleWhere(f, { exclude: active ? (exclude as FacetName) : undefined, gseIds });
    const clauses = [...w.clauses];
    const params = [...w.params];
    if (gsmIds) {
      clauses.push("s.gsm_id IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(gsmIds));
    }
    const base: Base = {
      name: `b_${key}`,
      cte: `b_${key} AS (SELECT s.gsm_id, s.organism_primary, s.tissue_group, s.disease_group, s.assay_family, s.cell_type, m.year
                   FROM gsm s LEFT JOIN gse_meta m ON m.gse_id = s.gse_id${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""})`,
      params,
    };
    bases.set(key, base);
    return base;
  };

  const items: { base: Base; select: string }[] = [];
  for (const fc of SAMPLE_FACETS) {
    const base = baseFor(fc.name);
    const inner = `SELECT '${fc.name}' AS facet, ${fc.expr} AS value, COUNT(*) AS n FROM ${base.name} b
                    WHERE ${fc.expr} IS NOT NULL AND ${fc.expr} != '' GROUP BY ${fc.expr}`;
    items.push({ base, select: fc.limit ? `SELECT * FROM (${inner} ORDER BY n DESC LIMIT ${fc.limit})` : inner });
  }
  const by = baseFor("year");
  items.push({
    base: by,
    select: `SELECT * FROM (SELECT 'year' AS facet, CAST(b.year AS TEXT) AS value, COUNT(*) AS n FROM ${by.name} b WHERE b.year IS NOT NULL GROUP BY b.year ORDER BY b.year DESC LIMIT ${YEAR_FACET_LIMIT})`,
  });
  const ball = baseFor("none");
  items.push({ base: ball, select: `SELECT '_total' AS facet, NULL AS value, COUNT(*) AS n FROM ${ball.name}` });

  return chunkIntoStatements(items);
}

// ── Assemble ────────────────────────────────────────────────────────────────

function emptyFacets(level: Level): FacetsResponse {
  return {
    level,
    organism: [],
    tissue_group: [],
    disease_group: [],
    assay_family: [],
    cell_type: [],
    year: [],
    vocab: { tissue_group: TISSUE_GROUPS, disease_group: DISEASE_GROUPS, assay_family: ASSAY_FAMILIES },
    total: 0,
  };
}

function assemble(level: Level, rows: FacetRow[]): FacetsResponse {
  const out = emptyFacets(level);
  for (const r of rows) {
    if (r.facet === "_total") {
      out.total = Number(r.n ?? 0);
      continue;
    }
    if (r.value == null) continue;
    const opt: FacetOption = { value: r.value, count: Number(r.n) };
    if (r.facet === "organism") opt.label = organismToCommon(r.value);
    (out[r.facet as FacetName] as FacetOption[]).push(opt);
  }
  for (const k of ["organism", "tissue_group", "disease_group", "assay_family", "cell_type"] as const) {
    out[k].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  out.year.sort((a, b) => Number(b.value) - Number(a.value));
  return out;
}

/** Resolve the text part of the query to id lists (studies for gse level; samples+studies for gsm level). */
async function textScope(
  ctx: Ctx,
  f: SearchFilters,
  level: Level
): Promise<{ gseIds: string[] | null; gsmIds: string[] | null; empty: boolean }> {
  if (!f.q) return { gseIds: null, gsmIds: null, empty: false };
  const acc = extractAccessions(f.q);
  if (acc.gse.length || acc.gsm.length) {
    if (level === "gse") {
      const ids = [...acc.gse];
      if (acc.gsm.length) {
        const res = await ctx.db
          .prepare(`SELECT DISTINCT gse_id FROM gsm WHERE gsm_id IN (SELECT value FROM json_each(?))`)
          .bind(JSON.stringify(acc.gsm))
          .all<{ gse_id: string }>();
        ids.push(...res.results.map((r) => r.gse_id));
      }
      return { gseIds: [...new Set(ids)], gsmIds: null, empty: ids.length === 0 };
    }
    return { gseIds: acc.gse.length ? acc.gse : null, gsmIds: acc.gsm.length ? acc.gsm : null, empty: false };
  }
  const fts = tokenizeQuery(f.q);
  if (!fts.and) return { gseIds: [], gsmIds: null, empty: true };
  let ids = await studyHitIds(ctx.db, fts.and);
  if (!ids.length && fts.terms.length > 1 && fts.or) ids = await studyHitIds(ctx.db, fts.or);
  return { gseIds: ids, gsmIds: null, empty: ids.length === 0 };
}

export async function computeFacets(ctx: Ctx, f: SearchFilters, level: Level): Promise<FacetsResponse> {
  const unfiltered = !hasAnyFilter(f) && !f.q;
  if (unfiltered) {
    const key = `facets:${level}:all:${f.has_bundle === true ? "hb1" : "hb0"}`;
    return metaCached(ctx.db, ctx.waitUntil, key, DAY_MS, () => computeFacetsLive(ctx, f, level));
  }
  return computeFacetsLive(ctx, f, level);
}

async function computeFacetsLive(ctx: Ctx, f: SearchFilters, level: Level): Promise<FacetsResponse> {
  const scope = await textScope(ctx, f, level);
  if (scope.empty) return emptyFacets(level);
  const statements =
    level === "gse" ? studyFacetStatements(f, scope.gseIds) : sampleFacetStatements(f, scope.gsmIds, scope.gseIds);
  const rows = await runFacetStatements(ctx.db, statements);
  return assemble(level, rows);
}

/**
 * Execute every facet statement in one D1 batch (a single round trip) and
 * concatenate the rows. Each statement is guaranteed ≤ MAX_COMPOUND_TERMS
 * compound terms, which is under D1's hard limit of 5.
 */
export async function runFacetStatements(db: D1Database, statements: FacetStatement[]): Promise<FacetRow[]> {
  for (const s of statements) {
    if (s.terms > MAX_COMPOUND_TERMS) throw new Error(`facet statement has ${s.terms} compound terms (max ${MAX_COMPOUND_TERMS})`);
  }
  const results = await db.batch<FacetRow>(statements.map((s) => db.prepare(s.sql).bind(...s.params)));
  const rows: FacetRow[] = [];
  for (const r of results) rows.push(...(r.results ?? []));
  return rows;
}

// ── Vocabulary for the query interpreter ────────────────────────────────────

/** Top raw cell_type values across the catalog (lowercased), refreshed daily. */
export async function cellTypeVocab(ctx: Ctx, limit = 200): Promise<string[]> {
  const rows = await metaCached<{ value: string; count: number }[]>(
    ctx.db,
    ctx.waitUntil,
    `vocab:cell_type:top${limit}`,
    DAY_MS,
    async () => {
      const res = await ctx.db
        .prepare(
          `SELECT lower(trim(cell_type)) AS value, COUNT(*) AS count
             FROM gsm
            WHERE cell_type IS NOT NULL AND trim(cell_type) != ''
            GROUP BY lower(trim(cell_type))
            ORDER BY count DESC
            LIMIT ?`
        )
        .bind(limit)
        .all<{ value: string; count: number }>();
      return res.results.map((r) => ({ value: r.value, count: Number(r.count) }));
    }
  );
  return rows.map((r) => r.value);
}
