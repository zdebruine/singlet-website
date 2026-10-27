/**
 * Shapes served by /api/bundle/* — the study's own `.singlet` file read over
 * HTTP Range requests, plus the D1 mirror of the per-sample QC summaries.
 */
import { applyUsable, applyUsableS1, isUsable, matrixBytesByGsm } from "./catalog-refresh";
import { entryContext, excludedInStudy, sampleServedSql } from "./alpha";
import { isUnofferedMember, publicEntries } from "./restricted";
import { getS1Samples, getS1State, listS1Samples, parseJsonObject, type S1State } from "./s1-catalog";
import { readS1Summaries, s1MatrixBytes } from "./s1-summaries";
import { describeMembers } from "./s1-serve";
import { s1ManifestUrl } from "./s1-urls";
import {
  StaleBundleError,
  readEntryText,
  ensureSampleQcTable,
  sampleOf,
  withIndexRetry,
  type BundleIndex,
  type ZipEntry,
} from "./bundle-reader";

export interface BundleFile {
  path: string;
  bytes_compressed: number;
  bytes_uncompressed: number;
}

export interface BundleSampleFiles {
  gsm_id: string;
  files: BundleFile[];
  total_bytes: number;
}

export interface BundleIndexResponse {
  gse_id: string;
  bytes: number;
  /** ETag of the file the listing was read from (null for rows indexed before schema/031). Send as If-Match with a range. */
  etag: string | null;
  reference_build: string | null;
  singlet_version: string | null;
  created_at: string | null;
  indexed_at: string;
  n_samples: number;
  samples: BundleSampleFiles[];
  study_files: BundleFile[];
}

function file(e: ZipEntry): BundleFile {
  return { path: e.p, bytes_compressed: e.c, bytes_uncompressed: e.u };
}

export async function bundleIndexResponse(
  db: D1Database,
  gse: string,
  index: BundleIndex,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<BundleIndexResponse> {
  const manifest = await db
    .prepare(`SELECT reference_build, singlet_version, manifest_created_at FROM bundle_manifest WHERE gse_id = ?`)
    .bind(gse)
    .first<{ reference_build: string | null; singlet_version: string | null; manifest_created_at: string | null }>()
    .catch(() => null);

  const bySample = new Map<string, BundleFile[]>();
  const studyFiles: BundleFile[] = [];
  // No restricted member, no layer Alpha does not offer, nothing of a sample that is not part of the atlas.
  for (const e of publicEntries(index.entries, await entryContext(db, gse))) {
    const gsm = sampleOf(e.p);
    if (!gsm) {
      studyFiles.push(file(e));
      continue;
    }
    const list = bySample.get(gsm) ?? [];
    list.push(file(e));
    bySample.set(gsm, list);
  }

  const samples: BundleSampleFiles[] = [...bySample.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([gsm_id, files]) => ({
      gsm_id,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      total_bytes: files.reduce((n, f) => n + f.bytes_compressed, 0),
    }));

  return {
    gse_id: gse,
    bytes: index.bytes,
    etag: index.etag ?? null,
    reference_build: manifest?.reference_build ?? null,
    singlet_version: manifest?.singlet_version ?? null,
    created_at: manifest?.manifest_created_at ?? null,
    indexed_at: index.indexed_at,
    n_samples: samples.length,
    samples,
    study_files: studyFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Samples whose files are listed in an s1 index; beyond this only the sample and its size are (the listing is edge-cached for a day). */
const S1_INDEX_FILE_SAMPLES = 100;

export interface S1BundleIndexResponse extends BundleIndexResponse {
  format: "singlet-s1";
  rev: string;
  manifest_url: string;
  /** True when more samples are listed than their files are. */
  files_truncated: boolean;
}

/**
 * The same shape as bundleIndexResponse for a study served from s1: `bytes` is the total of the sample objects, a sample's `files` are its
 * members (`bytes_compressed` = bytes stored, `bytes_uncompressed` = the file's size once regenerated, for stored and derived members) and
 * `study_files` is the manifest object. Reads one page of light sample rows and at most two member-list reads.
 */
export async function s1BundleIndexResponse(db: D1Database, gse: string, state: S1State): Promise<S1BundleIndexResponse> {
  const s = state.study;
  const ctx = await entryContext(db, gse);
  const rows = (await listS1Samples(db, gse, s.rev, { limit: 500 })).filter((r) => !ctx.excluded.has(r.gsm_id));
  const withFiles = rows.slice(0, S1_INDEX_FILE_SAMPLES);
  const filesBy = new Map<string, BundleFile[]>();
  for (let i = 0; i < withFiles.length; i += 50) {
    for (const full of await getS1Samples(db, gse, withFiles.slice(i, i + 50).map((r) => r.gsm_id), s.rev)) {
      filesBy.set(
        full.gsm_id,
        describeMembers(full)
          .filter((m) => !isUnofferedMember(m.name, ctx))
          .map((m) => ({ path: `samples/${full.gsm_id}/${m.name}`, bytes_compressed: m.bytes, bytes_uncompressed: m.legacy_bytes ?? m.bytes }))
      );
    }
  }
  const pipeline = parseJsonObject(s.pipeline_json);
  return {
    gse_id: gse,
    bytes: s.bytes ?? 0,
    etag: null,
    reference_build: s.reference_build,
    singlet_version: typeof pipeline?.singlet_version === "string" ? pipeline.singlet_version : null,
    created_at: s.created_at,
    indexed_at: s.updated_at,
    n_samples: Math.max(0, s.n_samples - ctx.excluded.size),
    samples: rows.map((r) => ({ gsm_id: r.gsm_id, files: filesBy.get(r.gsm_id) ?? [], total_bytes: r.bytes ?? 0 })),
    study_files: s.manifest_bytes ? [{ path: `s1/m/${gse}.json`, bytes_compressed: s.manifest_bytes, bytes_uncompressed: s.manifest_bytes }] : [],
    format: "singlet-s1",
    rev: s.rev,
    manifest_url: s1ManifestUrl(gse),
    files_truncated: rows.length > S1_INDEX_FILE_SAMPLES || s.n_samples > rows.length,
  };
}

// ── per-sample QC ───────────────────────────────────────────────────────────

export interface SampleQc {
  gsm_id: string;
  gse_id: string;
  protocol: string | null;
  reference_build: string | null;
  n_input_reads: number | null;
  uniquely_mapped_pct: number | null;
  n_cells_called: number | null;
  median_umi: number | null;
  median_genes: number | null;
  mapping_rate: number | null;
  exonic_fraction: number | null;
  intronic_fraction: number | null;
  sequencing_saturation: number | null;
  median_mito_fraction: number | null;
  fraction_reads_in_cells: number | null;
  total_genes_detected: number | null;
  singlet_version: string | null;
  git_sha?: string | null;
  wall_seconds?: number | null;
  /** Compressed exon+intron matrix bytes (from the bundle index). */
  matrix_bytes?: number | null;
  /** 1 = non-empty matrix and ≥ 1 called cell; 0 = no count data; null = not yet assessed. */
  usable?: number | null;
}

/** Read-side normalisation: 0 saturation / mito mean "not computed". */
export function normalizeQc<T extends Partial<SampleQc>>(r: T): T {
  return {
    ...r,
    sequencing_saturation: r.sequencing_saturation ? r.sequencing_saturation : null,
    median_mito_fraction: r.median_mito_fraction ? r.median_mito_fraction : null,
  };
}

/**
 * The per-sample QC a visitor is shown. `median_mito_fraction` was never computed by the Alpha pipeline (0 in every
 * summary.json), so it is not reported; `singlet_version` here is the aligner's self-report in summary.json, not the
 * release that packed the file, and the study's one pipeline version comes from the file's manifest (bundle_manifest).
 */
export function publicQc<T extends Partial<SampleQc>>(r: T): Omit<T, "median_mito_fraction" | "singlet_version" | "git_sha"> {
  const { median_mito_fraction: _m, singlet_version: _v, git_sha: _g, ...rest } = normalizeQc(r);
  return rest;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function shapeSummary(gse: string, gsm: string, s: Record<string, unknown>): SampleQc {
  return {
    gsm_id: gsm,
    gse_id: gse,
    protocol: str(s.protocol_name),
    reference_build: str(s.reference_build),
    n_input_reads: num(s.n_input_reads),
    uniquely_mapped_pct: num(s.uniquely_mapped_pct),
    n_cells_called: num(s.n_cells_called),
    median_umi: num(s.median_umi_per_cell) ?? num(s.median_umis_per_cell),
    median_genes: num(s.median_genes_per_cell),
    mapping_rate: num(s.mapping_rate),
    exonic_fraction: num(s.exonic_fraction),
    intronic_fraction: num(s.intronic_fraction),
    // Never computed by the pipeline so far: a literal 0 means "not computed".
    sequencing_saturation: num(s.sequencing_saturation) || null,
    median_mito_fraction: num(s.median_mito_fraction) || null,
    fraction_reads_in_cells: num(s.fraction_reads_in_cells),
    total_genes_detected: num(s.total_genes_detected),
    singlet_version: str(s.singlet_version),
    git_sha: str(s.git_sha),
    wall_seconds: num(s.wall_seconds),
  };
}

export const SAMPLE_QC_COLUMNS = [
  "gsm_id",
  "gse_id",
  "protocol",
  "reference_build",
  "n_input_reads",
  "uniquely_mapped_pct",
  "n_cells_called",
  "median_umi",
  "median_genes",
  "mapping_rate",
  "exonic_fraction",
  "intronic_fraction",
  "sequencing_saturation",
  "median_mito_fraction",
  "fraction_reads_in_cells",
  "total_genes_detected",
  "singlet_version",
] as const;

export function upsertSampleQcStatement(db: D1Database, row: Record<string, unknown>, stamp: string): D1PreparedStatement {
  const cols = [...SAMPLE_QC_COLUMNS, "updated_at"];
  const updates = cols.filter((c) => c !== "gsm_id").map((c) => `${c} = excluded.${c}`).join(", ");
  const values = SAMPLE_QC_COLUMNS.map((c) => {
    const v = (row as Record<string, unknown>)[c];
    return v === undefined ? null : (v as string | number | null);
  });
  return db
    .prepare(
      `INSERT INTO sample_qc (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
       ON CONFLICT(gsm_id) DO UPDATE SET ${updates}`
    )
    .bind(...values, stamp);
}

/**
 * Read every `samples/<GSM>/summary.json` in the bundle (bounded concurrency). A summary that cannot be read is
 * left out; a StaleBundleError is not swallowed, because it means the index no longer matches the file and
 * every other read is suspect too (callers refresh the index and retry, see withIndexRetry).
 */
export async function readSampleSummaries(gse: string, index: BundleIndex): Promise<SampleQc[]> {
  const targets = index.entries.filter((e) => /^samples\/GSM\d+\/summary\.json$/.test(e.p));
  const out: SampleQc[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const parts = await Promise.all(
      chunk.map(async (e) => {
        try {
          const text = await readEntryText(gse, e, index);
          return shapeSummary(gse, sampleOf(e.p)!, JSON.parse(text) as Record<string, unknown>);
        } catch (err) {
          if (err instanceof StaleBundleError) throw err;
          return null;
        }
      })
    );
    for (const p of parts) if (p) out.push(p);
  }
  return out.sort((a, b) => a.gsm_id.localeCompare(b.gsm_id));
}

/** D1-first per-sample QC; falls back to reading the bundle and persists the result. */
export async function loadSampleQc(
  db: D1Database,
  gse: string,
  opts: { refresh?: boolean; waitUntil?: (p: Promise<unknown>) => void } = {}
): Promise<{ source: "d1" | "bundle"; samples: SampleQc[] }> {
  await ensureSampleQcTable(db).catch(() => undefined);
  const excluded = await excludedInStudy(db, gse);
  const served = (list: SampleQc[]) => list.filter((q) => !excluded.has(q.gsm_id));
  if (!opts.refresh) {
    const rows = await db
      .prepare(`SELECT ${SAMPLE_QC_COLUMNS.join(", ")}, matrix_bytes, usable FROM sample_qc WHERE gse_id = ? AND ${sampleServedSql("sample_qc.gsm_id")} ORDER BY gsm_id`)
      .bind(gse)
      .all<SampleQc>()
      .catch(() =>
        db
          .prepare(`SELECT ${SAMPLE_QC_COLUMNS.join(", ")} FROM sample_qc WHERE gse_id = ? AND ${sampleServedSql("sample_qc.gsm_id")} ORDER BY gsm_id`)
          .bind(gse)
          .all<SampleQc>()
          .catch(() => null)
      );
    // A study whose samples are all excluded has rows, but none are served: answer from D1 (empty), not by re-reading the file.
    if (rows?.results?.length || excluded.size) return { source: "d1", samples: (rows?.results ?? []).map(normalizeQc) };
  }

  // A study served from s1 is read from its sample objects: the legacy file may be retired (deleted), and the objects hold the same summaries.
  const s1 = await getS1State(db, gse);
  if (s1) {
    const rev = s1.study.rev;
    const fromS1 = (await readS1Summaries(db, gse, rev)).map((r) => shapeSummary(gse, r.gsm_id, r.summary));
    const sizes = await s1MatrixBytes(db, gse, rev);
    for (const s of fromS1) {
      s.matrix_bytes = sizes.get(s.gsm_id) ?? 0;
      s.usable = isUsable(s.matrix_bytes, s.n_cells_called) ? 1 : 0;
    }
    if (fromS1.length) {
      const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const statements = fromS1.map((s) => upsertSampleQcStatement(db, s as unknown as Record<string, unknown>, stamp));
      const write = (async () => {
        for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
        await applyUsableS1(db, gse, rev);
      })().catch(() => undefined);
      if (opts.waitUntil) opts.waitUntil(write);
      else await write;
    }
    return { source: "bundle", samples: served(fromS1) };
  }

  const { index, samples } = await withIndexRetry(db, gse, { waitUntil: opts.waitUntil }, async (index) => ({
    index,
    samples: await readSampleSummaries(gse, index),
  }));
  const mb = matrixBytesByGsm(index);
  for (const s of samples) {
    s.matrix_bytes = mb.get(s.gsm_id) ?? 0;
    s.usable = isUsable(s.matrix_bytes, s.n_cells_called) ? 1 : 0;
  }
  if (samples.length) {
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const statements = samples.map((s) => upsertSampleQcStatement(db, s as unknown as Record<string, unknown>, stamp));
    const write = (async () => {
      for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
      await applyUsable(db, gse, index);
    })().catch(() => undefined);
    if (opts.waitUntil) opts.waitUntil(write);
    else await write;
  }
  return { source: "bundle", samples: served(samples) };
}
