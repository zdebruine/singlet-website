/**
 * Research Alpha: what is not part of singlet.bio.
 *
 * Samples that were processed incorrectly (wrong strand, a non-RNA library processed as RNA, an empty count matrix) are
 * listed in `alpha_exclusions`, and studies left with no sample in `alpha_withheld` (schema/035, loaded by
 * scripts/alpha/load-exclusions.ts). Nothing public refers to them: they are left out of every count, search, facet,
 * study page, sample table, manifest, sitemap, MCP answer and download link, and a withheld study answers like an
 * unknown one. Every public reader goes through the fragments and helpers here so the rule is written once.
 *
 * The bytes themselves are refused by the data.singlet.bio guard (workers/data-guard) until the Alpha repack removes them.
 */
import type { ZipEntry } from "./bundle-reader";
import { publicEntries } from "./restricted";

/** Default policy_version when a load names none; a load from the guard's policy JSON stamps that file's version. */
export const ALPHA_POLICY_VERSION = "alpha-2026-10-26b";

/** SQL: true when the sample in `col` (a gsm_id expression) is not part of the atlas. */
export const sampleExcludedSql = (col: string) => `EXISTS (SELECT 1 FROM alpha_exclusions ax WHERE ax.gsm_id = ${col})`;
/** SQL: true when the sample in `col` is part of the atlas. */
export const sampleServedSql = (col: string) => `NOT ${sampleExcludedSql(col)}`;
/** SQL: true when the study in `col` (a gse_id expression) is withheld. */
export const studyWithheldSql = (col: string) => `EXISTS (SELECT 1 FROM alpha_withheld aw WHERE aw.gse_id = ${col})`;
/** SQL: true when the study in `col` is served. */
export const studyServedSql = (col: string) => `NOT ${studyWithheldSql(col)}`;

/** True when the study is withheld (answers 404 / "not in the atlas"). */
export async function isStudyWithheld(db: D1Database, gse: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS w FROM alpha_withheld WHERE gse_id = ?`).bind(gse).first<{ w: number }>();
  return !!row;
}

/** True when the sample is not part of the atlas. */
export async function isSampleExcluded(db: D1Database, gsm: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS x FROM alpha_exclusions WHERE gsm_id = ?`).bind(gsm).first<{ x: number }>();
  return !!row;
}

/** The excluded samples of one study (one indexed read). */
export async function excludedInStudy(db: D1Database, gse: string): Promise<Set<string>> {
  const rs = await db.prepare(`SELECT gsm_id FROM alpha_exclusions WHERE gse_id = ?`).bind(gse).all<{ gsm_id: string }>();
  return new Set((rs.results ?? []).map((r) => r.gsm_id));
}

/** Of these studies, the withheld ones (chunked under D1's 100-parameter limit). */
export async function withheldAmong(db: D1Database, gses: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(gses)];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rs = await db
      .prepare(`SELECT gse_id FROM alpha_withheld WHERE gse_id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ gse_id: string }>();
    for (const r of rs.results ?? []) out.add(r.gse_id);
  }
  return out;
}

/** Of these samples, the excluded ones (chunked). */
export async function excludedAmong(db: D1Database, gsms: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(gsms)];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rs = await db
      .prepare(`SELECT gsm_id FROM alpha_exclusions WHERE gsm_id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ gsm_id: string }>();
    for (const r of rs.results ?? []) out.add(r.gsm_id);
  }
  return out;
}

/** Whether the study's primary organism is human (human-only layers such as genetic sex are offered for human studies only). */
export async function studyIsHuman(db: D1Database, gse: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT organism_primary FROM gse_meta WHERE gse_id = ?1), (SELECT organism FROM gse WHERE id = ?1)) AS org`
    )
    .bind(gse)
    .first<{ org: string | null }>()
    .catch(() => null);
  return /^homo sapiens$|^human$/i.test((row?.org ?? "").trim());
}

/** The context publicEntries needs for one study: its excluded samples and whether it is human. */
export async function entryContext(db: D1Database, gse: string): Promise<{ human: boolean; excluded: Set<string> }> {
  const [excluded, human] = await Promise.all([excludedInStudy(db, gse), studyIsHuman(db, gse)]);
  return { human, excluded };
}

/** A study's file entries as Alpha serves them: no restricted member, no hidden layer, nothing of an excluded sample. */
export async function servedEntries<T extends Pick<ZipEntry, "p">>(db: D1Database, gse: string, entries: T[]): Promise<T[]> {
  return publicEntries(entries, await entryContext(db, gse));
}

/**
 * The rollup columns of `gse_meta` for every study `where` selects (`g` = gse), with excluded samples left out. One
 * definition for the catalog crank (recomputeMeta, one study) and the Alpha loader (every study touched by a list), so
 * the two cannot drift. `id` is the SQL expression of the study id inside the per-study subqueries: `?1` for one bound
 * study, `g.id` for a set. `hasFile` is the has_bundle expression over `g`.
 */
export function metaRollupSql(id: string, where: string, hasFile: string, stamp: string): string {
  const served = sampleServedSql("gsm.gsm_id");
  const qcServed = sampleServedSql("q.gsm_id");
  const distinctJson = (col: string, limit = 60) =>
    `(SELECT json_group_array(v) FROM (SELECT DISTINCT ${col} AS v FROM gsm WHERE gse_id = ${id} AND ${col} IS NOT NULL AND ${col} != '' AND ${served} LIMIT ${limit}))`;
  return `INSERT INTO gse_meta (gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
         tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year, updated_at, n_usable_samples, n_usable_cells,
         n_lowqc_samples, n_lowqc_cells)
       SELECT g.id,
         (SELECT organism_primary FROM gsm WHERE gse_id = ${id} AND organism_primary IS NOT NULL AND ${served} GROUP BY organism_primary ORDER BY COUNT(*) DESC LIMIT 1),
         ${distinctJson("organism_primary")}, ${distinctJson("tissue_group")}, ${distinctJson("disease_group")}, ${distinctJson("assay_family")},
         ${distinctJson("tissue")}, ${distinctJson("cell_type")},
         0,
         (SELECT COUNT(*) FROM gsm WHERE gse_id = ${id} AND status IN ('DONE','DONE_QC_WARN') AND ${served}),
         MAX(COALESCE(g.n_gsm_total, 0) - (SELECT COUNT(*) FROM alpha_exclusions x WHERE x.gse_id = ${id}),
             (SELECT COUNT(*) FROM gsm WHERE gse_id = ${id} AND ${served}), 0),
         (SELECT COALESCE(SUM(n_cells), 0) FROM gsm WHERE gse_id = ${id} AND status IN ('DONE','DONE_QC_WARN') AND ${served}),
         ${hasFile},
         CAST(substr(g.submitted_date, 1, 4) AS INTEGER),
         '${stamp.replace(/'/g, "")}',
         (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = ${id} AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0 AND ${qcServed}),
         (SELECT COALESCE(SUM(q.n_cells_called), 0) FROM sample_qc q WHERE q.gse_id = ${id} AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0 AND ${qcServed}),
         (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = ${id} AND q.usable = 1 AND q.qc_tier = 1 AND ${qcServed}),
         (SELECT COALESCE(SUM(q.n_cells_called), 0) FROM sample_qc q WHERE q.gse_id = ${id} AND q.usable = 1 AND q.qc_tier = 1 AND ${qcServed})
       FROM gse g WHERE ${where}
       ON CONFLICT(gse_id) DO UPDATE SET
         organism_primary = excluded.organism_primary, organisms = excluded.organisms, tissue_groups = excluded.tissue_groups,
         disease_groups = excluded.disease_groups, assay_families = excluded.assay_families, tissues_raw = excluded.tissues_raw,
         cell_types_raw = excluded.cell_types_raw, n_done = excluded.n_done, n_total = excluded.n_total, n_cells = excluded.n_cells,
         has_bundle = excluded.has_bundle, year = COALESCE(gse_meta.year, excluded.year), updated_at = excluded.updated_at,
         n_usable_samples = excluded.n_usable_samples, n_usable_cells = excluded.n_usable_cells,
         n_lowqc_samples = excluded.n_lowqc_samples, n_lowqc_cells = excluded.n_lowqc_cells`;
}

/** has_bundle over `g`: the legacy key, or (when the v2 tables exist) a study served from v2. */
export function hasFileSql(withV2: boolean): string {
  const served = `EXISTS (SELECT 1 FROM v2_study vs JOIN v2_migration vm ON vm.gse_id = vs.gse_id WHERE vs.gse_id = g.id AND vm.status IN ('verified', 'retired'))`;
  return `CASE WHEN (g.r2_bundle_key IS NOT NULL AND g.r2_bundle_key != '')${withV2 ? ` OR ${served}` : ""} THEN 1 ELSE 0 END`;
}

/**
 * SQL: the downloadable studies whose stored rollup disagrees with what sample_qc holds for them now (excluded samples
 * left out). The catalog crank marks these stale, so a write that bypassed the triggers in schema/035 still heals.
 */
export const META_DRIFT_SQL = `SELECT m.gse_id FROM gse_meta m
  WHERE m.has_bundle = 1 AND m.n_usable_samples IS NOT NULL
    AND (m.n_usable_samples != (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = m.gse_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0 AND ${sampleServedSql("q.gsm_id")})
      OR COALESCE(m.n_usable_cells, 0) != (SELECT COALESCE(SUM(q.n_cells_called), 0) FROM sample_qc q WHERE q.gse_id = m.gse_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0 AND ${sampleServedSql("q.gsm_id")}))`;

const GSE_ARG_RE = /^GSE\d+$/;
const GSM_ARG_RE = /^GSM\d+$/;

/**
 * The MCP tools' arguments as Alpha sees them. A single `gse_id` that is withheld, or a `gsm_id` that is not part of the
 * atlas, is answered as not found (`error`); withheld studies and excluded samples in `gse_ids` / `gsm_ids` lists are
 * dropped silently, so a tool never mentions them. Two indexed reads at most.
 */
export async function alphaToolArgs(db: D1Database, args: Record<string, unknown>): Promise<{ args: Record<string, unknown>; error?: string }> {
  const one = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);
  const list = (v: unknown, re: RegExp) => (Array.isArray(v) ? v.map((x) => String(x).trim().toUpperCase()).filter((x) => re.test(x)) : []);
  const gse = one(args.gse_id, GSE_ARG_RE);
  const gsm = one(args.gsm_id, GSM_ARG_RE);
  const gses = list(args.gse_ids, GSE_ARG_RE);
  const gsms = list(args.gsm_ids, GSM_ARG_RE);
  if (!gse && !gsm && !gses.length && !gsms.length) return { args };
  const [withheld, excluded] = await Promise.all([
    withheldAmong(db, [...(gse ? [gse] : []), ...gses]),
    excludedAmong(db, [...(gsm ? [gsm] : []), ...gsms]),
  ]);
  if (gse && withheld.has(gse)) return { args, error: `${gse} is not in the atlas. It may not be single-cell RNA-seq, or it has not been processed. Try search_datasets.` };
  if (gsm && excluded.has(gsm)) return { args, error: `${gsm} is not in the atlas.` };
  if (!withheld.size && !excluded.size) return { args };
  const out = { ...args };
  if (Array.isArray(args.gse_ids)) out.gse_ids = (args.gse_ids as unknown[]).filter((x) => !withheld.has(String(x).trim().toUpperCase()));
  if (Array.isArray(args.gsm_ids)) out.gsm_ids = (args.gsm_ids as unknown[]).filter((x) => !excluded.has(String(x).trim().toUpperCase()));
  return { args: out };
}
