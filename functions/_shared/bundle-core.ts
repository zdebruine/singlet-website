/**
 * Shapes served by /api/bundle/* — the study's own `.singlet` file read over
 * HTTP Range requests, plus the D1 mirror of the per-sample QC summaries.
 */
import {
  getBundleIndex,
  readEntryText,
  ensureSampleQcTable,
  sampleOf,
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
  for (const e of index.entries) {
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
    reference_build: manifest?.reference_build ?? null,
    singlet_version: manifest?.singlet_version ?? null,
    created_at: manifest?.manifest_created_at ?? null,
    indexed_at: index.indexed_at,
    n_samples: samples.length,
    samples,
    study_files: studyFiles.sort((a, b) => a.path.localeCompare(b.path)),
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
    sequencing_saturation: num(s.sequencing_saturation),
    median_mito_fraction: num(s.median_mito_fraction),
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

/** Read every `samples/<GSM>/summary.json` in the bundle (bounded concurrency). */
export async function readSampleSummaries(gse: string, index: BundleIndex): Promise<SampleQc[]> {
  const targets = index.entries.filter((e) => /^samples\/GSM\d+\/summary\.json$/.test(e.p));
  const out: SampleQc[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const parts = await Promise.all(
      chunk.map(async (e) => {
        try {
          const text = await readEntryText(gse, e);
          return shapeSummary(gse, sampleOf(e.p)!, JSON.parse(text) as Record<string, unknown>);
        } catch {
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
  if (!opts.refresh) {
    const rows = await db
      .prepare(`SELECT ${SAMPLE_QC_COLUMNS.join(", ")} FROM sample_qc WHERE gse_id = ? ORDER BY gsm_id`)
      .bind(gse)
      .all<SampleQc>()
      .catch(() => null);
    if (rows?.results?.length) return { source: "d1", samples: rows.results };
  }

  const index = await getBundleIndex(db, gse, { waitUntil: opts.waitUntil });
  const samples = await readSampleSummaries(gse, index);
  if (samples.length) {
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const statements = samples.map((s) => upsertSampleQcStatement(db, s as unknown as Record<string, unknown>, stamp));
    const write = (async () => {
      for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
    })().catch(() => undefined);
    if (opts.waitUntil) opts.waitUntil(write);
    else await write;
  }
  return { source: "bundle", samples };
}
