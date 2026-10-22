/**
 * Catalog freshness + data-integrity helpers (Stage 13a).
 *
 * - ensureCatalogColumns: adds the derived columns this code relies on
 *   (sample_qc.matrix_bytes / usable, gse_meta.n_usable_samples /
 *   reference_mismatch) on first use per isolate. D1 has no migration runner
 *   in this repo, so columns are created on demand, like sample_qc itself.
 * - usableRowsFromIndex: per-sample compressed matrix bytes from a bundle's
 *   central directory; a sample is usable when its exon+intron matrices are
 *   > 400 compressed bytes AND it has at least one called cell.
 * - referenceMismatch: whether a study's primary organism is covered by the
 *   reference build its reads were aligned to.
 * - refreshNext: one bounded step of the GET /api/ingest/refresh-next crank.
 */
import type { BundleIndex } from "./bundle-reader";
import { getBundleIndex, readEntryText, ensureSampleQcTable } from "./bundle-reader";
import { loadRules, toGroup, organismToScientific } from "./vocab";
import { qcTier } from "./qc-rules";
import { v2Available } from "./v2-catalog";
import { v2MatrixBytes } from "./v2-summaries";

/** Minimum compressed exon+intron bytes for a sample to hold a real matrix. */
export const MIN_MATRIX_BYTES = 400;

let columnsEnsured = false;

export async function ensureCatalogColumns(db: D1Database): Promise<void> {
  if (columnsEnsured) return;
  await ensureSampleQcTable(db).catch(() => undefined);
  const alters = [
    "ALTER TABLE sample_qc ADD COLUMN matrix_bytes INTEGER",
    "ALTER TABLE sample_qc ADD COLUMN usable INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN n_usable_samples INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN reference_mismatch INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN n_usable_cells INTEGER",
    "ALTER TABLE sample_qc ADD COLUMN qc_tier INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN n_lowqc_samples INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN n_lowqc_cells INTEGER",
  ];
  // Each ALTER fails harmlessly with "duplicate column" once applied.
  for (const sql of alters) await db.prepare(sql).run().catch(() => undefined);
  // Remember success only once every column (and the index) is really there, so
  // a transient D1 error on first use is retried by the next request instead of
  // being cached for the life of the isolate. LIMIT 0 reads no rows.
  try {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_sample_qc_usable ON sample_qc(gse_id, usable)").run();
    await db.batch([
      db.prepare("SELECT matrix_bytes, usable, qc_tier FROM sample_qc LIMIT 0"),
      db.prepare("SELECT n_usable_samples, reference_mismatch, n_usable_cells, n_lowqc_samples, n_lowqc_cells FROM gse_meta LIMIT 0"),
    ]);
    columnsEnsured = true;
  } catch {
    /* retried on the next call */
  }
}

// ── usable samples ─────────────────────────────────────────────────────────

const MATRIX_RE = /^samples\/(GSM\d+)\/(?:.*\/)?(exon|intron)_counts\.1pz$/;

/** Compressed exon+intron matrix bytes per GSM, from the zip central directory. */
export function matrixBytesByGsm(index: Pick<BundleIndex, "entries">): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of index.entries) {
    const m = MATRIX_RE.exec(e.p);
    if (!m) continue;
    out.set(m[1], (out.get(m[1]) ?? 0) + Number(e.c ?? 0));
  }
  return out;
}

export function isUsable(matrixBytes: number | null | undefined, cellsCalled: number | null | undefined): boolean {
  return Number(matrixBytes ?? 0) > MIN_MATRIX_BYTES && Number(cellsCalled ?? 0) > 0;
}

/**
 * Write matrix_bytes/usable/qc_tier for every sample_qc row of one study and mark its gse_meta stale.
 * `usable` means the sample has count data; `qc_tier` is the quality verdict from qc-rules.ts.
 */
export async function applyUsable(db: D1Database, gse: string, index: Pick<BundleIndex, "entries">): Promise<number> {
  return applyUsableBytes(db, gse, matrixBytesByGsm(index));
}

/** The same for a study served from v2, whose matrix sizes come from the catalog (`v2_sample.members_json`) instead of a zip directory. */
export async function applyUsableV2(db: D1Database, gse: string, rev: string): Promise<number> {
  return applyUsableBytes(db, gse, await v2MatrixBytes(db, gse, rev));
}

async function applyUsableBytes(db: D1Database, gse: string, bytes: Map<string, number>): Promise<number> {
  const rows = await db
    .prepare(`SELECT gsm_id, n_cells_called, median_genes, mapping_rate FROM sample_qc WHERE gse_id = ?`)
    .bind(gse)
    .all<{ gsm_id: string; n_cells_called: number | null; median_genes: number | null; mapping_rate: number | null }>();
  // No rows → nothing changes, so gse_meta is not marked stale either.
  if (!rows.results?.length) return 0;
  const stmts = rows.results.map((r) => {
    const b = bytes.get(r.gsm_id) ?? 0;
    return db
      .prepare(`UPDATE sample_qc SET matrix_bytes = ?, usable = ?, qc_tier = ? WHERE gsm_id = ?`)
      .bind(b, isUsable(b, r.n_cells_called) ? 1 : 0, qcTier(r.median_genes, r.mapping_rate), r.gsm_id);
  });
  stmts.push(db.prepare(`UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = ?`).bind(gse));
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return rows.results?.length ?? 0;
}

// ── reference / species ────────────────────────────────────────────────────

/** Species a reference build covers, or null when the build is not recognised. */
export function speciesForBuild(build: string | null | undefined): string[] | null {
  if (!build) return null;
  const b = build.toLowerCase();
  const out: string[] = [];
  if (/grch3[78]|hg(19|38)|human/.test(b)) out.push("Homo sapiens");
  if (/grcm3[89]|mm(10|39)|mouse/.test(b)) out.push("Mus musculus");
  if (/barnyard/.test(b) && !out.length) out.push("Homo sapiens", "Mus musculus");
  if (/mratbn|rnor|rat/.test(b)) out.push("Rattus norvegicus");
  if (/grcz1|danrer|zebrafish/.test(b)) out.push("Danio rerio");
  if (/bdgp|dm6|drosophila/.test(b)) out.push("Drosophila melanogaster");
  if (/mmul|rhemac/.test(b)) out.push("Macaca mulatta");
  if (/sscrofa|susscr/.test(b)) out.push("Sus scrofa");
  if (/galgal|grcg/.test(b)) out.push("Gallus gallus");
  if (/tair|arabidopsis/.test(b)) out.push("Arabidopsis thaliana");
  if (/wbcel|ce11/.test(b)) out.push("Caenorhabditis elegans");
  if (/ars-ucd|bostau/.test(b)) out.push("Bos taurus");
  if (/canfam/.test(b)) out.push("Canis familiaris");
  return out.length ? out : null;
}

/** True when the organism is known and the build is known and does not cover it. */
export function referenceMismatch(organism: string | null | undefined, build: string | null | undefined): boolean {
  const sci = organismToScientific(organism ?? null);
  const species = speciesForBuild(build);
  if (!sci || !species) return false;
  return !species.some((s) => s.toLowerCase() === sci.toLowerCase());
}

// ── crank bookkeeping ──────────────────────────────────────────────────────

let crankTablesEnsured = false;

/**
 * Tables the index-next / refresh-next cranks keep for themselves, created on
 * first use: bundle_index_failure (parked studies) and summaries_indexed
 * (studies whose summary.json files index-next or index-bundle has read, so a
 * study is not re-read forever when another study with the same GSMs takes
 * over its sample_qc rows — sample_qc is keyed on gsm_id alone).
 */
export async function ensureCrankTables(db: D1Database): Promise<void> {
  if (crankTablesEnsured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS bundle_index_failure (gse_id TEXT PRIMARY KEY, error TEXT, updated_at TEXT)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS summaries_indexed (gse_id TEXT PRIMARY KEY, n_samples INTEGER, indexed_at TEXT)`).run();
  crankTablesEnsured = true;
}

/** Record that a study's summaries were read and written to sample_qc. */
export async function markSummariesIndexed(db: D1Database, gse: string, nSamples: number, stamp: string): Promise<void> {
  await db
    .prepare(`INSERT OR REPLACE INTO summaries_indexed (gse_id, n_samples, indexed_at) VALUES (?, ?, ?)`)
    .bind(gse, nSamples, stamp)
    .run();
}

/**
 * Park reasons (bundle_index_failure.error) that prove the file itself cannot
 * be read: its zip structure is broken (bundle-reader parseZipSource). Every
 * other park — a 5xx or timeout from data.singlet.bio, a HEAD 404 while a file
 * is still propagating, the Workers subrequest budget, a D1 error, an index
 * too large to store, no summary.json — says nothing about the matrices, so
 * such a study is never resolved to usable = 0 without a read.
 */
export const UNREADABLE_FILE_ERRORS = [
  "End of central directory not found",
  "zip64 locator not found",
  "zip64 EOCD record not found",
] as const;

/** True when a stored park reason proves the study's file is unreadable. */
export function isUnreadableFileError(error: string | null | undefined): boolean {
  const e = error ?? "";
  return UNREADABLE_FILE_ERRORS.some((s) => e.includes(s));
}

// SQL twin of isUnreadableFileError over `bundle_index_failure f` (instr is
// case-sensitive like includes; the messages hold no quote characters).
const UNREADABLE_PARK = `(${UNREADABLE_FILE_ERRORS.map((s) => `instr(f.error, '${s}') > 0`).join(" OR ")})`;

// ── refresh-next ───────────────────────────────────────────────────────────

// Studies moved to the v2 layout (schema/032): `served` = a v2_study row whose migration is verified or retired, `retired` = the legacy
// file is deleted. The catalog rows of the legacy file (gse.r2_bundle_key, bundle_manifest, bundle_index, sample_qc) are left in place by a
// retirement, so these clauses keep the cranks off a file that is gone and give a study that never had one the same treatment. Each SQL below
// has a v2-aware form (used once schema/032 exists) and the original form.
const retiredSql = (col: string) => `EXISTS (SELECT 1 FROM v2_migration vm WHERE vm.gse_id = ${col} AND vm.status = 'retired')`;
const servedSql = (col: string) =>
  `EXISTS (SELECT 1 FROM v2_study vs JOIN v2_migration vm ON vm.gse_id = vs.gse_id WHERE vs.gse_id = ${col} AND vm.status IN ('verified', 'retired'))`;

const GSM_PENDING = `FROM gsm WHERE organism_primary IS NULL`;
const manifestPending = (v2: boolean) => `FROM gse g WHERE g.r2_bundle_key IS NOT NULL AND g.r2_bundle_key != ''
  AND NOT EXISTS (SELECT 1 FROM bundle_manifest m WHERE m.gse_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM bundle_index_failure f WHERE f.gse_id = g.id)${v2 ? `\n  AND NOT ${retiredSql("g.id")}` : ""}`;
const usablePending = (v2: boolean) =>
  `FROM bundle_index i WHERE EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = i.gse_id AND q.usable IS NULL)${v2 ? ` AND NOT ${retiredSql("i.gse_id")}` : ""}`;
// A served study whose matrices are measured from the catalog: sample_qc rows with no usable flag yet, in a study whose legacy file is gone
// or was never indexed.
const USABLE_V2_PENDING = `FROM v2_study vs JOIN v2_migration vm ON vm.gse_id = vs.gse_id
  WHERE vm.status IN ('verified', 'retired')
    AND EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = vs.gse_id AND q.usable IS NULL)
    AND (vm.status = 'retired' OR NOT EXISTS (SELECT 1 FROM bundle_index i WHERE i.gse_id = vs.gse_id))`;
// Unassessed samples whose study has no bundle_index and never will from this
// crank: there is no file, or the file is parked because its zip structure is
// broken (UNREADABLE_PARK). No readable matrix means not usable, so these
// resolve to usable = 0 without a network read. (A readable file with a
// manifest is indexed by index-next; one without a manifest by phase (c)
// below — both then set the flags from the index.) A study parked for any
// other reason (network, subrequest budget, D1, index too large to store)
// keeps usable IS NULL, and so its current gse_meta, rather than being zeroed
// and dropped from downloadable search on the strength of a failed read.
// A study served from v2 has a file (its sample objects) even when the legacy one is missing, so it is never resolved to usable = 0 here;
// USABLE_V2_PENDING measures it from the catalog instead.
const usableNoFile = (v2: boolean) => `FROM gse g
  WHERE EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = g.id AND q.usable IS NULL)
    AND NOT EXISTS (SELECT 1 FROM bundle_index i WHERE i.gse_id = g.id)
    AND (g.r2_bundle_key IS NULL OR g.r2_bundle_key = ''
         OR EXISTS (SELECT 1 FROM bundle_index_failure f WHERE f.gse_id = g.id AND ${UNREADABLE_PARK}))${v2 ? `\n    AND NOT ${servedSql("g.id")}` : ""}`;
// The inner SELECT narrows to missing/stale gse_meta first; its `LIMIT -1`
// (no limit) stops SQLite flattening it, which otherwise runs the correlated
// probes below for every gse row (~135k rows read per count instead of ~22k).
// The last clause waits for index-next: a study with a manifest but no
// sample_qc rows yet (summaries never read, not parked — index-next's own
// pending test) would otherwise be recomputed with n_usable_samples = 0 and
// drop out of search until the next pass.
const META_PENDING = `FROM (SELECT g.id FROM gse g LEFT JOIN gse_meta m ON m.gse_id = g.id
          WHERE m.gse_id IS NULL OR m.n_usable_samples IS NULL LIMIT -1) g
  WHERE NOT EXISTS (SELECT 1 FROM gsm s WHERE s.gse_id = g.id AND s.organism_primary IS NULL)
    AND NOT EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = g.id AND q.usable IS NULL)
    AND NOT (EXISTS (SELECT 1 FROM bundle_manifest b WHERE b.gse_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM summaries_indexed s WHERE s.gse_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM bundle_index_failure f WHERE f.gse_id = g.id))`;

export async function refreshRemaining(db: D1Database): Promise<Record<string, number>> {
  const v2 = await v2Available(db);
  const count = (w: string) => db.prepare(`SELECT COUNT(*) AS c ${w}`).first<{ c: number }>().then((r) => Number(r?.c ?? 0)).catch(() => -1);
  const [a, b, e, c, d, f] = await Promise.all(
    [GSM_PENDING, usablePending(v2), usableNoFile(v2), manifestPending(v2), META_PENDING, ...(v2 ? [USABLE_V2_PENDING] : [])].map(count)
  );
  return { gsm_normalize: a, sample_usable: b, sample_usable_no_file: e, bundle_manifest: c, gse_meta: d, ...(v2 ? { sample_usable_v2: f } : {}) };
}

/**
 * The first part of a "A; B" organism field that names a known species. Taking only the first part turned
 * "Homo; Homo sapiens" into "Homo", and a bare genus stayed a bare genus ("Mus").
 */
export const normOrganism = (raw: string | null): string => {
  const parts = (raw ?? "").split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const sci = organismToScientific(p);
    if (sci) return sci;
  }
  return parts[0] || "Unknown";
};

/** One bounded refresh step. `n` = studies (and 20 × n gsm rows) per phase. */
export async function refreshNext(db: D1Database, n: number): Promise<{ done: Record<string, number>; errors: string[] }> {
  await ensureCatalogColumns(db);
  await ensureCrankTables(db).catch(() => undefined);
  const v2 = await v2Available(db);
  const done = { gsm_normalized: 0, samples_usable: 0, manifests_created: 0, meta_recomputed: 0 };
  const errors: string[] = [];
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // (a) normalized gsm columns
  const rules = await loadRules(db).catch(() => []);
  const gsms = await db
    .prepare(`SELECT gsm_id, gse_id, organism, tissue, disease, protocol ${GSM_PENDING} LIMIT ?`)
    .bind(n * 20)
    .all<{ gsm_id: string; gse_id: string; organism: string | null; tissue: string | null; disease: string | null; protocol: string | null }>();
  const touched = new Set<string>();
  const gsmStmts = (gsms.results ?? []).map((r) => {
    touched.add(r.gse_id);
    return db
      .prepare(`UPDATE gsm SET organism_primary = ?, tissue_group = ?, disease_group = ?, assay_family = ? WHERE gsm_id = ?`)
      .bind(
        normOrganism(r.organism),
        toGroup(rules, "tissue", r.tissue) ?? "Other",
        toGroup(rules, "disease", r.disease) ?? "Other / unspecified",
        toGroup(rules, "protocol", r.protocol) ?? "Unknown",
        r.gsm_id
      );
  });
  for (const g of touched) gsmStmts.push(db.prepare(`UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = ?`).bind(g));
  for (let i = 0; i < gsmStmts.length; i += 100) await db.batch(gsmStmts.slice(i, i + 100));
  done.gsm_normalized = gsms.results?.length ?? 0;

  // (d, run first so meta sees it) usable flags from existing bundle_index rows
  const usableIds = await db.prepare(`SELECT i.gse_id ${usablePending(v2)} LIMIT ?`).bind(n).all<{ gse_id: string }>();
  for (const { gse_id } of usableIds.results ?? []) {
    try {
      const idx = await getBundleIndex(db, gse_id);
      done.samples_usable += await applyUsable(db, gse_id, idx);
    } catch (e) {
      errors.push(`${gse_id} usable: ${String(e).slice(0, 200)}`);
    }
  }
  // …and usable = 0 where there is no readable file to index (D1 only).
  const noFileIds = await db.prepare(`SELECT g.id AS gse_id ${usableNoFile(v2)} LIMIT ?`).bind(n).all<{ gse_id: string }>();
  for (const { gse_id } of noFileIds.results ?? []) {
    try {
      done.samples_usable += await applyUsable(db, gse_id, { entries: [] });
    } catch (e) {
      errors.push(`${gse_id} usable: ${String(e).slice(0, 200)}`);
    }
  }
  // …and, for studies served from v2 whose legacy file is gone or was never indexed, from the matrix sizes in the v2 catalog (D1 only).
  if (v2) {
    const v2Ids = await db.prepare(`SELECT vs.gse_id AS gse_id, vs.rev AS rev ${USABLE_V2_PENDING} LIMIT ?`).bind(n).all<{ gse_id: string; rev: string }>();
    for (const { gse_id, rev } of v2Ids.results ?? []) {
      try {
        done.samples_usable += await applyUsableV2(db, gse_id, rev);
      } catch (e) {
        errors.push(`${gse_id} usable (v2): ${String(e).slice(0, 200)}`);
      }
    }
  }

  // (c) bundle_manifest for files that have none
  const missing = await db.prepare(`SELECT g.id AS gse_id ${manifestPending(v2)} ORDER BY g.id LIMIT ?`).bind(Math.min(n, 10)).all<{ gse_id: string }>();
  for (const { gse_id } of missing.results ?? []) {
    try {
      const idx = await getBundleIndex(db, gse_id, { refresh: true });
      const entry = idx.entries.find((e) => e.p === "manifest.json");
      let man: Record<string, unknown> = {};
      if (entry) man = JSON.parse(await readEntryText(gse_id, entry, idx)) as Record<string, unknown>;
      const inBundle = new Set<string>();
      for (const e of idx.entries) {
        const m = /^samples\/(GSM\d+)\//.exec(e.p);
        if (m) inBundle.add(m[1]);
      }
      const manIds = Array.isArray(man.gsm_ids) ? (man.gsm_ids as string[]) : [];
      await db
        .prepare(
          `INSERT INTO bundle_manifest (gse_id, bytes, n_files, n_gsms_in_bundle, manifest_n_gsms, gsm_ids, manifest_created_at, audited_at, reference_build, singlet_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(gse_id) DO UPDATE SET bytes = excluded.bytes, n_files = excluded.n_files, n_gsms_in_bundle = excluded.n_gsms_in_bundle,
             manifest_n_gsms = excluded.manifest_n_gsms, gsm_ids = excluded.gsm_ids, manifest_created_at = excluded.manifest_created_at,
             audited_at = excluded.audited_at, reference_build = excluded.reference_build, singlet_version = excluded.singlet_version`
        )
        .bind(
          gse_id,
          idx.bytes,
          idx.entries.length,
          inBundle.size,
          Number(man.n_gsms ?? manIds.length) || null,
          JSON.stringify(manIds.length ? manIds : [...inBundle].sort()),
          typeof man.created_at === "string" ? man.created_at : null,
          stamp,
          typeof man.reference_build === "string" ? man.reference_build : null,
          typeof man.singlet_version === "string" ? man.singlet_version : null
        )
        .run();
      await db.prepare(`UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = ?`).bind(gse_id).run().catch(() => undefined);
      done.manifests_created++;
    } catch (e) {
      const msg = String(e).slice(0, 300);
      errors.push(`${gse_id} manifest: ${msg}`);
      await db
        .prepare(`INSERT OR REPLACE INTO bundle_index_failure (gse_id, error, updated_at) VALUES (?, ?, ?)`)
        .bind(gse_id, `manifest: ${msg}`, stamp)
        .run()
        .catch(() => undefined);
    }
  }

  // (b) gse_meta for studies missing one or marked stale
  const metaIds = await db.prepare(`SELECT g.id AS gse_id ${META_PENDING} LIMIT ?`).bind(n).all<{ gse_id: string }>();
  for (const { gse_id } of metaIds.results ?? []) {
    try {
      await recomputeMeta(db, gse_id, stamp, v2);
      done.meta_recomputed++;
    } catch (e) {
      errors.push(`${gse_id} meta: ${String(e).slice(0, 200)}`);
    }
  }
  return { done, errors };
}

const distinctJson = (col: string, limit = 60) =>
  `(SELECT json_group_array(v) FROM (SELECT DISTINCT ${col} AS v FROM gsm WHERE gse_id = ?1 AND ${col} IS NOT NULL AND ${col} != '' LIMIT ${limit}))`;

/**
 * `has_bundle` is "a published file exists": the legacy single file (gse.r2_bundle_key, which a retirement leaves in place) or, for a
 * study served from v2, its sample objects. `v2` says whether the v2 tables exist (default: ask).
 */
export async function recomputeMeta(db: D1Database, gse: string, stamp: string, v2?: boolean): Promise<void> {
  const withV2 = v2 ?? (await v2Available(db));
  const hasFile = `CASE WHEN (g.r2_bundle_key IS NOT NULL AND g.r2_bundle_key != '')${withV2 ? ` OR ${servedSql("g.id")}` : ""} THEN 1 ELSE 0 END`;
  await db
    .prepare(
      `INSERT INTO gse_meta (gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
         tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year, updated_at, n_usable_samples, n_usable_cells,
         n_lowqc_samples, n_lowqc_cells)
       SELECT g.id,
         (SELECT organism_primary FROM gsm WHERE gse_id = ?1 AND organism_primary IS NOT NULL GROUP BY organism_primary ORDER BY COUNT(*) DESC LIMIT 1),
         ${distinctJson("organism_primary")}, ${distinctJson("tissue_group")}, ${distinctJson("disease_group")}, ${distinctJson("assay_family")},
         ${distinctJson("tissue")}, ${distinctJson("cell_type")},
         0,
         (SELECT COUNT(*) FROM gsm WHERE gse_id = ?1 AND status IN ('DONE','DONE_QC_WARN')),
         MAX(COALESCE(g.n_gsm_total, 0), (SELECT COUNT(*) FROM gsm WHERE gse_id = ?1)),
         (SELECT COALESCE(SUM(n_cells), 0) FROM gsm WHERE gse_id = ?1 AND status IN ('DONE','DONE_QC_WARN')),
         ${hasFile},
         CAST(substr(g.submitted_date, 1, 4) AS INTEGER),
         ?2,
         (SELECT COUNT(*) FROM sample_qc WHERE gse_id = ?1 AND usable = 1 AND COALESCE(qc_tier, 0) = 0),
         (SELECT COALESCE(SUM(n_cells_called), 0) FROM sample_qc WHERE gse_id = ?1 AND usable = 1 AND COALESCE(qc_tier, 0) = 0),
         (SELECT COUNT(*) FROM sample_qc WHERE gse_id = ?1 AND usable = 1 AND qc_tier = 1),
         (SELECT COALESCE(SUM(n_cells_called), 0) FROM sample_qc WHERE gse_id = ?1 AND usable = 1 AND qc_tier = 1)
       FROM gse g WHERE g.id = ?1
       ON CONFLICT(gse_id) DO UPDATE SET
         organism_primary = excluded.organism_primary, organisms = excluded.organisms, tissue_groups = excluded.tissue_groups,
         disease_groups = excluded.disease_groups, assay_families = excluded.assay_families, tissues_raw = excluded.tissues_raw,
         cell_types_raw = excluded.cell_types_raw, n_done = excluded.n_done, n_total = excluded.n_total, n_cells = excluded.n_cells,
         has_bundle = excluded.has_bundle, year = COALESCE(gse_meta.year, excluded.year), updated_at = excluded.updated_at,
         n_usable_samples = excluded.n_usable_samples, n_usable_cells = excluded.n_usable_cells,
         n_lowqc_samples = excluded.n_lowqc_samples, n_lowqc_cells = excluded.n_lowqc_cells`
    )
    .bind(gse, stamp)
    .run();
  const build = withV2 ? "COALESCE(b.reference_build, (SELECT reference_build FROM v2_study WHERE gse_id = m.gse_id))" : "b.reference_build";
  const row = await db
    .prepare(`SELECT m.organism_primary AS org, ${build} AS build FROM gse_meta m LEFT JOIN bundle_manifest b ON b.gse_id = m.gse_id WHERE m.gse_id = ?`)
    .bind(gse)
    .first<{ org: string | null; build: string | null }>();
  await db
    .prepare(`UPDATE gse_meta SET reference_mismatch = ? WHERE gse_id = ?`)
    .bind(referenceMismatch(row?.org, row?.build) ? 1 : 0, gse)
    .run();
}
