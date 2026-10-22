/**
 * MCP tool answers for studies served from v2 (schema/032_v2_catalog.sql), and the three v2-only tools find_cells, slice_cells and
 * resolve_features. The v1 tools in mcp-tools.ts call into the v2 branches here when `getV2State` says the study is migrated and keep
 * their legacy answers otherwise.
 *
 * Everything about where bytes are comes from D1 (one primary-key read per study, one per sample); the objects themselves are read
 * with ranged GETs on the public data host (the data Worker, workers/data-v2), never more than MAX_REQUESTS per call.
 */
import { bundleUrl } from "./study-core";
import { fmt, fmtBytes, GSM_RE, LOADERS, SITE, toolError, toolResult, type ToolResult } from "./mcp-core";
import { knownRev, unchangedBody } from "./rev";
import { filterCells, openCells, parseCellFilter, type CellFilter } from "./v2-cells";
import {
  GSE_RE,
  getV2Sample,
  getV2State,
  listV2Samples,
  parseJsonObject,
  parseMembers,
  parseModalities,
  type V2Member,
  type V2SampleFull,
  type V2State,
} from "./v2-catalog";
import { MODALITIES } from "./modalities";
import { PackError, resolveBarcodeNames, resolveFeatureNames, resolvePackId, type PackFetcher, type PackIndexEntry } from "./v2-packs";
import {
  V2FetchError,
  describeMember,
  describeMembers,
  fetchObjectRange,
  findMember,
  planSlice,
  readPz2Prefix,
  sampleObjectUrl,
  selectColumns,
} from "./v2-serve";
import { v2ManifestUrl, v2PackIndexUrl, v2PackUrl } from "./v2-urls";
import { organismToScientific } from "./vocab";

export interface V2ToolCtx {
  db: D1Database;
  waitUntil: (p: Promise<unknown>) => void;
}

/** Most ranged reads one tool call may make against the data host (the Workers free plan allows 50 external subrequests). */
export const MAX_REQUESTS = 40;

const FORMAT = "singlet-v2";
const gseOf = (args: Record<string, unknown>): string | null => {
  const v = typeof args.gse_id === "string" ? args.gse_id.trim().toUpperCase() : "";
  return GSE_RE.test(v) ? v : null;
};
const gsmOf = (args: Record<string, unknown>, key = "gsm_id"): string | null => {
  const v = typeof args[key] === "string" ? (args[key] as string).trim().toUpperCase() : "";
  return GSM_RE.test(v) ? v : null;
};
const count = (v: unknown, def: number, min: number, max: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function packsOf(state: V2State): Record<string, unknown> {
  return parseJsonObject(state.study.packs_json) ?? {};
}

/** The fields every v2 answer about a study starts with. */
function studyHead(state: V2State) {
  const s = state.study;
  return {
    gse_id: s.gse_id,
    format: FORMAT,
    rev: s.rev,
    manifest_url: v2ManifestUrl(s.gse_id),
    n_samples: s.n_samples,
    bytes: s.bytes,
    reference_build: s.reference_build,
  };
}

const unchanged = (gse: string, rev: string, what: string): ToolResult =>
  toolResult(`${gse}: ${what} unchanged since rev ${rev}.`, unchangedBody(gse, rev));

// ── get_download_url ────────────────────────────────────────────────────────

export async function v2DownloadUrl(ctx: V2ToolCtx, id: string, title: string | null, state: V2State, args: Record<string, unknown>): Promise<ToolResult> {
  const s = state.study;
  const legacyAlive = state.migration?.status !== "retired";
  const includeSamples = args.include_samples === true;
  let samples: { gsm_id: string; url: string; bytes: number | null; sha256: string | null; n_called: number | null }[] | undefined;
  let nextAfter: string | null = null;
  if (includeSamples) {
    const limit = count(args.limit, 50, 1, 200);
    const after = typeof args.after === "string" ? args.after.trim().toUpperCase() : "";
    const rows = await listV2Samples(ctx.db, id, s.rev, { limit: limit + 1, after });
    samples = rows.slice(0, limit).map((r) => ({ gsm_id: r.gsm_id, url: sampleObjectUrl(r.key), bytes: r.bytes, sha256: r.sha256, n_called: r.n_called }));
    nextAfter = rows.length > limit ? rows[limit - 1].gsm_id : null;
  }
  const structured = {
    ...studyHead(state),
    title,
    available: true,
    created_at: s.created_at,
    packs: packsOf(state),
    legacy: legacyAlive ? { url: bundleUrl(id), bytes: s.legacy_bytes, note: "The old single-file bundle, until it is retired. Its contents are the same data." } : null,
    ...(samples ? { samples, next_after: nextAfter } : {}),
    license: "CC0-1.0",
    ...LOADERS(id),
    curl: `curl -fLO ${v2ManifestUrl(id)}`,
    note: "The study is stored as one object per sample plus a manifest that lists them with their byte ranges. The Python and R packages read it directly; get_partial_download and slice_cells give byte ranges inside one sample.",
  };
  const text = `${id}: ${fmt(s.n_samples)} sample objects, ${fmtBytes(s.bytes)} (format ${FORMAT}, rev ${s.rev}). Manifest: ${v2ManifestUrl(id)}\nCC0 — no account or key needed to download.\nPython: singlet.load("${id}")   R: load("${id}")`;
  return toolResult(text, structured);
}

// ── get_partial_download ────────────────────────────────────────────────────

export async function v2PartialDownload(ctx: V2ToolCtx, gse: string, gsm: string, file: string, state: V2State, args: Record<string, unknown>): Promise<ToolResult> {
  if (knownRev(args) === state.study.rev) return unchanged(gse, state.study.rev, "this study's files");
  const sample = await getV2Sample(ctx.db, gse, gsm, state.study.rev);
  if (!sample) return toolError(`${gsm} is not in ${gse}. Use list_bundle_files to see which samples are.`);
  const members = parseMembers(sample.members_json);
  const name = findMember(members, file);
  if (!name) {
    const have = describeMembers(sample).map((m) => m.name);
    return toolError(`No file '${file}' for ${gsm} in ${gse}. Files for this sample: ${have.join(", ")}.`);
  }
  const m = members[name];
  const d = describeMember(name, m);
  const url = sampleObjectUrl(sample.key);
  const base = name.split("/").pop() ?? name;
  const a = Number(m.off);
  const b = a + Number(m.len) - 1;
  const structured = {
    gse_id: gse,
    gsm_id: gsm,
    format: FORMAT,
    rev: state.study.rev,
    file: name,
    url,
    range: d.range,
    bytes: d.bytes,
    member: d,
    object: { key: sample.key, bytes: sample.bytes, sha256: sample.sha256, immutable: true },
    packs: packsOf(state),
    curl: d.range ? `curl -s -r ${a}-${b} "${url}" -o ${base}.member` : null,
    how:
      m.kind === 1
        ? `Fetch the range and decode it with the singlet package (singlet.load("${gse}", samples=["${gsm}"]) does it for you), or take only some cells with slice_cells.`
        : m.kind === 4
          ? `Nothing is stored for this file: it is regenerated from ${JSON.stringify(m.needs ?? [])} by recipe ${String(m.recipe)}. singlet.load and the singlet package do this.`
          : "The range holds the file zstd-compressed (kind 3) or as is (kind 5).",
    slice_with: m.kind === 1 ? { tool: "slice_cells", gse_id: gse, gsm_id: gsm, file: name } : null,
  };
  const text = d.range
    ? `${gse} / ${gsm} / ${name}: ${d.kind_name}, ${fmtBytes(d.bytes)} at ${d.range} of ${url}\n(immutable object, no If-Match needed)`
    : `${gse} / ${gsm} / ${name}: ${d.kind_name}, regenerated by recipe ${d.recipe ?? "?"}; no bytes stored.`;
  return toolResult(text, structured);
}

// ── list_bundle_files ───────────────────────────────────────────────────────

export async function v2ListFiles(ctx: V2ToolCtx, gse: string, gsm: string, state: V2State, args: Record<string, unknown>): Promise<ToolResult> {
  const s = state.study;
  if (knownRev(args) === s.rev) return unchanged(gse, s.rev, "this study's file listing");
  const head = { ...studyHead(state), created_at: s.created_at, packs: packsOf(state), legacy_bytes: s.legacy_bytes };

  if (gsm) {
    const sample = await getV2Sample(ctx.db, gse, gsm, s.rev);
    if (!sample) return toolError(`${gsm} is not in ${gse}. Use list_bundle_files without gsm_id to page through the samples.`);
    const files = describeMembers(sample);
    return toolResult(
      `${gse} / ${gsm}: ${files.length} files in one ${fmtBytes(sample.bytes)} object (${sampleObjectUrl(sample.key)}).`,
      { ...head, sample: sampleLine(sample), object_url: sampleObjectUrl(sample.key), files }
    );
  }

  const detail = args.detail === true;
  const limit = count(args.limit, detail ? 10 : 100, 1, detail ? 25 : 500);
  const after = typeof args.after === "string" ? args.after.trim().toUpperCase() : "";
  const light = await listV2Samples(ctx.db, gse, s.rev, { limit: limit + 1, after });
  const page = light.slice(0, limit);
  const next = light.length > limit ? page[page.length - 1].gsm_id : null;

  // The file kinds: every sample of a study goes through one pipeline run, so one sample is representative.
  const first = page[0] ? await getV2Sample(ctx.db, gse, page[0].gsm_id, s.rev) : null;
  const kinds = first ? describeMembers(first).map((f) => ({ name: f.name, kind: f.kind_name, bytes: f.bytes, legacy_bytes: f.legacy_bytes })) : [];
  let samples: unknown[] = page.map((r) => ({ gsm_id: r.gsm_id, bytes: r.bytes, n_columns: r.n_columns, n_called: r.n_called, n_members: r.n_members, url: sampleObjectUrl(r.key) }));
  if (detail) {
    const full = await Promise.all(page.map((r) => getV2Sample(ctx.db, gse, r.gsm_id, s.rev)));
    samples = page.map((r, i) => ({ gsm_id: r.gsm_id, bytes: r.bytes, url: sampleObjectUrl(r.key), files: full[i] ? describeMembers(full[i]!) : [] }));
  }
  const structured = {
    ...head,
    files_in_each_sample: kinds,
    samples,
    next_after: next,
    ...(detail ? {} : { more: "Pass gsm_id for one sample's files with their byte ranges, or detail=true (up to 25 samples a page) for every sample's." }),
  };
  const text = `${gse}: ${fmt(s.n_samples)} sample objects, ${fmtBytes(s.bytes)}, ${kinds.length} files each (format ${FORMAT}, rev ${s.rev}). Manifest: ${v2ManifestUrl(gse)}${next ? `\nMore samples: pass after=${next}.` : ""}`;
  return toolResult(text, structured);
}

function sampleLine(r: V2SampleFull) {
  return { gsm_id: r.gsm_id, key: r.key, bytes: r.bytes, sha256: r.sha256, n_columns: r.n_columns, n_called: r.n_called, median_umi: r.median_umi, median_genes: r.median_genes };
}

// ── get_modalities ──────────────────────────────────────────────────────────

export async function v2Modalities(ctx: V2ToolCtx, gse: string, gsm: string, state: V2State, args: Record<string, unknown>): Promise<ToolResult> {
  const s = state.study;
  if (knownRev(args) === s.rev) return unchanged(gse, s.rev, "this study's modalities");
  const rows = (await listV2Samples(ctx.db, gse, s.rev, { limit: 500 })).filter((r) => !gsm || r.gsm_id === gsm);
  if (!rows.length) {
    return gsm ? toolError(`${gsm} is not in ${gse}. Samples are listed by list_bundle_files.`) : toolError(`${gse} has no samples in the v2 catalog.`);
  }
  const perSample = rows.map((r) => ({ gsm_id: r.gsm_id, modalities: parseModalities(r.modalities) }));
  const counts = new Map<string, number>();
  for (const p of perSample) for (const m of p.modalities) counts.set(m, (counts.get(m) ?? 0) + 1);
  const present = MODALITIES.filter((m) => counts.has(m.name));
  const missing = MODALITIES.filter((m) => !counts.has(m.name)).map((m) => m.name);
  const exampleGsm = rows[0].gsm_id;
  const structured = {
    gse_id: gse,
    format: FORMAT,
    rev: s.rev,
    n_samples: rows.length,
    reference_build: s.reference_build,
    modalities: present.map((m) => ({ name: m.name, group: m.group, kind: m.kind, description: m.description, n_samples: counts.get(m.name) ?? 0, python: m.python, r: m.r })),
    missing,
    per_sample: perSample,
    raw_counts: {
      python: `import singlet\nb = singlet.open_bundle("${gse}")\ngsm = "${exampleGsm}"\nadata = b.raw_counts(gsm)                 # X = exon + intron\nadata.layers["spliced"], adata.layers["unspliced"]`,
      r: `library(singlet)\npath <- download("${gse}")\ngsm  <- "${exampleGsm}"\nsce  <- singlet_raw_counts(path, gsm)     # counts = exon + intron\nassayNames(sce)                          # counts, spliced, unspliced`,
    },
    manifest_url: v2ManifestUrl(gse),
    study_url: `${SITE}/study/${gse}`,
  };
  const lines = [
    `${gse} carries ${present.length} modalit${present.length === 1 ? "y" : "ies"} across ${fmt(rows.length)} sample${rows.length === 1 ? "" : "s"}${s.reference_build ? ` (reference ${s.reference_build})` : ""}.`,
    "",
    ...present.map((m) => `- ${m.name} (${m.kind}, ${(counts.get(m.name) ?? 0) === rows.length ? "all samples" : `${counts.get(m.name)}/${rows.length} samples`}) — ${m.description}`),
  ];
  if (missing.length) lines.push("", `Not in this study: ${missing.join(", ")}.`);
  return toolResult(lines.join("\n"), structured);
}

// ── find_cells ──────────────────────────────────────────────────────────────

const SAMPLE_FILTER_KEYS = ["min_called", "max_called", "min_median_umi", "min_median_genes", "organism", "tissue_group", "disease_group", "assay_family", "include_low_qc"] as const;

interface SampleRow {
  gse_id: string;
  gsm_id: string;
  key: string;
  n_columns: number | null;
  n_called: number | null;
  median_umi: number | null;
  median_genes: number | null;
  cells_member: string | null;
  study_rev: string;
}

export async function findCells(ctx: V2ToolCtx, args: Record<string, unknown>, opts: { maxRequests?: number } = {}): Promise<ToolResult> {
  const maxRequests = opts.maxRequests ?? MAX_REQUESTS;
  // scope
  const gseIds = Array.isArray(args.gse_ids) ? [...new Set((args.gse_ids as unknown[]).map((v) => String(v).trim().toUpperCase()))].filter((v) => GSE_RE.test(v)) : [];
  const gsmIds = Array.isArray(args.gsm_ids) ? [...new Set((args.gsm_ids as unknown[]).map((v) => String(v).trim().toUpperCase()))].filter((v) => GSM_RE.test(v)) : [];
  if (gseIds.length > 20) return toolError("gse_ids takes at most 20 studies.");
  if (gsmIds.length > 50) return toolError("gsm_ids takes at most 50 samples.");
  const sf = (args.sample_filter && typeof args.sample_filter === "object" && !Array.isArray(args.sample_filter) ? args.sample_filter : {}) as Record<string, unknown>;
  for (const k of Object.keys(sf)) if (!(SAMPLE_FILTER_KEYS as readonly string[]).includes(k)) return toolError(`Unknown sample_filter key '${k}'. Use ${SAMPLE_FILTER_KEYS.join(", ")}.`);
  const scoped = gseIds.length > 0 || gsmIds.length > 0 || Object.keys(sf).some((k) => k !== "include_low_qc");
  if (!scoped) return toolError("Say which samples to look in: gse_ids, gsm_ids, or a sample_filter (organism, tissue_group, disease_group, assay_family, min_called, ...).");

  const parsed = parseCellFilter(args.cell_filter ?? {});
  if ("error" in parsed) return toolError(`cell_filter: ${parsed.error}`);
  const filter: CellFilter = parsed.filter;

  const limit = count(args.limit_samples, 10, 1, 25);
  const maxRuns = count(args.max_runs_per_sample, 100, 1, 500);
  const after = typeof args.after === "string" ? args.after.trim().toUpperCase() : "";
  const [afterGse, afterGsm] = after.includes("/") ? after.split("/") : ["", ""];

  // 1. the samples, in D1
  const where: string[] = [
    `NOT EXISTS (SELECT 1 FROM v2_migration m WHERE m.gse_id = s.gse_id AND m.status NOT IN ('verified', 'retired'))`,
  ];
  const bind: (string | number)[] = [];
  if (gseIds.length) {
    where.push(`s.gse_id IN (${gseIds.map(() => "?").join(",")})`);
    bind.push(...gseIds);
  }
  if (gsmIds.length) {
    where.push(`s.gsm_id IN (${gsmIds.map(() => "?").join(",")})`);
    bind.push(...gsmIds);
  }
  const num = (k: string): number | null => (sf[k] === undefined ? null : Number.isFinite(Number(sf[k])) ? Number(sf[k]) : NaN);
  for (const [key, col, op] of [
    ["min_called", "s.n_called", ">="],
    ["max_called", "s.n_called", "<="],
    ["min_median_umi", "s.median_umi", ">="],
    ["min_median_genes", "s.median_genes", ">="],
  ] as const) {
    const v = num(key);
    if (v === null) continue;
    if (Number.isNaN(v)) return toolError(`sample_filter.${key} must be a number.`);
    where.push(`${col} ${op} ?`);
    bind.push(v);
  }
  let joinGsm = false;
  const text = (k: string): string | null => (typeof sf[k] === "string" && (sf[k] as string).trim() ? (sf[k] as string).trim() : null);
  const organism = text("organism");
  if (organism) {
    joinGsm = true;
    where.push(`g.organism_primary = ?`);
    bind.push(organismToScientific(organism) ?? organism);
  }
  for (const [key, col] of [
    ["tissue_group", "g.tissue_group"],
    ["disease_group", "g.disease_group"],
    ["assay_family", "g.assay_family"],
  ] as const) {
    const v = text(key);
    if (!v) continue;
    joinGsm = true;
    where.push(`${col} = ?`);
    bind.push(v);
  }
  where.push(`EXISTS (SELECT 1 FROM sample_qc q WHERE q.gsm_id = s.gsm_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) <= ${sf.include_low_qc === true ? 1 : 0})`);
  if (afterGse) {
    where.push(`(s.gse_id > ? OR (s.gse_id = ? AND s.gsm_id > ?))`);
    bind.push(afterGse, afterGse, afterGsm);
  }
  let rows: SampleRow[];
  try {
    const rs = await ctx.db
      .prepare(
        `SELECT s.gse_id, s.gsm_id, s.key, s.n_columns, s.n_called, s.median_umi, s.median_genes,
                json_extract(s.members_json, '$.cells') AS cells_member, st.rev AS study_rev
           FROM v2_sample s
           JOIN v2_study st ON st.gse_id = s.gse_id AND st.rev = s.rev
           ${joinGsm ? "JOIN gsm g ON g.gsm_id = s.gsm_id" : ""}
          WHERE ${where.join(" AND ")}
          ORDER BY s.gse_id, s.gsm_id
          LIMIT ?`
      )
      .bind(...bind, limit + 1)
      .all<SampleRow>();
    rows = rs.results ?? [];
  } catch (e) {
    if (/no such table/i.test(String(e))) return toolError("No study has been migrated to the v2 format yet, so there are no per-cell tables to search.");
    throw e;
  }
  const more = rows.length > limit;
  rows = rows.slice(0, limit);
  if (!rows.length) {
    return toolResult("No v2 sample matches that sample scope. find_cells searches studies that have been migrated to the v2 format.", {
      format: FORMAT, samples_scanned: 0, results: [], errors: [], requests: 0, next_after: null, cell_filter: filter,
    });
  }

  // 2. each sample's cells table, at most MAX_REQUESTS reads in all, 6 at a time
  type Hit = { gse_id: string; gsm_id: string; rev: string; n_columns: number; n_called: number | null; n_match: number; runs: [number, number][]; runs_truncated: boolean };
  const results: Hit[] = [];
  const errors: { gse_id: string; gsm_id: string; error: string }[] = [];
  let requests = 0;
  let scanned = 0;
  let stoppedAt: SampleRow | null = null;
  const WHOLE_MAX = 1024 * 1024;
  const cost = (r: SampleRow) => ((parseJsonObject(r.cells_member)?.len as number | undefined) ?? 0) <= WHOLE_MAX ? 1 : 1 + 1 + 4;
  for (let i = 0; i < rows.length; ) {
    const group: SampleRow[] = [];
    let reserve = 0;
    while (i < rows.length && group.length < 6 && requests + reserve + cost(rows[i]) <= maxRequests) {
      reserve += cost(rows[i]);
      group.push(rows[i++]);
    }
    if (!group.length) {
      stoppedAt = rows[i];
      break;
    }
    const done = await Promise.all(
      group.map(async (r) => {
        try {
          const member = parseJsonObject(r.cells_member) as V2Member | null;
          if (!member || member.kind !== 2) throw new Error("the sample has no cells table");
          const url = sampleObjectUrl(r.key);
          const table = await openCells((off, len) => fetchObjectRange(url, member.off + off, len), member.len, { wholeMax: WHOLE_MAX });
          const out = await filterCells(table, filter, { maxRuns });
          return { ok: true as const, r, table, out };
        } catch (e) {
          return { ok: false as const, r, error: e instanceof Error ? e.message : String(e) };
        }
      })
    );
    for (const d of done) {
      scanned++;
      if (!d.ok) {
        errors.push({ gse_id: d.r.gse_id, gsm_id: d.r.gsm_id, error: d.error.slice(0, 200) });
        requests += 1; // at least the failed read
        continue;
      }
      requests += d.table.requests;
      if (d.out.nMatch > 0) {
        const runs: [number, number][] = [];
        for (let k = 0; k < d.out.runs.length; k += 2) runs.push([d.out.runs[k], d.out.runs[k + 1]]);
        results.push({ gse_id: d.r.gse_id, gsm_id: d.r.gsm_id, rev: d.r.study_rev, n_columns: d.out.nRows, n_called: d.r.n_called, n_match: d.out.nMatch, runs, runs_truncated: d.out.runsTruncated });
      }
    }
  }
  const last = stoppedAt ? rows[rows.indexOf(stoppedAt) - 1] : rows[rows.length - 1];
  const nextAfter = stoppedAt || more ? (last ? `${last.gse_id}/${last.gsm_id}` : after || null) : null;
  const cells = results.reduce((n, r) => n + r.n_match, 0);
  const structured = {
    format: FORMAT,
    cell_filter: filter,
    samples_scanned: scanned,
    samples_with_matches: results.length,
    cells_matched: cells,
    results,
    errors,
    requests,
    request_limit: maxRequests,
    budget_exhausted: stoppedAt !== null,
    next_after: nextAfter,
    next: results.length ? `slice_cells with gse_id, gsm_id and runs gives the byte ranges of those cells' matrix chunks.` : null,
  };
  const textOut = `${fmt(cells)} cells match in ${results.length} of ${scanned} samples scanned (${requests} reads of the data host).${nextAfter ? ` More samples: pass after="${nextAfter}".` : ""}${errors.length ? ` ${errors.length} samples could not be read.` : ""}`;
  return toolResult(textOut, structured);
}

// ── slice_cells ─────────────────────────────────────────────────────────────

export async function sliceCells(ctx: V2ToolCtx, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseOf(args);
  const gsm = gsmOf(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE200901.");
  if (!gsm) return toolError("`gsm_id` must be a GEO sample accession like GSM4746717.");
  const wantFiles = Array.isArray(args.files)
    ? (args.files as unknown[]).map((v) => String(v).trim()).filter(Boolean).slice(0, 4)
    : typeof args.file === "string" && args.file.trim()
      ? [args.file.trim()]
      : ["exon_counts.1pz", "intron_counts.1pz"];

  const state = await getV2State(ctx.db, gse);
  if (!state) return toolError(`${gse} is not in the v2 format yet, so cells cannot be sliced by chunk. Use get_partial_download for the legacy file.`);
  const sample = await getV2Sample(ctx.db, gse, gsm, state.study.rev);
  if (!sample) return toolError(`${gsm} is not in ${gse}. Use list_bundle_files to see which samples are.`);

  const members = parseMembers(sample.members_json);
  const url = sampleObjectUrl(sample.key);
  const maxRanges = count(args.max_ranges, 64, 1, 200);

  const files: Record<string, unknown>[] = [];
  const skipped: { file: string; reason: string }[] = [];
  let requests = 0;
  for (const want of wantFiles) {
    const name = findMember(members, want);
    if (!name) {
      skipped.push({ file: want, reason: "not in this sample" });
      continue;
    }
    const m = members[name];
    if (m.kind !== 1) {
      skipped.push({ file: name, reason: `${describeMember(name, m).kind_name} has no chunks; use get_partial_download` });
      continue;
    }
    if (!Number.isInteger(m.n) || !Number.isInteger(m.chunk_cols)) {
      skipped.push({ file: name, reason: "the manifest does not describe this matrix's chunks" });
      continue;
    }
    // validated against this matrix's own column count (it equals the cells table's)
    const own = selectColumns({ runs: args.runs, indices: args.indices, range: args.range }, Number(m.n));
    if ("error" in own) return toolError(own.error);
    try {
      const { header, index, requests: r } = await readPz2Prefix(url, m);
      requests += r;
      const plan = planSlice(m, header, index, own, { maxRanges });
      files.push({
        file: name,
        rows: header.m,
        columns: header.n,
        nnz: header.nnz,
        codec: describeMember(name, m).codec,
        chunk_cols: header.chunkCols,
        names: m.names,
        ...plan,
      });
    } catch (e) {
      if (e instanceof V2FetchError) return toolError(`Could not read ${name} of ${gsm}: ${e.message}`);
      throw e;
    }
  }
  if (!files.length) return toolError(`Nothing to slice: ${skipped.map((s) => `${s.file} (${s.reason})`).join("; ") || "no matrix files"}.`);

  const cellsMember = members["cells"];
  const first = files[0] as { chunks: { range: string }[]; prefix: { range: string }[]; file: string; columns_wanted: number; bytes_chunks: number; bytes_prefix: number };
  const structured = {
    gse_id: gse,
    gsm_id: gsm,
    format: FORMAT,
    rev: state.study.rev,
    url,
    immutable: true,
    object_bytes: sample.bytes,
    n_columns: sample.n_columns,
    files,
    skipped,
    cells_table: cellsMember ? describeMember("cells", cellsMember) : null,
    requests,
    how: "For each file, GET the prefix ranges once and the chunk ranges for the cells you want (each with a Range header on `url`); the chunks decode independently. Column numbers are positions in the stored matrix, the same positions find_cells reports. singlet.load(gse, samples=[gsm]) does all of this.",
  };
  const bytes = files.reduce((n, f) => n + (f as unknown as typeof first).bytes_prefix + (f as unknown as typeof first).bytes_chunks, 0);
  const text = `${gse} / ${gsm}: ${files.length} matri${files.length === 1 ? "x" : "ces"}, ${fmtBytes(bytes)} to fetch in ${files.reduce((n, f) => n + (f as unknown as typeof first).chunks.length + (f as unknown as typeof first).prefix.length, 0)} ranges of ${url}.`;
  return toolResult(text, structured);
}

// ── resolve_features ────────────────────────────────────────────────────────

let packIndexMemo: { at: number; entries: PackIndexEntry[] } | null = null;

async function loadPackIndex(): Promise<PackIndexEntry[]> {
  if (packIndexMemo && Date.now() - packIndexMemo.at < 300_000) return packIndexMemo.entries;
  const res = await fetch(v2PackIndexUrl(), { cf: { cacheEverything: true, cacheTtl: 300 } } as RequestInit);
  if (!res.ok) throw new V2FetchError(`pack index answered ${res.status}`, res.status);
  const doc = (await res.json()) as { packs?: PackIndexEntry[] } | PackIndexEntry[];
  const entries = Array.isArray(doc) ? doc : (doc.packs ?? []);
  packIndexMemo = { at: Date.now(), entries };
  return entries;
}

/** Test hook. */
export function clearPackIndexMemo(): void {
  packIndexMemo = null;
}

const fetchPack: PackFetcher = async (id32) => {
  const res = await fetch(v2PackUrl(id32), { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit);
  if (!res.ok) throw new V2FetchError(`pack ${id32} answered ${res.status}`, res.status);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > 32 * 1024 * 1024) throw new V2FetchError(`pack ${id32} is too large`);
  return new Uint8Array(await res.arrayBuffer());
};

export async function resolveFeatures(ctx: V2ToolCtx, args: Record<string, unknown>, deps: { fetchPack?: PackFetcher; loadIndex?: () => Promise<PackIndexEntry[]> } = {}): Promise<ToolResult> {
  const indices = args.indices;
  if (!Array.isArray(indices) || indices.length < 1 || indices.length > 500) return toolError("`indices` must be 1 to 500 row (or barcode) numbers, as found in a matrix of the sample.");
  if (!indices.every((v) => Number.isSafeInteger(v) && (v as number) >= 0)) return toolError("`indices` must be non-negative integers.");

  let packRef = typeof args.pack === "string" ? args.pack.trim().toLowerCase() : "";
  let from: Record<string, unknown> | null = null;
  if (!packRef) {
    const gse = gseOf(args);
    const gsm = gsmOf(args);
    const file = typeof args.file === "string" ? args.file.trim() : "exon_counts.1pz";
    if (!gse || !gsm) return toolError("Give `pack` (a pack id from get_partial_download or slice_cells), or gse_id, gsm_id and file to look it up.");
    const sample = await getV2Sample(ctx.db, gse, gsm);
    if (!sample) return toolError(`${gsm} is not in ${gse} in the v2 catalog.`);
    const members = parseMembers(sample.members_json);
    const name = findMember(members, file);
    if (!name) return toolError(`No file '${file}' for ${gsm}.`);
    const names = members[name].names as Record<string, unknown> | undefined;
    const axis = args.axis === "cols" ? "cols" : "rows";
    const ref = names?.[axis];
    const pack = ref && typeof ref === "object" ? (ref as Record<string, unknown>).pack : typeof ref === "string" && /^[0-9a-f]{16,32}$/i.test(ref) ? ref : null;
    if (typeof pack !== "string") {
      return toolError(
        axis === "cols" && ref === "cells"
          ? `The columns of ${name} are the cells table of the sample (its barcode column), not a pack.`
          : `${name} stores its ${axis === "rows" ? "feature" : "column"} names inside the file (${typeof ref === "string" ? ref : "inline"}); read them with the singlet package.`
      );
    }
    packRef = pack.toLowerCase();
    from = { gse_id: gse, gsm_id: gsm, file: name, axis };
  }
  if (!/^[0-9a-f]{16,32}$/.test(packRef)) return toolError("`pack` must be 16 to 32 hex characters (the pack id a matrix records, or its first 8 bytes).");

  try {
    const entries = await (deps.loadIndex ?? loadPackIndex)();
    const id = resolvePackId(entries, packRef);
    const entry = entries.find((e) => e.id === id);
    const fetcher = deps.fetchPack ?? fetchPack;
    const wl = entry?.kind === "whitelist";
    const out = wl ? await resolveBarcodeNames(fetcher, id, indices as number[]) : await resolveFeatureNames(fetcher, id, indices as number[]);
    const names = (indices as number[]).map((index, i) => ({ index, name: out.names[i] }));
    const missing = names.filter((n) => n.name === null).length;
    return toolResult(
      `${names.length - missing} of ${names.length} ${wl ? "barcodes" : "features"} resolved from pack ${id} (${wl ? "whitelist" : `${(out.pack as { build: string }).build} ${(out.pack as { member: string }).member}`}).${missing ? ` ${missing} indices are past the end of the pack.` : ""}`,
      { format: FORMAT, pack: out.pack, ...(from ? { from } : {}), names }
    );
  } catch (e) {
    if (e instanceof PackError || e instanceof V2FetchError) return toolError(`Could not resolve: ${e.message}`);
    throw e;
  }
}
