/**
 * Research Alpha lists → idempotent SQL for D1 (schema/035). Pure functions, so the tests run the same SQL the
 * loader writes (src/test/alpha-exclusions.test.ts).
 *
 * Inputs:
 *   policy JSON  the data.singlet.bio guard's list (workers/data-guard/policy/alpha-policy.json: version, excluded_samples,
 *                withheld_studies). It is authoritative, so the catalog and the guard hide exactly the same things, and its
 *                version is stamped on every row as policy_version.
 *   samples TSVs the census lists the policy was built from (header with at least `gsm`, `gse`, `reasons`), for each
 *                sample's study and reasons. A policy sample with no TSV row takes its study from the catalog (gsm, then
 *                sample_qc) and the reason "unspecified"; a TSV row the policy does not list is ignored.
 *   (parseLists, the census-only form: samples TSV + studies TSV with `gse`, `action` = withhold.)
 *
 * Output, in the order to apply:
 *   01_withheld.sql              upserts into alpha_withheld
 *   02_exclusions_NNN.sql        upserts into alpha_exclusions (EXCLUSION_ROWS per statement, keeps each statement far below
 *                                D1's 100 KB limit; the schema/035 trigger marks each new row's study stale)
 *   03_recompute_NNN.sql         recomputes gse_meta for every study the lists touch (STUDY_CHUNK per statement), then any
 *                                downloadable study whose rollup drifted from sample_qc, then clears the derived caches
 * Re-running is harmless: rows are upserted on their keys and the rollups are recomputed from scratch. Nothing is deleted
 * from alpha_* tables; removing a row from a list means an explicit DELETE (the trigger marks that study stale again).
 */
import { ALPHA_POLICY_VERSION, META_DRIFT_SQL, hasFileSql, metaRollupSql } from "../../functions/_shared/alpha";

export const EXCLUSION_ROWS = 400;
export const STUDY_CHUNK = 150;

const GSM_RE = /^GSM\d+$/;
const GSE_RE = /^GSE\d+$/;
const REASON_RE = /^[a-z_]+(,[a-z_]+)*$/;

export interface ExclusionRow {
  gsm: string;
  gse: string;
  reason: string;
}

export interface ParsedLists {
  exclusions: ExclusionRow[];
  withheld: string[];
  /** Lines that could not be used, with why (the loader prints them and stops when there are any). */
  rejected: string[];
}

function table(text: string): { cols: Map<string, number>; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = (lines.shift() ?? "").split("\t").map((h) => h.trim());
  return { cols: new Map(head.map((h, i) => [h, i])), rows: lines.map((l) => l.split("\t")) };
}

export function parseLists(samplesTsv: string, studiesTsv: string): ParsedLists {
  const rejected: string[] = [];
  const s = table(samplesTsv);
  for (const c of ["gsm", "gse", "reasons"]) if (!s.cols.has(c)) throw new Error(`samples TSV has no '${c}' column`);
  const seen = new Map<string, ExclusionRow>();
  for (const [i, r] of s.rows.entries()) {
    const gsm = (r[s.cols.get("gsm")!] ?? "").trim().toUpperCase();
    const gse = (r[s.cols.get("gse")!] ?? "").trim().toUpperCase();
    const reason = (r[s.cols.get("reasons")!] ?? "").trim().toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).sort().join(",");
    if (!GSM_RE.test(gsm) || !GSE_RE.test(gse) || !REASON_RE.test(reason)) {
      rejected.push(`samples line ${i + 2}: ${r.slice(0, 3).join(" | ")}`);
      continue;
    }
    const prev = seen.get(gsm);
    if (prev && prev.gse !== gse) rejected.push(`samples line ${i + 2}: ${gsm} listed under ${prev.gse} and ${gse}`);
    // a sample listed twice keeps the union of its reasons
    seen.set(gsm, { gsm, gse, reason: prev ? [...new Set([...prev.reason.split(","), ...reason.split(",")])].sort().join(",") : reason });
  }
  const t = table(studiesTsv);
  for (const c of ["gse", "action"]) if (!t.cols.has(c)) throw new Error(`studies TSV has no '${c}' column`);
  const withheld = new Set<string>();
  for (const [i, r] of t.rows.entries()) {
    const gse = (r[t.cols.get("gse")!] ?? "").trim().toUpperCase();
    const action = (r[t.cols.get("action")!] ?? "").trim().toLowerCase();
    if (!GSE_RE.test(gse)) {
      rejected.push(`studies line ${i + 2}: ${r.slice(0, 2).join(" | ")}`);
      continue;
    }
    if (action === "withhold") withheld.add(gse);
  }
  return {
    exclusions: [...seen.values()].sort((a, b) => a.gsm.localeCompare(b.gsm)),
    withheld: [...withheld].sort(),
    rejected,
  };
}

/** Every value is validated against an accession or reason pattern before it gets here, so plain quoting is safe. */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export interface SqlFile {
  name: string;
  sql: string;
}

export interface PolicyLists extends ParsedLists {
  version: string;
  /** Policy samples with no TSV row: their study is looked up in the catalog when the SQL runs. */
  unresolved: string[];
  /** TSV rows the policy does not list (ignored). */
  ignored: number;
}

/** The guard's policy JSON as the authority, with the census TSVs for each sample's study and reasons. */
export function parsePolicy(policyJson: string, samplesTsvs: string[]): PolicyLists {
  const pol = JSON.parse(policyJson) as { version?: unknown; excluded_samples?: unknown; withheld_studies?: unknown };
  if (typeof pol.version !== "string" || !/^[\w.-]{1,64}$/.test(pol.version)) throw new Error("policy JSON has no usable version");
  if (!Array.isArray(pol.excluded_samples) || !Array.isArray(pol.withheld_studies)) throw new Error("policy JSON needs excluded_samples and withheld_studies arrays");
  const rejected: string[] = [];
  const excluded = new Set<string>();
  for (const g of pol.excluded_samples) {
    const v = String(g).trim().toUpperCase();
    if (GSM_RE.test(v)) excluded.add(v);
    else rejected.push(`policy excluded_samples: ${String(g).slice(0, 40)}`);
  }
  const withheld = new Set<string>();
  for (const g of pol.withheld_studies) {
    const v = String(g).trim().toUpperCase();
    if (GSE_RE.test(v)) withheld.add(v);
    else rejected.push(`policy withheld_studies: ${String(g).slice(0, 40)}`);
  }
  const known = new Map<string, ExclusionRow>();
  let ignored = 0;
  for (const tsv of samplesTsvs) {
    const p = parseLists(tsv, "gse\taction\n");
    rejected.push(...p.rejected);
    for (const r of p.exclusions) {
      if (!excluded.has(r.gsm)) {
        ignored++;
        continue;
      }
      const prev = known.get(r.gsm);
      if (prev && prev.gse !== r.gse) rejected.push(`${r.gsm} listed under ${prev.gse} and ${r.gse}`);
      known.set(r.gsm, prev ? { ...prev, reason: [...new Set([...prev.reason.split(","), ...r.reason.split(",")])].sort().join(",") } : r);
    }
  }
  return {
    version: pol.version,
    exclusions: [...known.values()].sort((a, b) => a.gsm.localeCompare(b.gsm)),
    unresolved: [...excluded].filter((g) => !known.has(g)).sort(),
    withheld: [...withheld].sort(),
    rejected,
    ignored,
  };
}

export function buildSqlFiles(
  lists: Pick<ParsedLists, "exclusions" | "withheld"> & { unresolved?: string[] },
  opts: { policy?: string; stamp?: string } = {}
): SqlFile[] {
  const policy = opts.policy ?? ALPHA_POLICY_VERSION;
  const stamp = opts.stamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const files: SqlFile[] = [];

  files.push({
    name: "01_withheld.sql",
    sql: chunks(lists.withheld, EXCLUSION_ROWS)
      .map(
        (part) =>
          `INSERT INTO alpha_withheld (gse_id, reason, policy_version) VALUES\n${part.map((g) => `  (${q(g)}, 'no_sample_left', ${q(policy)})`).join(",\n")}\n` +
          `ON CONFLICT(gse_id) DO UPDATE SET reason = excluded.reason, policy_version = excluded.policy_version;`
      )
      .join("\n"),
  });

  // 10 statements per file keeps each `wrangler d1 execute --file` call small enough to retry on its own.
  const exclStatements = chunks(lists.exclusions, EXCLUSION_ROWS).map(
    (part) =>
      `INSERT INTO alpha_exclusions (gsm_id, gse_id, reason, policy_version) VALUES\n${part.map((r) => `  (${q(r.gsm)}, ${q(r.gse)}, ${q(r.reason)}, ${q(policy)})`).join(",\n")}\n` +
      `ON CONFLICT(gsm_id) DO UPDATE SET gse_id = excluded.gse_id, reason = excluded.reason, policy_version = excluded.policy_version;`
  );
  // Samples the census TSVs do not place: the study comes from the catalog (gsm first, then sample_qc), reason "unspecified".
  for (const part of chunks(lists.unresolved ?? [], EXCLUSION_ROWS)) {
    const ids = part.map(q).join(", ");
    exclStatements.push(
      `INSERT INTO alpha_exclusions (gsm_id, gse_id, reason, policy_version)\n` +
        `SELECT x.gsm_id, x.gse_id, 'unspecified', ${q(policy)} FROM (\n` +
        `  SELECT gsm_id, gse_id FROM gsm WHERE gsm_id IN (${ids})\n` +
        `  UNION ALL SELECT q.gsm_id, q.gse_id FROM sample_qc q WHERE q.gsm_id IN (${ids}) AND NOT EXISTS (SELECT 1 FROM gsm s WHERE s.gsm_id = q.gsm_id)\n` +
        `) x WHERE x.gse_id IS NOT NULL\n` +
        `ON CONFLICT(gsm_id) DO UPDATE SET policy_version = excluded.policy_version;`
    );
  }
  chunks(exclStatements, 10).forEach((part, i) => files.push({ name: `02_exclusions_${String(i + 1).padStart(3, "0")}.sql`, sql: part.join("\n") }));

  const touched = [...new Set([...lists.exclusions.map((r) => r.gse), ...lists.withheld])].sort();
  const recompute = chunks(touched, STUDY_CHUNK).map((part) => `${metaRollupSql("g.id", `g.id IN (${part.map(q).join(", ")})`, hasFileSql(true), stamp)};`);
  // Studies of samples placed from the catalog (their ids are only known once the rows above are in).
  if (lists.unresolved?.length) {
    recompute.push(
      `${metaRollupSql("g.id", `g.id IN (SELECT DISTINCT gse_id FROM alpha_exclusions WHERE reason = 'unspecified' LIMIT -1)`, hasFileSql(true), stamp)};`
    );
  }
  // Studies whose stored rollup drifted from sample_qc for other reasons (sample_qc rows moved to another study, the cause of
  // the 10-24 stats/search disagreement) are recomputed the same way. LIMIT -1 makes SQLite materialise the list first.
  recompute.push(
    `${metaRollupSql("g.id", `g.id IN (SELECT gse_id FROM (${META_DRIFT_SQL} LIMIT -1))`, hasFileSql(true), stamp)};`,
    // Derived caches built from the old rollups: facet counts, stats, per-study conditions, the cell-type vocabulary.
    `DELETE FROM meta_cache WHERE key LIKE 'facets:%' OR key LIKE 'stats:%' OR key LIKE 'conditions:%' OR key LIKE 'vocab:%';`
  );
  chunks(recompute, 10).forEach((part, i) => files.push({ name: `03_recompute_${String(i + 1).padStart(3, "0")}.sql`, sql: part.join("\n") }));
  return files;
}
