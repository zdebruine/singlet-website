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

/** Minimum compressed exon+intron bytes for a sample to hold a real matrix. */
export const MIN_MATRIX_BYTES = 400;

let columnsEnsured = false;

export async function ensureCatalogColumns(db: D1Database): Promise<void> {
  if (columnsEnsured) return;
  columnsEnsured = true;
  await ensureSampleQcTable(db).catch(() => undefined);
  const alters = [
    "ALTER TABLE sample_qc ADD COLUMN matrix_bytes INTEGER",
    "ALTER TABLE sample_qc ADD COLUMN usable INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN n_usable_samples INTEGER",
    "ALTER TABLE gse_meta ADD COLUMN reference_mismatch INTEGER",
  ];
  // Each ALTER fails harmlessly with "duplicate column" once applied.
  for (const sql of alters) await db.prepare(sql).run().catch(() => undefined);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_sample_qc_usable ON sample_qc(gse_id, usable)").run().catch(() => undefined);
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

/** Write matrix_bytes/usable for every sample_qc row of one study and mark its gse_meta stale. */
export async function applyUsable(db: D1Database, gse: string, index: Pick<BundleIndex, "entries">): Promise<number> {
  const bytes = matrixBytesByGsm(index);
  const rows = await db
    .prepare(`SELECT gsm_id, n_cells_called FROM sample_qc WHERE gse_id = ?`)
    .bind(gse)
    .all<{ gsm_id: string; n_cells_called: number | null }>();
  const stmts = (rows.results ?? []).map((r) => {
    const b = bytes.get(r.gsm_id) ?? 0;
    return db
      .prepare(`UPDATE sample_qc SET matrix_bytes = ?, usable = ? WHERE gsm_id = ?`)
      .bind(b, isUsable(b, r.n_cells_called) ? 1 : 0, r.gsm_id);
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

// ── refresh-next ───────────────────────────────────────────────────────────

const GSM_PENDING = `FROM gsm WHERE organism_primary IS NULL`;
const MANIFEST_PENDING = `FROM gse g WHERE g.r2_bundle_key IS NOT NULL AND g.r2_bundle_key != ''
  AND NOT EXISTS (SELECT 1 FROM bundle_manifest m WHERE m.gse_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM bundle_index_failure f WHERE f.gse_id = g.id)`;
const USABLE_PENDING = `FROM bundle_index i WHERE EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = i.gse_id AND q.usable IS NULL)`;
const META_PENDING = `FROM gse g LEFT JOIN gse_meta m ON m.gse_id = g.id
  WHERE (m.gse_id IS NULL OR m.n_usable_samples IS NULL)
    AND NOT EXISTS (SELECT 1 FROM gsm s WHERE s.gse_id = g.id AND s.organism_primary IS NULL)
    AND NOT EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = g.id AND q.usable IS NULL)`;

export async function refreshRemaining(db: D1Database): Promise<Record<string, number>> {
  const [a, b, c, d] = await Promise.all(
    [GSM_PENDING, USABLE_PENDING, MANIFEST_PENDING, META_PENDING].map((w) =>
      db.prepare(`SELECT COUNT(*) AS c ${w}`).first<{ c: number }>().then((r) => Number(r?.c ?? 0)).catch(() => -1)
    )
  );
  return { gsm_normalize: a, sample_usable: b, bundle_manifest: c, gse_meta: d };
}

const normOrganism = (raw: string | null): string => {
  const first = (raw ?? "").split(/[;,]/)[0]?.trim() ?? "";
  return organismToScientific(first) ?? (first || "Unknown");
};

/** One bounded refresh step. `n` = studies (and 20 × n gsm rows) per phase. */
export async function refreshNext(db: D1Database, n: number): Promise<{ done: Record<string, number>; errors: string[] }> {
  await ensureCatalogColumns(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS bundle_index_failure (gse_id TEXT PRIMARY KEY, error TEXT, updated_at TEXT)`).run().catch(() => undefined);
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
  const usableIds = await db.prepare(`SELECT i.gse_id ${USABLE_PENDING} LIMIT ?`).bind(n).all<{ gse_id: string }>();
  for (const { gse_id } of usableIds.results ?? []) {
    try {
      const idx = await getBundleIndex(db, gse_id);
      done.samples_usable += await applyUsable(db, gse_id, idx);
    } catch (e) {
      errors.push(`${gse_id} usable: ${String(e).slice(0, 200)}`);
    }
  }

  // (c) bundle_manifest for files that have none
  const missing = await db.prepare(`SELECT g.id AS gse_id ${MANIFEST_PENDING} ORDER BY g.id LIMIT ?`).bind(Math.min(n, 10)).all<{ gse_id: string }>();
  for (const { gse_id } of missing.results ?? []) {
    try {
      const idx = await getBundleIndex(db, gse_id, { refresh: true });
      const entry = idx.entries.find((e) => e.p === "manifest.json");
      let man: Record<string, unknown> = {};
      if (entry) man = JSON.parse(await readEntryText(gse_id, entry)) as Record<string, unknown>;
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
      await recomputeMeta(db, gse_id, stamp);
      done.meta_recomputed++;
    } catch (e) {
      errors.push(`${gse_id} meta: ${String(e).slice(0, 200)}`);
    }
  }
  return { done, errors };
}

const distinctJson = (col: string, limit = 60) =>
  `(SELECT json_group_array(v) FROM (SELECT DISTINCT ${col} AS v FROM gsm WHERE gse_id = ?1 AND ${col} IS NOT NULL AND ${col} != '' LIMIT ${limit}))`;

export async function recomputeMeta(db: D1Database, gse: string, stamp: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gse_meta (gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
         tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year, updated_at, n_usable_samples)
       SELECT g.id,
         (SELECT organism_primary FROM gsm WHERE gse_id = ?1 AND organism_primary IS NOT NULL GROUP BY organism_primary ORDER BY COUNT(*) DESC LIMIT 1),
         ${distinctJson("organism_primary")}, ${distinctJson("tissue_group")}, ${distinctJson("disease_group")}, ${distinctJson("assay_family")},
         ${distinctJson("tissue")}, ${distinctJson("cell_type")},
         0,
         (SELECT COUNT(*) FROM gsm WHERE gse_id = ?1 AND status IN ('DONE','DONE_QC_WARN')),
         MAX(COALESCE(g.n_gsm_total, 0), (SELECT COUNT(*) FROM gsm WHERE gse_id = ?1)),
         (SELECT COALESCE(SUM(n_cells), 0) FROM gsm WHERE gse_id = ?1 AND status IN ('DONE','DONE_QC_WARN')),
         CASE WHEN g.r2_bundle_key IS NOT NULL AND g.r2_bundle_key != '' THEN 1 ELSE 0 END,
         CAST(substr(g.submitted_date, 1, 4) AS INTEGER),
         ?2,
         (SELECT COUNT(*) FROM sample_qc WHERE gse_id = ?1 AND usable = 1)
       FROM gse g WHERE g.id = ?1
       ON CONFLICT(gse_id) DO UPDATE SET
         organism_primary = excluded.organism_primary, organisms = excluded.organisms, tissue_groups = excluded.tissue_groups,
         disease_groups = excluded.disease_groups, assay_families = excluded.assay_families, tissues_raw = excluded.tissues_raw,
         cell_types_raw = excluded.cell_types_raw, n_done = excluded.n_done, n_total = excluded.n_total, n_cells = excluded.n_cells,
         has_bundle = excluded.has_bundle, year = COALESCE(gse_meta.year, excluded.year), updated_at = excluded.updated_at,
         n_usable_samples = excluded.n_usable_samples`
    )
    .bind(gse, stamp)
    .run();
  const row = await db
    .prepare(`SELECT m.organism_primary AS org, b.reference_build AS build FROM gse_meta m LEFT JOIN bundle_manifest b ON b.gse_id = m.gse_id WHERE m.gse_id = ?`)
    .bind(gse)
    .first<{ org: string | null; build: string | null }>();
  await db
    .prepare(`UPDATE gse_meta SET reference_mismatch = ? WHERE gse_id = ?`)
    .bind(referenceMismatch(row?.org, row?.build) ? 1 : 0, gse)
    .run();
}
