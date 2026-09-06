/**
 * The download manifest: take a set of studies (from a search or an explicit
 * list of accessions) and render it as TSV / JSON / a curl or wget script /
 * a Python or R snippet.
 *
 * Shared by GET /api/manifest and the MCP tool `export_manifest`.
 */
import { safeList } from "./json";
import { bundleUrl } from "./study-core";
import { organismToCommon } from "./vocab";
import { exportStudyAccessions, type Ctx, type SearchFilters } from "./search-core";

export const MAX_MANIFEST_STUDIES = 2000;
export const MANIFEST_FORMATS = ["tsv", "json", "curl", "wget", "python", "r"] as const;
export type ManifestFormat = (typeof MANIFEST_FORMATS)[number];

/** D1 allows at most 100 bound parameters per statement. */
const ID_CHUNK = 90;

export interface ManifestRow {
  gse_id: string;
  title: string | null;
  organism: string;
  tissue_groups: string[];
  disease_groups: string[];
  assay_families: string[];
  n_samples_in_file: number | null;
  n_cells: number;
  year: number | null;
  pubmed_ids: string[];
  reference_build: string | null;
  bytes: number | null;
  download_url: string;
  license: "CC0";
}

export async function manifestRows(db: D1Database, ids: string[]): Promise<ManifestRow[]> {
  const out: ManifestRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const inList = chunk.map(() => "?").join(", ");
    const res = await db
      .prepare(
        `SELECT g.id AS gse_id, g.title, g.pubmed_ids, g.n_cells AS g_cells, g.r2_bundle_bytes, g.r2_bundle_n_gsms,
                m.organism_primary, m.tissue_groups, m.disease_groups, m.assay_families, m.n_cells AS m_cells, m.year,
                b.reference_build, b.n_gsms_in_bundle, b.bytes AS b_bytes
           FROM gse g
           LEFT JOIN gse_meta m ON m.gse_id = g.id
           LEFT JOIN bundle_manifest b ON b.gse_id = g.id
          WHERE g.id IN (${inList})`
      )
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const r of res.results) {
      const nInFile =
        r.n_gsms_in_bundle != null ? Number(r.n_gsms_in_bundle) : r.r2_bundle_n_gsms != null ? Number(r.r2_bundle_n_gsms) : null;
      out.push({
        gse_id: String(r.gse_id),
        title: (r.title as string | null) ?? null,
        organism: organismToCommon((r.organism_primary as string | null) ?? null),
        tissue_groups: safeList(r.tissue_groups),
        disease_groups: safeList(r.disease_groups),
        assay_families: safeList(r.assay_families),
        n_samples_in_file: nInFile,
        n_cells: Number(r.m_cells ?? r.g_cells ?? 0),
        year: r.year != null ? Number(r.year) : null,
        pubmed_ids: safeList(r.pubmed_ids),
        reference_build: (r.reference_build as string | null) ?? null,
        bytes: r.b_bytes != null ? Number(r.b_bytes) : r.r2_bundle_bytes != null ? Number(r.r2_bundle_bytes) : null,
        download_url: bundleUrl(String(r.gse_id)),
        license: "CC0",
      });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.gse_id) ?? 0) - (order.get(b.gse_id) ?? 0));
}

const TSV_COLUMNS = [
  "gse_id",
  "title",
  "organism",
  "tissue_groups",
  "disease_groups",
  "assay_families",
  "n_samples_in_file",
  "n_cells",
  "year",
  "pubmed_ids",
  "reference_build",
  "bytes",
  "download_url",
  "license",
] as const;

function tsvCell(v: unknown): string {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("; ") : String(v);
  return s.replace(/[\t\r\n]+/g, " ").trim();
}

function renderTsv(rows: ManifestRow[]): string {
  const lines = [TSV_COLUMNS.join("\t")];
  for (const r of rows) lines.push(TSV_COLUMNS.map((c) => tsvCell((r as unknown as Record<string, unknown>)[c])).join("\t"));
  return lines.join("\n") + "\n";
}

function header(rows: ManifestRow[], total: number): string[] {
  const bytes = rows.reduce((n, r) => n + (r.bytes ?? 0), 0);
  return [
    `# singlet.bio manifest — ${rows.length} studies (of ${total} matching)`,
    `# data: CC0 · one .singlet file per GEO series · https://singlet.bio`,
    `# total download size: ${(bytes / 1e9).toFixed(1)} GB`,
  ];
}

function renderCurl(rows: ManifestRow[], total: number): string {
  return (
    ["#!/usr/bin/env bash", "set -euo pipefail", ...header(rows, total), ""]
      .concat(rows.map((r) => `curl -fL --retry 3 -C - -o "${r.gse_id}.singlet" "${r.download_url}"`))
      .join("\n") + "\n"
  );
}

function renderWget(rows: ManifestRow[], total: number): string {
  return [...header(rows, total), ...rows.map((r) => r.download_url)].join("\n") + "\n";
}

function renderPython(rows: ManifestRow[], total: number): string {
  const ids = rows.map((r) => `    "${r.gse_id}",`).join("\n");
  return `${header(rows, total).join("\n")}
import singlet

studies = [
${ids}
]

adatas = {g: singlet.load(g) for g in studies}
`;
}

function renderR(rows: ManifestRow[], total: number): string {
  const ids = rows.map((r) => `  "${r.gse_id}"`).join(",\n");
  return `${header(rows, total).join("\n")}
library(singlet)

studies <- c(
${ids}
)

objects <- lapply(studies, load)
names(objects) <- studies
`;
}

export interface RenderedManifest {
  format: ManifestFormat;
  total: number;
  returned: number;
  total_bytes: number;
  rows: ManifestRow[];
  body: string;
  content_type: string;
  filename: string;
}

export function renderManifest(
  rows: ManifestRow[],
  total: number,
  format: ManifestFormat,
  extra: { applied?: unknown; dropped?: unknown } = {}
): RenderedManifest {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `singlet-manifest-${stamp}`;
  let body: string;
  let content_type: string;
  let filename: string;
  switch (format) {
    case "json":
      body = JSON.stringify(
        {
          total,
          returned: rows.length,
          limit: MAX_MANIFEST_STUDIES,
          license: "CC0",
          ...(extra.applied !== undefined ? { applied: extra.applied } : {}),
          ...(extra.dropped !== undefined ? { dropped: extra.dropped } : {}),
          studies: rows,
        },
        null,
        2
      );
      content_type = "application/json; charset=utf-8";
      filename = `${base}.json`;
      break;
    case "curl":
      body = renderCurl(rows, total);
      content_type = "text/x-shellscript; charset=utf-8";
      filename = `${base}-download.sh`;
      break;
    case "wget":
      body = renderWget(rows, total);
      content_type = "text/plain; charset=utf-8";
      filename = `${base}-urls.txt`;
      break;
    case "python":
      body = renderPython(rows, total);
      content_type = "text/x-python; charset=utf-8";
      filename = `${base}.py`;
      break;
    case "r":
      body = renderR(rows, total);
      content_type = "text/plain; charset=utf-8";
      filename = `${base}.R`;
      break;
    default:
      body = renderTsv(rows);
      content_type = "text/tab-separated-values; charset=utf-8";
      filename = `${base}.tsv`;
  }
  return {
    format,
    total,
    returned: rows.length,
    total_bytes: rows.reduce((n, r) => n + (r.bytes ?? 0), 0),
    rows,
    body,
    content_type,
    filename,
  };
}

/** Search → accessions → rows → rendered manifest. */
export async function buildManifestFromSearch(
  ctx: Ctx,
  filters: SearchFilters,
  format: ManifestFormat,
  extra: { applied?: unknown; dropped?: unknown } = {}
): Promise<RenderedManifest> {
  const { total, accessions } = await exportStudyAccessions(ctx, filters as Parameters<typeof exportStudyAccessions>[1]);
  const ids = accessions.slice(0, MAX_MANIFEST_STUDIES);
  const rows = await manifestRows(ctx.db, ids);
  return renderManifest(rows, total, format, extra);
}

/** An explicit list of accessions → rendered manifest. */
export async function buildManifestFromIds(
  db: D1Database,
  ids: string[],
  format: ManifestFormat
): Promise<RenderedManifest> {
  const capped = ids.slice(0, MAX_MANIFEST_STUDIES);
  const rows = await manifestRows(db, capped);
  return renderManifest(rows, ids.length, format);
}
