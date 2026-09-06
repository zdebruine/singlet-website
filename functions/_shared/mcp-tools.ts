/**
 * The deterministic half of the MCP server: everything /mcp exposes beyond the
 * original four tools. No model calls happen in here — every number comes from
 * D1 or from the study's own `.singlet` file read over HTTP Range requests, so
 * an assistant can quote the output verbatim.
 */
import { GSE_RE, bundleUrl, loadStudy, type StudyDetail } from "./study-core";
import { getBundleIndex, ensureSampleQcTable, entryRange, MAX_INFLATE_BYTES, type ZipEntry } from "./bundle-reader";
import { bundleIndexResponse, loadSampleQc, SAMPLE_QC_COLUMNS, type SampleQc } from "./bundle-core";
import {
  buildManifestFromIds,
  buildManifestFromSearch,
  MANIFEST_FORMATS,
  MAX_MANIFEST_STUDIES,
  type ManifestFormat,
} from "./manifest-core";
import { normalizeFilters, parseSearchParams, type Ctx } from "./search-core";
import { loadRules, organismToCommon } from "./vocab";
import { safeList } from "./json";

export const SITE = "https://singlet.bio";
export const ACCOUNT_URL = `${SITE}/account`;
const GSM_RE = /^GSM\d+$/;

// ── result helpers ──────────────────────────────────────────────────────────

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export function toolResult(text: string, structured: unknown, meta?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured, ...(meta ? { _meta: meta } : {}) };
}

export function toolError(text: string, extra?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], isError: true, ...(extra ? { _meta: extra } : {}) };
}

export const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export const LOADERS = (gse: string) => ({
  python: `import singlet\nadata = singlet.load("${gse}")   # AnnData`,
  r: `library(singlet)\nsce <- load("${gse}")   # SingleCellExperiment`,
});

/** Summary fields are stored as either a fraction (0–1) or a percentage. */
function pct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v <= 1 ? Number((v * 100).toFixed(2)) : Number(v.toFixed(2));
}

function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Number(((v[mid - 1] + v[mid]) / 2).toFixed(2));
}

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function gseArg(args: Record<string, unknown>, key = "gse_id"): string | null {
  const v = typeof args[key] === "string" ? (args[key] as string).trim().toUpperCase() : "";
  return GSE_RE.test(v) ? v : null;
}

// ── 1. get_sample_qc ────────────────────────────────────────────────────────

const LOW_CELLS = 500;
const LOW_MAPPING_PCT = 60;

export interface SampleQcArgs {
  db: D1Database;
  waitUntil: (p: Promise<unknown>) => void;
}

export async function getSampleQc(ctx: SampleQcArgs, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseArg(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE200901.");
  const wanted = Array.isArray(args.gsm_ids)
    ? new Set((args.gsm_ids as unknown[]).map((v) => String(v).trim().toUpperCase()).filter((v) => GSM_RE.test(v)))
    : null;

  let source: "d1" | "bundle";
  let samples: SampleQc[];
  try {
    const r = await loadSampleQc(ctx.db, gse, { waitUntil: ctx.waitUntil });
    source = r.source;
    samples = r.samples;
  } catch (e) {
    return toolError(`Could not read per-sample QC for ${gse}: ${String(e).slice(0, 200)}. The .singlet file may not be built yet.`);
  }
  if (!samples.length) return toolError(`No per-sample QC recorded for ${gse}. Its .singlet file may not be built yet — check get_study.`);

  const rows = (wanted ? samples.filter((s) => wanted.has(s.gsm_id)) : samples).map((s) => ({
    ...s,
    uniquely_mapped_pct: pct(s.uniquely_mapped_pct),
    mapping_rate_pct: pct(s.mapping_rate),
    median_mito_pct: pct(s.median_mito_fraction),
    fraction_reads_in_cells_pct: pct(s.fraction_reads_in_cells),
    sequencing_saturation_pct: pct(s.sequencing_saturation),
  }));
  if (!rows.length) return toolError(`None of those GSM ids are in ${gse}'s file. Samples present: ${samples.map((s) => s.gsm_id).join(", ")}.`);

  const warnings: { gsm_id: string; issue: string }[] = [];
  for (const r of rows) {
    if (r.n_cells_called != null && r.n_cells_called < LOW_CELLS)
      warnings.push({ gsm_id: r.gsm_id, issue: `only ${fmt(r.n_cells_called)} cells called (< ${LOW_CELLS})` });
    const mapping = r.uniquely_mapped_pct ?? r.mapping_rate_pct;
    if (mapping != null && mapping < LOW_MAPPING_PCT)
      warnings.push({ gsm_id: r.gsm_id, issue: `${mapping.toFixed(1)}% uniquely mapped (< ${LOW_MAPPING_PCT}%)` });
  }

  const totals = {
    n_samples: rows.length,
    n_samples_in_file: samples.length,
    total_cells_called: rows.reduce((n, r) => n + (r.n_cells_called ?? 0), 0),
    total_input_reads: rows.reduce((n, r) => n + (r.n_input_reads ?? 0), 0),
    median_umi_across_samples: median(rows.map((r) => r.median_umi ?? NaN)),
    median_genes_across_samples: median(rows.map((r) => r.median_genes ?? NaN)),
    median_uniquely_mapped_pct: median(rows.map((r) => r.uniquely_mapped_pct ?? NaN)),
    median_mito_pct: median(rows.map((r) => r.median_mito_pct ?? NaN)),
    median_reads_in_cells_pct: median(rows.map((r) => r.fraction_reads_in_cells_pct ?? NaN)),
    protocols: uniq(rows.map((r) => r.protocol)),
    reference_builds: uniq(rows.map((r) => r.reference_build)),
    singlet_versions: uniq(rows.map((r) => r.singlet_version)),
  };

  const lines: string[] = [];
  lines.push(`${gse} — per-sample QC for ${rows.length} sample${rows.length === 1 ? "" : "s"} (read from the .singlet file itself).`);
  lines.push(
    `Totals: ${fmt(totals.total_cells_called)} cells called · median ${fmt(totals.median_umi_across_samples)} UMI and ${fmt(totals.median_genes_across_samples)} genes per cell · ${totals.median_uniquely_mapped_pct ?? "—"}% uniquely mapped${totals.reference_builds.length ? ` · reference ${totals.reference_builds.join(", ")}` : ""}${totals.protocols.length ? ` · ${totals.protocols.join(", ")}` : ""}.`
  );
  lines.push("");
  for (const r of rows) {
    lines.push(
      `- ${r.gsm_id}: ${fmt(r.n_cells_called)} cells · ${fmt(r.median_umi)} UMI · ${fmt(r.median_genes)} genes · ${r.uniquely_mapped_pct ?? "—"}% uniquely mapped · ${r.median_mito_pct ?? "—"}% mito · ${r.fraction_reads_in_cells_pct ?? "—"}% reads in cells · ${fmt(r.n_input_reads)} input reads`
    );
  }
  if (warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of warnings) lines.push(`- ${w.gsm_id}: ${w.issue}`);
  }

  return toolResult(lines.join("\n"), {
    gse_id: gse,
    source,
    samples: rows,
    totals,
    warnings,
    thresholds: { low_cells: LOW_CELLS, low_uniquely_mapped_pct: LOW_MAPPING_PCT },
    study_url: `${SITE}/study/${gse}`,
  });
}

// ── 2. list_bundle_files ────────────────────────────────────────────────────

export async function listBundleFiles(ctx: SampleQcArgs, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseArg(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE200901.");
  const gsm = typeof args.gsm_id === "string" ? args.gsm_id.trim().toUpperCase() : "";
  if (gsm && !GSM_RE.test(gsm)) return toolError("`gsm_id` must be a GEO sample accession like GSM4746717.");

  let index;
  try {
    index = await bundleIndexResponse(ctx.db, gse, await getBundleIndex(ctx.db, gse, { waitUntil: ctx.waitUntil }), ctx.waitUntil);
  } catch (e) {
    return toolError(`Could not read ${gse}.singlet: ${String(e).slice(0, 200)}. The file may not be built yet.`);
  }

  const samples = gsm ? index.samples.filter((s) => s.gsm_id === gsm) : index.samples;
  if (gsm && !samples.length)
    return toolError(`${gsm} is not in ${gse}.singlet. Samples in the file: ${index.samples.map((s) => s.gsm_id).join(", ")}.`);

  const lines: string[] = [];
  lines.push(
    `${gse}.singlet — ${fmtBytes(index.bytes)}, ${fmt(index.n_samples)} samples${index.reference_build ? `, reference ${index.reference_build}` : ""}${index.created_at ? `, packed ${index.created_at.slice(0, 10)}` : ""}.`
  );
  if (index.study_files.length) {
    lines.push("");
    lines.push("Study-level files:");
    for (const f of index.study_files) lines.push(`- ${f.path} (${fmtBytes(f.bytes_uncompressed)} uncompressed)`);
  }
  for (const s of samples) {
    lines.push("");
    lines.push(`${s.gsm_id} — ${fmtBytes(s.total_bytes)} in the file:`);
    for (const f of s.files) lines.push(`- ${f.path} (${fmtBytes(f.bytes_uncompressed)} uncompressed)`);
  }
  lines.push("");
  lines.push("Use get_partial_download to pull one of these files without downloading the whole study.");

  return toolResult(lines.join("\n"), {
    gse_id: gse,
    bytes: index.bytes,
    reference_build: index.reference_build,
    singlet_version: index.singlet_version,
    created_at: index.created_at,
    n_samples: index.n_samples,
    study_files: index.study_files,
    samples,
    download_url: bundleUrl(gse),
  });
}

// ── 3. get_partial_download ─────────────────────────────────────────────────

function pythonSnippet(url: string, start: number, end: number, method: string, outName: string): string {
  if (method === "stored") {
    return `import requests

url = "${url}"
r = requests.get(url, headers={"Range": "bytes=${start}-${end}"}, timeout=600)
r.raise_for_status()
open("${outName}", "wb").write(r.content)`;
  }
  return `import requests, zlib

url = "${url}"
r = requests.get(url, headers={"Range": "bytes=${start}-${end}"}, timeout=600)
r.raise_for_status()
data = zlib.decompressobj(-15).decompress(r.content)   # -15 = raw deflate, no zlib header
open("${outName}", "wb").write(data)`;
}

export async function getPartialDownload(ctx: SampleQcArgs, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseArg(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE296768.");
  const gsm = typeof args.gsm_id === "string" ? args.gsm_id.trim().toUpperCase() : "";
  if (!GSM_RE.test(gsm)) return toolError("`gsm_id` must be a GEO sample accession like GSM8976273.");
  const file = typeof args.file === "string" ? args.file.trim() : "";
  if (!file) return toolError("`file` is required — e.g. exon_counts.1pz. Use list_bundle_files to see what is in the study.");

  let index;
  try {
    index = await getBundleIndex(ctx.db, gse, { waitUntil: ctx.waitUntil });
  } catch (e) {
    return toolError(`Could not read ${gse}.singlet: ${String(e).slice(0, 200)}.`);
  }

  const prefix = `samples/${gsm}/`;
  const inSample = index.entries.filter((e: ZipEntry) => e.p.startsWith(prefix) && !e.p.endsWith("/"));
  if (!inSample.length) return toolError(`${gsm} is not in ${gse}.singlet. Use list_bundle_files to see which samples are.`);
  const entry =
    inSample.find((e) => e.p === file) ??
    inSample.find((e) => e.p === `${prefix}${file}`) ??
    inSample.find((e) => e.p.endsWith(`/${file}`)) ??
    null;
  if (!entry)
    return toolError(
      `No file '${file}' for ${gsm} in ${gse}.singlet. Files for this sample: ${inSample.map((e) => e.p.slice(prefix.length)).join(", ")}.`
    );

  const { url, start, end } = await entryRange(gse, entry);
  const method = entry.n === 8 ? "deflate-raw" : "stored";
  const outName = entry.p.split("/").pop() ?? file;
  const curl =
    method === "stored"
      ? `curl -r ${start}-${end} "${url}" -o ${outName}`
      : `curl -s -r ${start}-${end} "${url}" | python3 -c "import sys,zlib; sys.stdout.buffer.write(zlib.decompress(sys.stdin.buffer.read(), -15))" > ${outName}`;

  const structured = {
    gse_id: gse,
    gsm_id: gsm,
    path: entry.p,
    url,
    range: `bytes=${start}-${end}`,
    method,
    bytes_compressed: entry.c,
    bytes_uncompressed: entry.u,
    curl,
    python: pythonSnippet(url, start, end, method, outName),
    inflatable_at_edge: entry.u <= MAX_INFLATE_BYTES,
    edge_url: entry.u <= MAX_INFLATE_BYTES ? `${SITE}/api/bundle/${gse}/entry?path=${encodeURIComponent(entry.p)}` : null,
  };

  const text = [
    `${gse} / ${gsm} / ${entry.p}`,
    `Range request: ${fmtBytes(entry.c)} of the ${gse}.singlet file (${fmtBytes(entry.u)} once inflated) — you never download the rest of the study.`,
    `${url}`,
    `Range: bytes=${start}-${end} · compression: ${method}`,
    "",
    curl,
    "",
    structured.python,
  ].join("\n");

  return toolResult(text, structured);
}

// ── 4. export_manifest ──────────────────────────────────────────────────────

const MANIFEST_TEXT_CAP = 60_000;

export async function exportManifest(
  env: { DB: D1Database },
  waitUntil: (p: Promise<unknown>) => void,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const rawFormat = typeof args.format === "string" ? args.format.toLowerCase() : "tsv";
  if (!MANIFEST_FORMATS.includes(rawFormat as ManifestFormat))
    return toolError(`Unknown format '${rawFormat}'. Use ${MANIFEST_FORMATS.join(", ")}.`);
  const format = rawFormat as ManifestFormat;

  const ids = Array.isArray(args.gse_ids)
    ? (args.gse_ids as unknown[]).map((v) => String(v).trim().toUpperCase()).filter((v) => GSE_RE.test(v))
    : [];

  let m;
  let applied: unknown = null;
  if (ids.length) {
    m = await buildManifestFromIds(env.DB, ids, format);
    applied = { gse_ids: ids };
  } else {
    const url = new URL(`${SITE}/api/manifest`);
    if (typeof args.query === "string" && args.query.trim()) url.searchParams.set("q", args.query.trim().slice(0, 500));
    const f = (args.filters && typeof args.filters === "object" ? args.filters : {}) as Record<string, unknown>;
    const push = (param: string, value: unknown) => {
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(param, String(v));
      else if (typeof value === "string" && value.trim()) url.searchParams.append(param, value.trim());
    };
    push("organism", f.organism);
    push("tissue_group", f.tissue ?? f.tissue_group);
    push("disease_group", f.disease ?? f.disease_group);
    push("assay_family", f.assay ?? f.assay_family);
    push("cell_type", f.cell_type);
    if (f.min_cells != null && Number.isFinite(Number(f.min_cells))) url.searchParams.set("min_cells", String(Math.floor(Number(f.min_cells))));
    if (f.year_min != null && Number.isFinite(Number(f.year_min))) url.searchParams.set("year_min", String(Math.floor(Number(f.year_min))));
    if (f.year_max != null && Number.isFinite(Number(f.year_max))) url.searchParams.set("year_max", String(Math.floor(Number(f.year_max))));

    const rules = await loadRules(env.DB, waitUntil);
    const { filters } = normalizeFilters(parseSearchParams(url), rules);
    const ctx: Ctx = { db: env.DB, rules, waitUntil };
    m = await buildManifestFromSearch(ctx, filters, format);
    applied = filters;
  }

  if (!m.returned)
    return toolError("No studies matched, so the manifest would be empty. Loosen the filters or check the accessions.");

  const truncated = m.body.length > MANIFEST_TEXT_CAP;
  const text = [
    `Manifest (${format}) — ${fmt(m.returned)} studies of ${fmt(m.total)} matching, ${fmtBytes(m.total_bytes)} of .singlet files in total. All CC0.`,
    m.total > MAX_MANIFEST_STUDIES ? `Capped at ${fmt(MAX_MANIFEST_STUDIES)} studies.` : null,
    "",
    truncated ? m.body.slice(0, MANIFEST_TEXT_CAP) + "\n… truncated; the full manifest is in structuredContent.manifest." : m.body,
  ]
    .filter((v) => v !== null)
    .join("\n");

  return toolResult(text, {
    format,
    count: m.returned,
    total_matching: m.total,
    total_bytes: m.total_bytes,
    limit: MAX_MANIFEST_STUDIES,
    filename: m.filename,
    content_type: m.content_type,
    applied,
    license: "CC0",
    studies: m.rows.map((r) => r.gse_id),
    manifest: m.body,
  });
}

// ── 5. find_matched_controls ────────────────────────────────────────────────

const HEALTHY_GROUPS = new Set(["Healthy / control"]);
const NEUTRAL_GROUPS = new Set(["Healthy / control", "Other / unspecified"]);

interface CandidateRow {
  gse_id: string;
  title: string | null;
  organism_primary: string | null;
  tissue_groups: string;
  disease_groups: string;
  assay_families: string;
  n_done: number | null;
  n_cells: number | null;
  year: number | null;
  n_in_file: number | null;
  reference_build: string | null;
  bytes: number | null;
}

export async function findMatchedControls(ctx: SampleQcArgs, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseArg(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE200901.");
  const minSamples = Math.max(1, Math.floor(Number(args.min_samples) || 1));
  const sameAssay = args.same_assay === true;

  const ref = await ctx.db
    .prepare(
      `SELECT m.gse_id, m.organism_primary, m.tissue_groups, m.disease_groups, m.assay_families, m.year,
              b.reference_build
         FROM gse_meta m LEFT JOIN bundle_manifest b ON b.gse_id = m.gse_id
        WHERE m.gse_id = ?`
    )
    .bind(gse)
    .first<Record<string, unknown>>()
    .catch(() => null);
  if (!ref) return toolError(`${gse} is not in the atlas, so there is nothing to match it against.`);

  const organism = (ref.organism_primary as string | null) ?? null;
  const tissues = safeList(ref.tissue_groups);
  const assays = safeList(ref.assay_families);
  const refBuild = (ref.reference_build as string | null) ?? null;
  if (!organism || !tissues.length)
    return toolError(`${gse} has no organism or tissue group recorded, so a matched control cannot be chosen deterministically.`);

  const tissue = tissues[0];
  const rows = await ctx.db
    .prepare(
      `SELECT m.gse_id, g.title, m.organism_primary, m.tissue_groups, m.disease_groups, m.assay_families,
              m.n_done, m.n_cells, m.year,
              COALESCE(b.n_gsms_in_bundle, g.r2_bundle_n_gsms) AS n_in_file,
              b.reference_build, COALESCE(b.bytes, g.r2_bundle_bytes) AS bytes
         FROM gse_meta m
         JOIN gse g ON g.id = m.gse_id
         LEFT JOIN bundle_manifest b ON b.gse_id = m.gse_id
        WHERE m.gse_id != ?
          AND m.organism_primary = ?
          AND m.has_bundle = 1
          AND m.tissue_groups LIKE ?
        ORDER BY m.n_done DESC
        LIMIT 400`
    )
    .bind(gse, organism, `%"${tissue}"%`)
    .all<CandidateRow>();

  const candidates = rows.results
    .map((r) => {
      const diseases = safeList(r.disease_groups);
      const rowAssays = safeList(r.assay_families);
      const nInFile = r.n_in_file != null ? Number(r.n_in_file) : r.n_done != null ? Number(r.n_done) : null;
      return { r, diseases, rowAssays, nInFile };
    })
    .filter(({ diseases }) => diseases.length === 0 || diseases.every((d) => NEUTRAL_GROUPS.has(d)))
    .filter(({ diseases }) => diseases.length === 0 || diseases.some((d) => HEALTHY_GROUPS.has(d)) || diseases.every((d) => NEUTRAL_GROUPS.has(d)))
    .filter(({ nInFile }) => (nInFile ?? 0) >= minSamples)
    .filter(({ rowAssays }) => !sameAssay || rowAssays.some((a) => assays.includes(a)))
    .map((c) => {
      const assayMatch = c.rowAssays.some((a) => assays.includes(a));
      const buildMatch = !!refBuild && c.r.reference_build === refBuild;
      return { ...c, assayMatch, buildMatch, score: (assayMatch ? 2 : 0) + (buildMatch ? 1 : 0) };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.nInFile ?? 0) - (a.nInFile ?? 0) ||
        (Number(b.r.year ?? 0) - Number(a.r.year ?? 0)) ||
        a.r.gse_id.localeCompare(b.r.gse_id)
    )
    .slice(0, 10)
    .map((c) => {
      const healthy = c.diseases.some((d) => HEALTHY_GROUPS.has(d));
      const why = [
        `same organism (${organismToCommon(organism)})`,
        `tissue ${tissue}`,
        c.assayMatch ? `assay ${c.rowAssays.filter((a) => assays.includes(a)).join("/")}` : `assay ${c.rowAssays.join("/") || "unknown"} (differs)`,
        c.buildMatch ? `same reference ${refBuild}` : c.r.reference_build ? `reference ${c.r.reference_build}` : null,
        `${fmt(c.nInFile)} samples in file`,
        healthy ? "healthy / control" : c.diseases.length ? c.diseases.join("/") : "no disease label",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        gse_id: c.r.gse_id,
        title: c.r.title,
        organism: organismToCommon(c.r.organism_primary ?? null),
        tissue_groups: safeList(c.r.tissue_groups),
        disease_groups: c.diseases,
        assay_families: c.rowAssays,
        n_samples_in_file: c.nInFile,
        n_samples_catalog: c.r.n_done != null ? Number(c.r.n_done) : null,
        n_cells: c.r.n_cells != null ? Number(c.r.n_cells) : null,
        year: c.r.year != null ? Number(c.r.year) : null,
        reference_build: c.r.reference_build,
        same_assay: c.assayMatch,
        same_reference_build: c.buildMatch,
        bytes: c.r.bytes != null ? Number(c.r.bytes) : null,
        download_url: bundleUrl(c.r.gse_id),
        study_url: `${SITE}/study/${c.r.gse_id}`,
        why,
        loader: `singlet.load("${c.r.gse_id}")`,
      };
    });

  const caveats = [
    "The disease label is study-level: a study labelled healthy can still contain treated samples — check per-sample characteristics with get_study.",
    "Assay families marked \"10x (version unconfirmed)\" come from GEO text, not from the reads.",
    refBuild
      ? `Studies on a different reference build than ${refBuild} need gene ids re-matched before merging.`
      : "The query study has no reference build recorded, so builds could not be matched.",
    "Batch effects between studies are usually larger than the biology; treat these as candidates, not as drop-in controls.",
  ];

  if (!candidates.length)
    return toolResult(
      `No control candidates for ${gse}: no other ${organismToCommon(organism)} ${tissue} study with a built file${sameAssay ? " on the same assay" : ""} has at least ${minSamples} samples and no disease label.`,
      { gse_id: gse, organism: organismToCommon(organism), tissue, candidates: [], caveats }
    );

  const lines = [
    `${candidates.length} candidate control stud${candidates.length === 1 ? "y" : "ies"} for ${gse} (${organismToCommon(organism)}, ${tissue}${sameAssay ? `, assay ${assays.join("/")}` : ""}).`,
    "",
  ];
  for (const c of candidates) {
    lines.push(`- ${c.gse_id} — ${c.title ?? "(untitled)"}`);
    lines.push(`  why: ${c.why}`);
    lines.push(`  load: ${c.loader} · ${fmtBytes(c.bytes)} · ${c.study_url}`);
  }
  lines.push("");
  lines.push("Caveats:");
  for (const c of caveats) lines.push(`- ${c}`);

  return toolResult(lines.join("\n"), {
    gse_id: gse,
    organism: organismToCommon(organism),
    tissue,
    assays,
    reference_build: refBuild,
    min_samples: minSamples,
    same_assay: sameAssay,
    candidates,
    caveats,
  });
}

// ── 6. compare_studies ──────────────────────────────────────────────────────

async function sampleQcFromD1(db: D1Database, gse: string): Promise<SampleQc[]> {
  await ensureSampleQcTable(db).catch(() => undefined);
  const rows = await db
    .prepare(`SELECT ${SAMPLE_QC_COLUMNS.join(", ")} FROM sample_qc WHERE gse_id = ? ORDER BY gsm_id`)
    .bind(gse)
    .all<SampleQc>()
    .catch(() => null);
  return rows?.results ?? [];
}

interface ComparisonRow {
  gse_id: string;
  title: string | null;
  organism: string;
  tissue_groups: string[];
  disease_groups: string[];
  assay_families: string[];
  conditions: string | null;
  n_samples_in_file: number | null;
  n_samples_catalog: number;
  n_samples_geo: number;
  cells_file_qc: number | null;
  cells_catalog: number;
  reference_build: string | null;
  singlet_version: string | null;
  year: number | null;
  pubmed_ids: string[];
  bytes: number | null;
  median_umi: number | null;
  median_genes: number | null;
  median_uniquely_mapped_pct: number | null;
  qc_source: "file" | "none";
  study_url: string;
}

function comparisonRow(d: StudyDetail, qc: SampleQc[]): ComparisonRow {
  return {
    gse_id: d.series.id,
    title: d.series.title,
    organism: d.series.organism_label,
    tissue_groups: d.meta?.tissue_groups ?? [],
    disease_groups: d.meta?.disease_groups ?? [],
    assay_families: d.meta?.assay_families ?? [],
    conditions: d.conditions_label || null,
    n_samples_in_file: d.series.bundle_n_samples,
    n_samples_catalog: d.series.n_gsm_done,
    n_samples_geo: d.series.n_gsm_total,
    cells_file_qc: qc.length ? qc.reduce((n, s) => n + (s.n_cells_called ?? 0), 0) : null,
    cells_catalog: d.series.n_cells,
    reference_build: d.series.reference_build ?? uniq(qc.map((s) => s.reference_build))[0] ?? null,
    singlet_version: d.series.singlet_version ?? uniq(qc.map((s) => s.singlet_version))[0] ?? null,
    year: d.meta?.year ?? null,
    pubmed_ids: d.series.pubmed_ids,
    bytes: d.series.bundle_bytes,
    median_umi: median(qc.map((s) => s.median_umi ?? NaN)),
    median_genes: median(qc.map((s) => s.median_genes ?? NaN)),
    median_uniquely_mapped_pct: median(qc.map((s) => pct(s.uniquely_mapped_pct) ?? NaN)),
    qc_source: qc.length ? "file" : "none",
    study_url: `${SITE}/study/${d.series.id}`,
  };
}

const COMPARE_FIELDS = [
  "organism",
  "tissue_groups",
  "disease_groups",
  "assay_families",
  "reference_build",
  "singlet_version",
  "year",
] as const;

export async function compareStudies(ctx: SampleQcArgs, args: Record<string, unknown>): Promise<ToolResult> {
  const ids = Array.isArray(args.gse_ids)
    ? [...new Set((args.gse_ids as unknown[]).map((v) => String(v).trim().toUpperCase()))].filter((v) => GSE_RE.test(v))
    : [];
  if (ids.length < 2 || ids.length > 8) return toolError("`gse_ids` must be 2 to 8 GEO series accessions, e.g. [\"GSE296768\", \"GSE200901\"].");

  const studies: ComparisonRow[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const d = await loadStudy(ctx.db, id);
    if (!d) {
      missing.push(id);
      continue;
    }
    studies.push(comparisonRow(d, await sampleQcFromD1(ctx.db, id)));
  }
  if (studies.length < 2)
    return toolError(`Only ${studies.length} of those accessions are in the atlas${missing.length ? ` (missing: ${missing.join(", ")})` : ""}, so there is nothing to compare.`);

  const differences: { field: string; values: Record<string, unknown> }[] = [];
  for (const field of COMPARE_FIELDS) {
    const values = studies.map((s) => JSON.stringify((s as unknown as Record<string, unknown>)[field] ?? null));
    if (new Set(values).size > 1)
      differences.push({
        field,
        values: Object.fromEntries(studies.map((s) => [s.gse_id, (s as unknown as Record<string, unknown>)[field] ?? null])),
      });
  }

  const lines: string[] = [];
  lines.push(`Comparing ${studies.length} studies.`);
  for (const s of studies) {
    lines.push("");
    lines.push(`${s.gse_id} — ${s.title ?? "(untitled)"}`);
    lines.push(`  ${[s.organism, s.tissue_groups.join("/"), s.disease_groups.join("/"), s.assay_families.join("/"), s.year].filter(Boolean).join(" · ")}`);
    lines.push(`  samples: ${fmt(s.n_samples_in_file)} in the file · ${fmt(s.n_samples_catalog)} processed · ${fmt(s.n_samples_geo)} on GEO`);
    lines.push(`  cells: ${s.cells_file_qc != null ? fmt(s.cells_file_qc) + " from file QC" : "file QC not recorded"} · ${fmt(s.cells_catalog)} in the catalog`);
    lines.push(`  QC medians: ${fmt(s.median_umi)} UMI · ${fmt(s.median_genes)} genes · ${s.median_uniquely_mapped_pct ?? "—"}% uniquely mapped`);
    lines.push(`  reference: ${s.reference_build ?? "not recorded"} · pipeline ${s.singlet_version ?? "not recorded"} · file ${fmtBytes(s.bytes)}`);
    if (s.conditions) lines.push(`  conditions: ${s.conditions}`);
    if (s.pubmed_ids.length) lines.push(`  PubMed: ${s.pubmed_ids.join(", ")}`);
  }
  if (differences.length) {
    lines.push("");
    lines.push("They disagree on:");
    for (const d of differences)
      lines.push(`- ${d.field}: ${Object.entries(d.values).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join("/") || "none" : v ?? "not recorded"}`).join(" · ")}`);
  } else {
    lines.push("");
    lines.push("No differences on organism, tissue, disease, assay, reference build, pipeline version or year.");
  }
  lines.push("");
  lines.push("Where catalog and file counts differ, the file is the truth: the catalog counts every processed sample, the file holds what was packed.");

  return toolResult(lines.join("\n"), {
    studies,
    differences,
    missing,
    note: "Catalog cell counts come from the pipeline database; file QC sums each sample's summary.json inside the .singlet file.",
  });
}

// ── 7. assess_study ─────────────────────────────────────────────────────────

const PURPOSE_CHECKS: { keys: string[]; id: string; label: string }[] = [
  { keys: ["velocity", "spliced", "unspliced"], id: "velocity", label: "RNA velocity" },
  { keys: ["aging", "ageing", " age", "age-"], id: "aging", label: "age as a variable" },
  { keys: ["control", "healthy", "baseline"], id: "control", label: "healthy controls" },
  { keys: ["sex", "male", "female"], id: "sex", label: "sex as a variable" },
  { keys: ["cell type", "celltype", "annotation", "atlas"], id: "cell_type", label: "cell-type labels" },
  { keys: ["disease", "patient", "tumor", "tumour"], id: "disease", label: "disease samples" },
  { keys: ["batch", "integration", "merge"], id: "batch", label: "cross-sample integration" },
];

export async function assessStudy(ctx: SampleQcArgs, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseArg(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE200901.");
  const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";

  const d = await loadStudy(ctx.db, gse);
  if (!d) return toolError(`${gse} is not in the atlas. Try search_datasets.`);

  let qc: SampleQc[] = await sampleQcFromD1(ctx.db, gse);
  let index: Awaited<ReturnType<typeof bundleIndexResponse>> | null = null;
  try {
    const raw = await getBundleIndex(ctx.db, gse, { waitUntil: ctx.waitUntil });
    index = await bundleIndexResponse(ctx.db, gse, raw, ctx.waitUntil);
    if (!qc.length) qc = (await loadSampleQc(ctx.db, gse, { waitUntil: ctx.waitUntil })).samples;
  } catch {
    index = null;
  }

  // Metadata coverage across samples.
  const keys = new Map<string, number>();
  for (const s of d.samples) for (const k of Object.keys(s.characteristics ?? {})) keys.set(k, (keys.get(k) ?? 0) + 1);
  const has = (re: RegExp) => [...keys.keys()].some((k) => re.test(k));
  const hasSexColumn = d.samples.some((s) => !!s.sex) || has(/sex|gender/i);
  const hasAge = has(/\bage\b|age_|aging|months?|weeks?|old/i);
  const hasDonor = d.samples.some((s) => !!s.donor_id) || has(/donor|subject|patient|individual/i);
  const hasCellType = d.samples.some((s) => !!s.cell_type) || has(/cell.?type/i);

  const missing_metadata: string[] = [];
  if (!hasAge) missing_metadata.push("no age recorded on the samples");
  if (!hasSexColumn) missing_metadata.push("no sex recorded on the samples");
  if (!hasDonor) missing_metadata.push("no donor / subject id, so repeated measures cannot be identified");
  if (!hasCellType) missing_metadata.push("no author cell-type labels (the file ships counts, not annotations)");
  if (!d.series.pubmed_ids.length) missing_metadata.push("no linked PubMed id");
  if (!d.conditions.length) missing_metadata.push("no experimental conditions could be parsed from GEO characteristics");

  const cellsFile = qc.length ? qc.reduce((n, s) => n + (s.n_cells_called ?? 0), 0) : null;
  const lowCells = qc.filter((s) => s.n_cells_called != null && s.n_cells_called < LOW_CELLS).map((s) => s.gsm_id);
  const lowMapping = qc
    .filter((s) => {
      const m = pct(s.uniquely_mapped_pct) ?? pct(s.mapping_rate);
      return m != null && m < LOW_MAPPING_PCT;
    })
    .map((s) => s.gsm_id);

  const reads = qc.map((s) => s.n_input_reads).filter((n): n is number => n != null);
  const readCap =
    reads.length > 1 && new Set(reads).size === 1
      ? `Every sample has exactly ${fmt(reads[0])} input reads — the pipeline caps reads per sample, so absolute read counts are not comparable to the raw FASTQs.`
      : reads.length
        ? `Input reads range from ${fmt(Math.min(...reads))} to ${fmt(Math.max(...reads))} per sample.`
        : "Input read counts are not recorded for this study.";

  const paths = index ? [...index.study_files.map((f) => f.path), ...index.samples.flatMap((s) => s.files.map((f) => f.path))] : [];
  const hasSpliced = paths.some((p) => /spliced|velocy|intron_counts/i.test(p));
  const healthySamples = d.samples.filter((s) => /healthy|control|normal|wild.?type|wt\b/i.test(JSON.stringify(s.characteristics ?? {}) + " " + (s.disease ?? ""))).length;

  const fit: { check: string; ok: boolean; detail: string }[] = [];
  if (purpose) {
    const p = purpose.toLowerCase();
    for (const c of PURPOSE_CHECKS) {
      if (!c.keys.some((k) => p.includes(k))) continue;
      switch (c.id) {
        case "velocity":
          fit.push({
            check: "spliced / unspliced layers",
            ok: hasSpliced,
            detail: hasSpliced
              ? `The file contains intron-aware counts (${paths.filter((x) => /spliced|intron_counts|velocy/i.test(x)).slice(0, 3).join(", ")}), so velocity is possible.`
              : "The file ships exon counts only — RNA velocity would need reprocessing from the reads.",
          });
          break;
        case "aging":
          fit.push({ check: "age recorded", ok: hasAge, detail: hasAge ? `Age-like characteristics: ${[...keys.keys()].filter((k) => /age|month|week|old/i.test(k)).join(", ")}.` : "No age-like characteristic on any sample." });
          break;
        case "control":
          fit.push({ check: "healthy samples", ok: healthySamples > 0, detail: `${healthySamples} of ${d.samples.length} samples mention healthy / control / wild-type wording.` });
          break;
        case "sex":
          fit.push({ check: "sex recorded", ok: hasSexColumn, detail: hasSexColumn ? "Sex is recorded on the samples." : "Sex is not recorded on the samples." });
          break;
        case "cell_type":
          fit.push({ check: "cell-type labels", ok: hasCellType, detail: hasCellType ? "Author cell-type labels are recorded in the catalog." : "No author annotations — you would cluster and annotate yourself." });
          break;
        case "disease":
          fit.push({ check: "disease groups", ok: (d.meta?.disease_groups ?? []).length > 0, detail: (d.meta?.disease_groups ?? []).join(", ") || "No disease group recorded." });
          break;
        case "batch":
          fit.push({
            check: "one reference build",
            ok: uniq(qc.map((s) => s.reference_build)).length <= 1,
            detail: `Reference build(s) in the file: ${uniq(qc.map((s) => s.reference_build)).join(", ") || d.series.reference_build || "not recorded"}.`,
          });
          break;
      }
    }
    if (!fit.length) fit.push({ check: "purpose", ok: true, detail: `No specific check is defined for "${purpose}"; the report above is the general one.` });
  }

  const conditionLines = d.conditions.slice(0, 8).map((c) => {
    const rec = c as unknown as Record<string, unknown>;
    const key = String(rec.key ?? rec.label ?? "condition");
    const values = Array.isArray(rec.values) ? (rec.values as unknown[]) : [];
    return `${key}: ${values
      .map((v) => {
        const vv = v as Record<string, unknown>;
        return `${vv.value ?? vv.label ?? String(v)}${vv.n_samples != null ? ` (${vv.n_samples})` : ""}`;
      })
      .join(", ")}`;
  });

  const structured = {
    gse_id: gse,
    title: d.series.title,
    purpose: purpose || null,
    file: {
      available: !!d.series.bundle_url,
      url: d.series.bundle_url,
      bytes: d.series.bundle_bytes,
      n_samples_in_file: index?.n_samples ?? d.series.bundle_n_samples,
      reference_build: index?.reference_build ?? d.series.reference_build,
      singlet_version: index?.singlet_version ?? d.series.singlet_version,
      per_sample_files: index?.samples[0]?.files.map((f) => f.path.split("/").pop()) ?? [],
      study_files: index?.study_files.map((f) => f.path) ?? [],
    },
    samples: {
      in_file: index?.n_samples ?? d.series.bundle_n_samples,
      processed: d.series.n_gsm_done,
      on_geo: d.series.n_gsm_total,
      failed: d.series.n_gsm_failed,
    },
    conditions: d.conditions,
    conditions_label: d.conditions_label,
    qc: {
      source: qc.length ? "file" : "none",
      n_samples: qc.length,
      total_cells_called: cellsFile,
      catalog_cells: d.series.n_cells,
      median_umi: median(qc.map((s) => s.median_umi ?? NaN)),
      median_genes: median(qc.map((s) => s.median_genes ?? NaN)),
      median_uniquely_mapped_pct: median(qc.map((s) => pct(s.uniquely_mapped_pct) ?? NaN)),
      low_cell_samples: lowCells,
      low_mapping_samples: lowMapping,
      read_cap_note: readCap,
    },
    missing_metadata,
    fit,
    year: d.meta?.year ?? null,
    pubmed_ids: d.series.pubmed_ids,
    study_url: `${SITE}/study/${gse}`,
    ...LOADERS(gse),
  };

  const lines: string[] = [];
  lines.push(`${gse} — ${d.series.title ?? "(untitled)"}`);
  lines.push(
    `${[d.series.organism_label, d.meta?.tissue_groups.join("/"), d.meta?.disease_groups.join("/"), d.meta?.assay_families.join("/"), d.meta?.year].filter(Boolean).join(" · ")}`
  );
  lines.push(
    `File: ${d.series.bundle_url ? `${fmtBytes(d.series.bundle_bytes)}, ${fmt(structured.file.n_samples_in_file)} samples${structured.file.reference_build ? `, reference ${structured.file.reference_build}` : ""}` : "not built yet"}.`
  );
  if (structured.file.per_sample_files.length) lines.push(`Per sample: ${structured.file.per_sample_files.join(", ")}.`);
  lines.push(`Samples: ${fmt(d.series.n_gsm_done)} processed of ${fmt(d.series.n_gsm_total)} on GEO${d.series.n_gsm_failed ? `, ${fmt(d.series.n_gsm_failed)} failed` : ""}.`);
  if (conditionLines.length) {
    lines.push("Conditions:");
    for (const c of conditionLines) lines.push(`- ${c}`);
  }
  lines.push(
    `QC: ${cellsFile != null ? `${fmt(cellsFile)} cells called across ${qc.length} samples` : "per-sample QC not recorded"} · median ${fmt(structured.qc.median_umi)} UMI, ${fmt(structured.qc.median_genes)} genes · ${structured.qc.median_uniquely_mapped_pct ?? "—"}% uniquely mapped.`
  );
  if (lowCells.length) lines.push(`Low-cell samples (< ${LOW_CELLS}): ${lowCells.join(", ")}.`);
  if (lowMapping.length) lines.push(`Low-mapping samples (< ${LOW_MAPPING_PCT}%): ${lowMapping.join(", ")}.`);
  lines.push(readCap);
  if (cellsFile != null && cellsFile !== d.series.n_cells)
    lines.push(`Catalog says ${fmt(d.series.n_cells)} cells, the file's own QC says ${fmt(cellsFile)}. The file is the truth.`);
  if (missing_metadata.length) {
    lines.push("Missing metadata:");
    for (const m of missing_metadata) lines.push(`- ${m}`);
  }
  if (fit.length) {
    lines.push(`Fit for "${purpose}":`);
    for (const f of fit) lines.push(`- ${f.ok ? "yes" : "no"} — ${f.check}: ${f.detail}`);
  }

  return toolResult(lines.join("\n"), structured);
}
