/**
 * MCP tool answers for studies served from s1 (schema/032_v2_catalog.sql, renamed by schema/038_s1_catalog.sql), and the three s1-only tools find_cells, slice_cells and
 * resolve_features. The v1 tools in mcp-tools.ts call into the s1 branches here when `getS1State` says the study is migrated and keep
 * their legacy answers otherwise.
 *
 * Everything about where bytes are comes from D1 (one primary-key read per study, one per sample); the objects themselves are read
 * with ranged GETs on the public data host (the data Worker, workers/data), never more than MAX_REQUESTS per call.
 */
import { bundleUrl } from "./study-core";
import { fmt, fmtBytes, GSM_RE, LOADERS, SITE, toolError, toolResult, type ToolResult } from "./mcp-core";
import { knownRev, unchangedBody } from "./rev";
import { DT_STR, filterCells, openCells, parseCellFilter, type CellFilter, type CellsTable } from "./s1-cells";
import {
  GSE_RE,
  getS1Sample,
  getS1Samples,
  getS1State,
  isLegacyAlive,
  listS1Samples,
  parseJsonObject,
  parseMembers,
  parseModalities,
  type S1Member,
  type S1SampleFull,
  type S1State,
} from "./s1-catalog";
import { MODALITIES } from "./modalities";
import { sampleServedSql, studyServedSql } from "./alpha";
import { PackError, resolveBarcodeNames, resolveFeatureNames, resolvePackId, type PackFetcher, type PackIndexEntry } from "./s1-packs";
import {
  S1FetchError,
  describeMember,
  describeMembers,
  fetchObjectRange,
  findMember,
  planSlice,
  readPz2Prefix,
  sampleObjectUrl,
  selectColumns,
} from "./s1-serve";
import { s1ManifestUrl, s1PackIndexUrl, s1PackUrl, s1Url } from "./s1-urls";
import { cellLinesOf, CULTURED_CELL, HANCESTRO_LABELS, LABEL_FILTERS, LABEL_FILTER_FIELDS, labelMatchSql, normalizeLabelValues, type CellLine } from "./s1-labels";
import { loadModality, loadSnippets, OFFERED_LOAD_MODALITY_NAMES, parseLoadModalities, sampleLoadModalities, selectMembers, type Selection } from "./s1-load-modalities";
import { organismToScientific } from "./vocab";

export interface S1ToolCtx {
  db: D1Database;
  waitUntil: (p: Promise<unknown>) => void;
}

/** Most ranged reads one tool call may make against the data host (the Workers free plan allows 50 external subrequests). */
export const MAX_REQUESTS = 40;

const FORMAT = "singlet-s1";
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

function packsOf(state: S1State): Record<string, unknown> {
  return parseJsonObject(state.study.packs_json) ?? {};
}

/** The fields every s1 answer about a study starts with. */
function studyHead(state: S1State) {
  const s = state.study;
  return {
    gse_id: s.gse_id,
    format: FORMAT,
    rev: s.rev,
    manifest_url: s1ManifestUrl(s.gse_id),
    n_samples: s.n_samples,
    bytes: s.bytes,
    reference_build: s.reference_build,
  };
}

const unchanged = (gse: string, rev: string, what: string): ToolResult =>
  toolResult(`${gse}: ${what} unchanged since rev ${rev}.`, unchangedBody(gse, rev));

/** `modalities` of the arguments: null when absent, the names, or a tool error. */
function modalitiesArg(args: Record<string, unknown>): { names: string[] } | ToolResult | null {
  const p = parseLoadModalities(args.modalities);
  if (p && "error" in p) return toolError(p.error);
  return p;
}
const isToolResult = (v: unknown): v is ToolResult => !!v && typeof v === "object" && "content" in (v as object);

/** One sample's selection, as an answer field: the members with their ranges and what a client downloads for them. */
function selectionOut(sel: Selection, url: string, objectBytes: number | null) {
  return {
    modalities: sel.modalities,
    files: sel.files.map((f) => ({ file: f.name, kind_name: f.kind_name, range: f.range, bytes: f.bytes })),
    missing: sel.missing,
    bytes: sel.bytes,
    object_bytes: objectBytes,
    url,
  };
}

// ── get_download_url ────────────────────────────────────────────────────────

export async function s1DownloadUrl(ctx: S1ToolCtx, id: string, title: string | null, state: S1State, args: Record<string, unknown>): Promise<ToolResult> {
  const s = state.study;
  const legacyAlive = isLegacyAlive(state.migration);
  const mods = modalitiesArg(args);
  if (isToolResult(mods)) return mods;
  const includeSamples = args.include_samples === true || mods !== null;
  let samples: { gsm_id: string; url: string; bytes: number | null; sha256: string | null; n_called: number | null; selection?: unknown }[] | undefined;
  let nextAfter: string | null = null;
  let selected: { modalities: string[]; bytes: number; object_bytes: number; samples: number } | undefined;
  if (includeSamples) {
    // with modalities each sample's member list is read too, so a page is smaller
    const limit = count(args.limit, mods ? 25 : 50, 1, mods ? 50 : 200);
    const after = typeof args.after === "string" ? args.after.trim().toUpperCase() : "";
    const rows = await listS1Samples(ctx.db, id, s.rev, { limit: limit + 1, after });
    const page = rows.slice(0, limit);
    nextAfter = rows.length > limit ? rows[limit - 1].gsm_id : null;
    const full = mods && page.length ? new Map((await getS1Samples(ctx.db, id, page.map((r) => r.gsm_id), s.rev)).map((r) => [r.gsm_id, r])) : null;
    samples = page.map((r) => {
      const url = sampleObjectUrl(r.key);
      const line = { gsm_id: r.gsm_id, url, bytes: r.bytes, sha256: r.sha256, n_called: r.n_called };
      const f = full?.get(r.gsm_id);
      return mods && f ? { ...line, selection: selectionOut(selectMembers(parseMembers(f.members_json), mods.names), url, r.bytes ?? 0) } : line;
    });
    if (mods) {
      const sel = samples.map((x) => x.selection as { bytes: number } | undefined).filter((x): x is { bytes: number } => !!x);
      selected = { modalities: mods.names, bytes: sel.reduce((n, x) => n + x.bytes, 0), object_bytes: page.reduce((n, r) => n + (r.bytes ?? 0), 0), samples: sel.length };
    }
  }
  const structured = {
    ...studyHead(state),
    title,
    available: true,
    created_at: s.created_at,
    packs: packsOf(state),
    legacy: legacyAlive ? { url: bundleUrl(id), bytes: s.legacy_bytes, note: "The old single-file bundle, until it is retired. Its contents are the same data." } : null,
    ...(samples ? { samples, next_after: nextAfter } : {}),
    ...(selected ? { selected, load: loadSnippets(id, null, selected.modalities) } : {}),
    license: "CC0-1.0",
    ...LOADERS(id),
    curl: `curl -fLO ${s1ManifestUrl(id)}`,
    note: "The study is stored as one object per sample plus a manifest that lists them with their byte ranges. The Python and R packages read it directly; get_partial_download and slice_cells give byte ranges inside one sample.",
  };
  const text = selected
    ? `${id}: ${selected.modalities.join(", ")} of ${selected.samples} sample${selected.samples === 1 ? "" : "s"} on this page is ${fmtBytes(selected.bytes)} of ${fmtBytes(selected.object_bytes)} (format ${FORMAT}, rev ${s.rev}); each sample lists its byte ranges.${nextAfter ? ` More samples: pass after=${nextAfter}.` : ""}\nPython: ${loadSnippets(id, null, selected.modalities).python}   R: ${loadSnippets(id, null, selected.modalities).r}`
    : `${id}: ${fmt(s.n_samples)} sample objects, ${fmtBytes(s.bytes)} (format ${FORMAT}, rev ${s.rev}). Manifest: ${s1ManifestUrl(id)}\nCC0 — no account or key needed to download.\nPython: singlet.load("${id}")   R: load("${id}")`;
  return toolResult(text, structured);
}

// ── get_partial_download ────────────────────────────────────────────────────

export async function s1PartialDownload(ctx: S1ToolCtx, gse: string, gsm: string, file: string, state: S1State, args: Record<string, unknown>): Promise<ToolResult> {
  if (knownRev(args) === state.study.rev) return unchanged(gse, state.study.rev, "this study's files");
  const mods = modalitiesArg(args);
  if (isToolResult(mods)) return mods;
  if (mods && file) return toolError("Give `file` or `modalities`, not both.");
  const sample = await getS1Sample(ctx.db, gse, gsm, state.study.rev);
  if (!sample) return toolError(`${gsm} is not in ${gse}. Use list_bundle_files to see which samples are.`);
  const members = parseMembers(sample.members_json);
  if (mods) return partialByModalities(gse, gsm, state, sample, members, mods.names);
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

/** get_partial_download with `modalities`: the byte range of every member those modalities need (the cells table included). */
function partialByModalities(gse: string, gsm: string, state: S1State, sample: S1SampleFull, members: Record<string, S1Member>, names: string[]): ToolResult {
  const sel = selectMembers(members, names);
  const have = sampleLoadModalities(members);
  if (sel.missing.length === names.length) {
    return toolError(`${gsm} has none of ${names.join(", ")}. It has: ${have.join(", ") || "no matrices"}. Use get_modalities for the study.`);
  }
  const url = sampleObjectUrl(sample.key);
  const out = selectionOut(sel, url, sample.bytes);
  const structured = {
    gse_id: gse,
    gsm_id: gsm,
    format: FORMAT,
    rev: state.study.rev,
    ...out,
    available: have,
    object: { key: sample.key, bytes: sample.bytes, sha256: sample.sha256, immutable: true },
    packs: packsOf(state),
    curl: sel.files.filter((f) => f.range).map((f) => `curl -s -r ${f.range!.slice(6)} "${url}" -o ${f.name.split("/").pop()}.member`),
    load: loadSnippets(gse, gsm, sel.modalities.filter((m) => !sel.missing.includes(m))),
    how: "Each range is one member of the immutable sample object. singlet.load with the same modalities fetches exactly these ranges and decodes them; slice_cells with modalities takes only some cells.",
  };
  const text = `${gse} / ${gsm}: ${names.join(", ")} is ${fmtBytes(sel.bytes)} of the ${fmtBytes(sample.bytes)} object in ${sel.files.filter((f) => f.range).length} ranges (${sel.files.map((f) => f.name).join(", ")}).${sel.missing.length ? ` Not in this sample: ${sel.missing.join(", ")}.` : ""}`;
  return toolResult(text, structured);
}

// ── list_bundle_files ───────────────────────────────────────────────────────

export async function s1ListFiles(ctx: S1ToolCtx, gse: string, gsm: string, state: S1State, args: Record<string, unknown>): Promise<ToolResult> {
  const s = state.study;
  if (knownRev(args) === s.rev) return unchanged(gse, s.rev, "this study's file listing");
  const head = { ...studyHead(state), created_at: s.created_at, packs: packsOf(state), legacy_bytes: s.legacy_bytes };
  const mods = modalitiesArg(args);
  if (isToolResult(mods)) return mods;

  if (gsm) {
    const sample = await getS1Sample(ctx.db, gse, gsm, s.rev);
    if (!sample) return toolError(`${gsm} is not in ${gse}. Use list_bundle_files without gsm_id to page through the samples.`);
    if (mods) {
      const sel = selectMembers(parseMembers(sample.members_json), mods.names);
      return toolResult(
        `${gse} / ${gsm}: ${mods.names.join(", ")} is ${sel.files.length} files, ${fmtBytes(sel.bytes)} of the ${fmtBytes(sample.bytes)} object (${sampleObjectUrl(sample.key)}).${sel.missing.length ? ` Not in this sample: ${sel.missing.join(", ")}.` : ""}`,
        { ...head, sample: sampleLine(sample), object_url: sampleObjectUrl(sample.key), files: sel.files, selection: selectionOut(sel, sampleObjectUrl(sample.key), sample.bytes), load: loadSnippets(gse, gsm, mods.names) }
      );
    }
    const files = describeMembers(sample);
    return toolResult(
      `${gse} / ${gsm}: ${files.length} files in one ${fmtBytes(sample.bytes)} object (${sampleObjectUrl(sample.key)}).`,
      { ...head, sample: sampleLine(sample), object_url: sampleObjectUrl(sample.key), files }
    );
  }

  const detail = args.detail === true || mods !== null;
  const limit = count(args.limit, detail ? 10 : 100, 1, detail ? 25 : 500);
  const after = typeof args.after === "string" ? args.after.trim().toUpperCase() : "";
  const light = await listS1Samples(ctx.db, gse, s.rev, { limit: limit + 1, after });
  const page = light.slice(0, limit);
  const next = light.length > limit ? page[page.length - 1].gsm_id : null;

  // The file kinds: every sample of a study goes through one pipeline run, so one sample is representative.
  const first = page[0] ? await getS1Sample(ctx.db, gse, page[0].gsm_id, s.rev) : null;
  const kinds = first ? describeMembers(first).map((f) => ({ name: f.name, kind: f.kind_name, bytes: f.bytes, legacy_bytes: f.legacy_bytes })) : [];
  let samples: unknown[] = page.map((r) => ({ gsm_id: r.gsm_id, bytes: r.bytes, n_columns: r.n_columns, n_called: r.n_called, n_members: r.n_members, url: sampleObjectUrl(r.key) }));
  let selected: { modalities: string[]; bytes: number; object_bytes: number } | undefined;
  if (mods) {
    const full = page.length ? new Map((await getS1Samples(ctx.db, gse, page.map((r) => r.gsm_id), s.rev)).map((r) => [r.gsm_id, r])) : new Map();
    const sels = page.map((r) => {
      const f = full.get(r.gsm_id);
      return f ? selectMembers(parseMembers(f.members_json), mods.names) : null;
    });
    samples = page.map((r, i) => ({ gsm_id: r.gsm_id, bytes: r.bytes, url: sampleObjectUrl(r.key), files: sels[i]?.files ?? [], selected_bytes: sels[i]?.bytes ?? 0, missing: sels[i]?.missing ?? mods.names }));
    selected = { modalities: mods.names, bytes: sels.reduce((n, x) => n + (x?.bytes ?? 0), 0), object_bytes: page.reduce((n, r) => n + (r.bytes ?? 0), 0) };
  } else if (detail) {
    const full = await Promise.all(page.map((r) => getS1Sample(ctx.db, gse, r.gsm_id, s.rev)));
    samples = page.map((r, i) => ({ gsm_id: r.gsm_id, bytes: r.bytes, url: sampleObjectUrl(r.key), files: full[i] ? describeMembers(full[i]!) : [] }));
  }
  const structured = {
    ...head,
    ...(selected ? { selected, load: loadSnippets(gse, null, selected.modalities) } : {}),
    files_in_each_sample: kinds,
    samples,
    next_after: next,
    ...(detail ? {} : { more: "Pass gsm_id for one sample's files with their byte ranges, or detail=true (up to 25 samples a page) for every sample's." }),
  };
  const text = selected
    ? `${gse}: ${selected.modalities.join(", ")} of these ${page.length} samples is ${fmtBytes(selected.bytes)} of ${fmtBytes(selected.object_bytes)} (format ${FORMAT}, rev ${s.rev}).${next ? `\nMore samples: pass after=${next}.` : ""}`
    : `${gse}: ${fmt(s.n_samples)} sample objects, ${fmtBytes(s.bytes)}, ${kinds.length} files each (format ${FORMAT}, rev ${s.rev}). Manifest: ${s1ManifestUrl(gse)}${next ? `\nMore samples: pass after=${next}.` : ""}`;
  return toolResult(text, structured);
}

function sampleLine(r: S1SampleFull) {
  return { gsm_id: r.gsm_id, key: r.key, bytes: r.bytes, sha256: r.sha256, n_columns: r.n_columns, n_called: r.n_called, median_umi: r.median_umi, median_genes: r.median_genes };
}

// ── get_modalities ──────────────────────────────────────────────────────────

export async function s1Modalities(ctx: S1ToolCtx, gse: string, gsm: string, state: S1State, args: Record<string, unknown>): Promise<ToolResult> {
  const s = state.study;
  if (knownRev(args) === s.rev) return unchanged(gse, s.rev, "this study's modalities");
  const mods = modalitiesArg(args);
  if (isToolResult(mods)) return mods;
  const rows = (await listS1Samples(ctx.db, gse, s.rev, { limit: 500 })).filter((r) => !gsm || r.gsm_id === gsm);
  if (!rows.length) {
    return gsm ? toolError(`${gsm} is not in ${gse}. Samples are listed by list_bundle_files.`) : toolError(`${gse} has no samples in the catalog.`);
  }
  // only the modalities Alpha offers (./modalities): the catalog column also names layers that are not served, such as mt_variants
  const offered = new Set(MODALITIES.map((m) => m.name));
  const perSample = rows.map((r) => ({ gsm_id: r.gsm_id, modalities: parseModalities(r.modalities).filter((n) => offered.has(n)) }));
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
    manifest_url: s1ManifestUrl(gse),
    study_url: `${SITE}/study/${gse}`,
    ...(await loadBlock(ctx, gse, gsm, s.rev, perSample, mods?.names ?? null)),
  };
  const lines = [
    `${gse} carries ${present.length} modalit${present.length === 1 ? "y" : "ies"} across ${fmt(rows.length)} sample${rows.length === 1 ? "" : "s"}${s.reference_build ? ` (reference ${s.reference_build})` : ""}.`,
    "",
    ...present.map((m) => `- ${m.name} (${m.kind}, ${(counts.get(m.name) ?? 0) === rows.length ? "all samples" : `${counts.get(m.name)}/${rows.length} samples`}) — ${m.description}`),
  ];
  if (missing.length) lines.push("", `Not in this study: ${missing.join(", ")}.`);
  return toolResult(lines.join("\n"), structured);
}

/**
 * What `singlet.load(..., modalities=...)` can fetch here: each load modality with the members it needs and how many samples have
 * them (from the compact column). With `modalities` only those; with a gsm_id also that sample's byte ranges for the selection.
 */
async function loadBlock(ctx: S1ToolCtx, gse: string, gsm: string, rev: string, perSample: { modalities: string[] }[], names: string[] | null) {
  const want = names ?? OFFERED_LOAD_MODALITY_NAMES;
  const load_modalities = want.map((n) => {
    const m = loadModality(n)!;
    const nSamples = perSample.filter((p) => m.catalog.every((c) => p.modalities.includes(c))).length;
    return { name: m.name, members: m.members, python: m.python, r: m.r, description: m.description, n_samples: nSamples };
  });
  const out: Record<string, unknown> = { load_modalities: names ? load_modalities : load_modalities.filter((m) => m.n_samples > 0) };
  if (names) {
    const absent = load_modalities.filter((m) => m.n_samples === 0).map((m) => m.name);
    if (absent.length) out.load_missing = absent;
    out.load = loadSnippets(gse, gsm || null, names);
    if (gsm) {
      const sample = await getS1Sample(ctx.db, gse, gsm, rev);
      if (sample) out.selection = selectionOut(selectMembers(parseMembers(sample.members_json), names), sampleObjectUrl(sample.key), sample.bytes);
    }
  }
  return out;
}

// ── find_cells ──────────────────────────────────────────────────────────────

const SAMPLE_FILTER_KEYS = ["min_called", "max_called", "min_median_umi", "min_median_genes", "organism", "tissue_group", "disease_group", "assay_family", "include_low_qc", ...LABEL_FILTER_FIELDS] as const;

/** cell_labels: per-cell label filters answered by the atlas cell index (POST /s1/cidx/query, data Worker). */
const CELL_LABEL_KEYS = ["cell_type", "sex", "ancestry"] as const;
export type CellLabels = Partial<Record<(typeof CELL_LABEL_KEYS)[number], string[]>>;
const SEXES = new Set(["female", "male", "ambiguous", "unknown"]);
/** Cells per cell-index answer (its cap, docs/format-s1-cell-index.md 6.3). */
const CIDX_MAX_CELLS = 10_000;

function parseCellLabels(input: unknown): { labels: CellLabels | null } | { error: string } {
  if (input === undefined || input === null) return { labels: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "cell_labels must be an object" };
  const out: CellLabels = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(CELL_LABEL_KEYS as readonly string[]).includes(k)) return { error: `unknown key '${k}' (allowed: ${CELL_LABEL_KEYS.join(", ")})` };
    const vals = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
    if (!vals.length || vals.length > 20 || vals.some((x) => x.length > 200)) return { error: `${k} takes 1-20 ontology ids or labels` };
    if (k === "sex" && vals.some((x) => !SEXES.has(x.toLowerCase()))) return { error: "sex takes female, male, ambiguous or unknown" };
    out[k as keyof CellLabels] = k === "sex" ? vals.map((x) => x.toLowerCase()) : vals;
  }
  return { labels: Object.keys(out).length ? out : null };
}

/** The label columns the transcode writes into every sample's cells table (Singlet-Bio/singlet labels_step CELLS_LABEL_COLUMNS). */
const CELLS_LABEL_COLUMNS = ["cell_type_cl", "cell_type_label", "cell_type_path", "sex_chrom", "ancestry_hancestro"] as const;

interface ResolvedLabels {
  /** CL ids asked for, and the ids of the labels asked for (label_term, the labeller's vocabulary). */
  cellTypeIds: Set<string>;
  /** Labels with no id in label_term: matched against cell_type_label as written. */
  cellTypeLabels: Set<string>;
  sexes: Set<string> | null;
  ancestryIds: Set<string> | null;
}

/** Ontology ids for the labels asked for: an id stays an id; a label is looked up in label_term (and the HANCESTRO groups). */
export async function resolveLabels(db: D1Database, labels: CellLabels): Promise<ResolvedLabels> {
  const isId = (v: string) => /^[a-z]+:\d+$/i.test(v);
  const names = [...(labels.cell_type ?? []), ...(labels.ancestry ?? [])].filter((v) => !isId(v)).map((v) => v.toLowerCase());
  const byLabel = new Map<string, string[]>();
  for (const [id, label] of Object.entries(HANCESTRO_LABELS)) byLabel.set(label.toLowerCase(), [id]);
  if (names.length) {
    try {
      const rs = await db
        .prepare(`SELECT term_id, lower(label) AS label FROM label_term WHERE lower(label) IN (${names.map(() => "?").join(",")})`)
        .bind(...names)
        .all<{ term_id: string; label: string }>();
      for (const r of rs.results ?? []) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r.term_id]);
    } catch (e) {
      if (!/no such table/i.test(String(e))) throw e;
    }
  }
  const cellTypeIds = new Set<string>();
  const cellTypeLabels = new Set<string>();
  for (const v of labels.cell_type ?? []) {
    if (isId(v)) cellTypeIds.add(v.toUpperCase());
    else {
      const ids = byLabel.get(v.toLowerCase());
      if (ids) ids.forEach((x) => cellTypeIds.add(x));
      else cellTypeLabels.add(v.toLowerCase());
    }
  }
  const ancestryIds = labels.ancestry
    ? new Set(labels.ancestry.flatMap((v) => (isId(v) ? [v.toUpperCase()] : byLabel.get(v.toLowerCase()) ?? [v])))
    : null;
  return { cellTypeIds, cellTypeLabels, sexes: labels.sex ? new Set(labels.sex) : null, ancestryIds };
}

/**
 * Rows of a cells table that carry the labels, read from its own label columns; null when the table has none (an object written before
 * the labels moved into the cells table), so the caller asks the atlas cell index instead. A cell type id matches any level of the call
 * (cell_type_path, or cell_type_cl in tables without a path), so a query for T cell finds CD4 and CD8 T cells.
 */
export async function labelMaskFromTable(table: CellsTable, want: ResolvedLabels, labels: CellLabels, line?: CellLine): Promise<Uint8Array | null> {
  const needs: string[] = [];
  if (labels.cell_type && !line) needs.push(table.has("cell_type_path") ? "cell_type_path" : "cell_type_cl", "cell_type_label");
  if (labels.sex) needs.push("sex_chrom");
  if (labels.ancestry) needs.push("ancestry_hancestro");
  for (const c of needs) if (!table.has(c) || table.info(c)!.dtype !== DT_STR) return null;
  const n = table.nRows;
  const mask = new Uint8Array(n).fill(1);
  if (labels.cell_type && line) {
    if (!lineMatches(line, want)) mask.fill(0);
  } else if (labels.cell_type) {
    const pathCol = table.has("cell_type_path") ? await table.strings("cell_type_path") : await table.strings("cell_type_cl");
    const labelCol = await table.strings("cell_type_label");
    for (let i = 0; i < n; i++) {
      const levels = pathCol[i] ? pathCol[i].split(">") : [];
      const ok = levels.some((x) => want.cellTypeIds.has(x)) || want.cellTypeLabels.has(labelCol[i].toLowerCase());
      if (!ok) mask[i] = 0;
    }
  }
  if (want.sexes) {
    const col = await table.strings("sex_chrom");
    for (let i = 0; i < n; i++) if (mask[i] && !want.sexes.has(col[i] ? col[i].toLowerCase() : "unknown")) mask[i] = 0;
  }
  if (want.ancestryIds) {
    const col = await table.strings("ancestry_hancestro");
    for (let i = 0; i < n; i++) if (mask[i] && !want.ancestryIds.has(col[i])) mask[i] = 0;
  }
  return mask;
}

/**
 * A cell-line sample's cells all carry the line as their cell type, not the labeller's call (trained on primary tissue, it is often
 * wrong on cultured lines): they match the line's id or name, or "cultured cell" (CL:0000010).
 */
export function lineMatches(line: CellLine, want: ResolvedLabels): boolean {
  const ids = [line.id, CULTURED_CELL];
  const names = [line.label.toLowerCase(), line.id.toLowerCase(), "cultured cell"];
  return ids.some((x) => want.cellTypeIds.has(x)) || names.some((x) => want.cellTypeLabels.has(x));
}

interface LabelCells {
  cols: Map<string, Set<number>>;
  eligible: number | null;
  returned: number;
  complete: boolean;
  version: string | null;
}

/** The cells of these samples that carry the labels, from the atlas cell index (one POST; a seeded sample of at most 10,000 cells). */
async function cidxLabelCells(gsms: string[], labels: CellLabels): Promise<LabelCells | { error: string }> {
  let res: Response;
  try {
    res = await fetch(s1Url("s1/cidx/query"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ where: { samples: gsms, ...labels }, return: "cells", n: CIDX_MAX_CELLS, seed: 0 }),
    });
  } catch (e) {
    return { error: `the atlas cell index did not answer (${e instanceof Error ? e.message : String(e)})` };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* a non-JSON answer is reported by its status below */
  }
  if (!res.ok) {
    const msg = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    return { error: `the atlas cell index refused the query: ${msg}` };
  }
  const cells = (body.cells ?? {}) as { gsm?: unknown; col?: unknown };
  const g = Array.isArray(cells.gsm) ? (cells.gsm as unknown[]) : [];
  const c = Array.isArray(cells.col) ? (cells.col as unknown[]) : [];
  const cols = new Map<string, Set<number>>();
  const returned = Math.min(g.length, c.length);
  for (let i = 0; i < returned; i++) {
    const gsm = String(g[i]);
    const col = Number(c[i]);
    if (!Number.isInteger(col) || col < 0) continue;
    let set = cols.get(gsm);
    if (!set) cols.set(gsm, (set = new Set()));
    set.add(col);
  }
  const eligible = typeof body.eligible === "number" ? body.eligible : null;
  return { cols, eligible, returned, complete: eligible === null || eligible <= returned, version: typeof body.version === "string" ? body.version : null };
}

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

export async function findCells(ctx: S1ToolCtx, args: Record<string, unknown>, opts: { maxRequests?: number } = {}): Promise<ToolResult> {
  const maxRequests = opts.maxRequests ?? MAX_REQUESTS;
  // scope
  const gseIds = Array.isArray(args.gse_ids) ? [...new Set((args.gse_ids as unknown[]).map((v) => String(v).trim().toUpperCase()))].filter((v) => GSE_RE.test(v)) : [];
  const gsmIds = Array.isArray(args.gsm_ids) ? [...new Set((args.gsm_ids as unknown[]).map((v) => String(v).trim().toUpperCase()))].filter((v) => GSM_RE.test(v)) : [];
  if (gseIds.length > 20) return toolError("gse_ids takes at most 20 studies.");
  if (gsmIds.length > 50) return toolError("gsm_ids takes at most 50 samples.");
  const sf = (args.sample_filter && typeof args.sample_filter === "object" && !Array.isArray(args.sample_filter) ? args.sample_filter : {}) as Record<string, unknown>;
  for (const k of Object.keys(sf)) if (!(SAMPLE_FILTER_KEYS as readonly string[]).includes(k)) return toolError(`Unknown sample_filter key '${k}'. Use ${SAMPLE_FILTER_KEYS.join(", ")}.`);
  const scoped = gseIds.length > 0 || gsmIds.length > 0 || Object.keys(sf).some((k) => k !== "include_low_qc");
  const lab = parseCellLabels(args.cell_labels);
  if ("error" in lab) return toolError(`cell_labels: ${lab.error}`);
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
    // served only: a migration row that says verified or retired (a study with no migration row is not served)
    `EXISTS (SELECT 1 FROM s1_migration m WHERE m.gse_id = s.gse_id AND m.status IN ('verified', 'retired'))`,
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
  // the .s1 label facts of the sample (./s1-labels): a sample-level scope, before any cell is read
  for (const k of LABEL_FILTER_FIELDS) {
    const raw = sf[k];
    if (raw === undefined) continue;
    const vals = normalizeLabelValues((Array.isArray(raw) ? raw : [raw]).map((v) => String(v)));
    if (!vals.length) return toolError(`sample_filter.${k} needs a value.`);
    const m = labelMatchSql("la", "value_norm", vals);
    where.push(`s.gsm_id IN (SELECT la.gsm_id FROM sample_attr la WHERE la.source = 'pipeline' AND la.attr = '${LABEL_FILTERS[k]}' AND ${m.sql})`);
    bind.push(...m.params);
  }
  where.push(`EXISTS (SELECT 1 FROM sample_qc q WHERE q.gsm_id = s.gsm_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) <= ${sf.include_low_qc === true ? 1 : 0})`);
  // Samples that are not part of the atlas and withheld studies (./alpha) are never searched.
  where.push(sampleServedSql("s.gsm_id"), studyServedSql("s.gse_id"));
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
           FROM s1_sample s
           JOIN s1_study st ON st.gse_id = s.gse_id AND st.rev = s.rev
           ${joinGsm ? "JOIN gsm g ON g.gsm_id = s.gsm_id" : ""}
          WHERE ${where.join(" AND ")}
          ORDER BY s.gse_id, s.gsm_id
          LIMIT ?`
      )
      .bind(...bind, limit + 1)
      .all<SampleRow>();
    rows = rs.results ?? [];
  } catch (e) {
    if (/no such table/i.test(String(e))) return toolError("No study has been migrated to the per-sample format yet, so there are no per-cell tables to search.");
    throw e;
  }
  const more = rows.length > limit;
  rows = rows.slice(0, limit);
  if (!rows.length) {
    return toolResult("No sample matches that sample scope. find_cells searches studies that have been migrated to the per-sample format.", {
      format: FORMAT, samples_scanned: 0, results: [], errors: [], requests: 0, next_after: null, cell_filter: filter,
    });
  }

  // 2. the per-cell labels asked for: from each cells table's own label columns; for an object without them, from the atlas cell index
  const wanted = lab.labels ? await resolveLabels(ctx.db, lab.labels) : null;
  const lines = lab.labels?.cell_type ? await cellLinesOf(ctx.db, rows.map((r) => r.gsm_id)) : new Map<string, CellLine>();
  let labelCells: LabelCells | null = null;
  let fromTables = 0;
  const deferred: { r: SampleRow; table: CellsTable }[] = [];

  // 3. each sample's cells table, at most MAX_REQUESTS reads in all, 6 at a time
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
          const member = parseJsonObject(r.cells_member) as S1Member | null;
          if (!member || member.kind !== 2) throw new Error("the sample has no cells table");
          const url = sampleObjectUrl(r.key);
          const table = await openCells((off, len) => fetchObjectRange(url, member.off + off, len), member.len, { wholeMax: WHOLE_MAX });
          let allow: Uint8Array | null = null;
          if (lab.labels && wanted) {
            allow = await labelMaskFromTable(table, wanted, lab.labels, lines.get(r.gsm_id));
            if (!allow) return { ok: true as const, r, table, out: null };
          }
          const out = await filterCells(table, filter, { maxRuns, allow });
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
      if (!d.out) {
        deferred.push({ r: d.r, table: d.table });
        continue;
      }
      if (lab.labels) fromTables++;
      if (d.out.nMatch > 0) {
        const runs: [number, number][] = [];
        for (let k = 0; k < d.out.runs.length; k += 2) runs.push([d.out.runs[k], d.out.runs[k + 1]]);
        results.push({ gse_id: d.r.gse_id, gsm_id: d.r.gsm_id, rev: d.r.study_rev, n_columns: d.out.nRows, n_called: d.r.n_called, n_match: d.out.nMatch, runs, runs_truncated: d.out.runsTruncated });
      }
    }
  }
  // objects without label columns: one cell-index request for all of them
  if (deferred.length && lab.labels) {
    // a cell-line sample answers its cell-type filter from its line (lineMatches); the index is asked only for its other labels
    const otherLabels: CellLabels = { ...lab.labels };
    delete otherLabels.cell_type;
    const lineGsms = deferred.filter((x) => lines.has(x.r.gsm_id) && lineMatches(lines.get(x.r.gsm_id)!, wanted!)).map((x) => x.r.gsm_id);
    const plain = deferred.filter((x) => !lines.has(x.r.gsm_id)).map((x) => x.r.gsm_id);
    const li: LabelCells | { error: string } = plain.length
      ? await cidxLabelCells(plain, lab.labels)
      : { cols: new Map(), eligible: 0, returned: 0, complete: true, version: null };
    if (lineGsms.length && !("error" in li)) {
      const lo = Object.keys(otherLabels).length ? await cidxLabelCells(lineGsms, otherLabels) : null;
      requests += lo ? 1 : 0;
      if (lo && "error" in lo) for (const g of lineGsms) li.cols.delete(g);
      for (const x of deferred) {
        if (!lineGsms.includes(x.r.gsm_id)) continue;
        li.cols.set(x.r.gsm_id, lo && !("error" in lo) ? (lo.cols.get(x.r.gsm_id) ?? new Set()) : new Set(Array.from({ length: x.table.nRows }, (_, c) => c)));
      }
    }
    requests += 1;
    if ("error" in li) {
      for (const x of deferred) errors.push({ gse_id: x.r.gse_id, gsm_id: x.r.gsm_id, error: `no label columns, and ${li.error}`.slice(0, 200) });
    } else {
      labelCells = li;
      for (const x of deferred) {
        const allow = new Uint8Array(x.table.nRows);
        for (const c of li.cols.get(x.r.gsm_id) ?? []) if (c < allow.length) allow[c] = 1;
        try {
          const out = await filterCells(x.table, filter, { maxRuns, allow });
          requests += 0;
          if (out.nMatch > 0) {
            const runs: [number, number][] = [];
            for (let k = 0; k < out.runs.length; k += 2) runs.push([out.runs[k], out.runs[k + 1]]);
            results.push({ gse_id: x.r.gse_id, gsm_id: x.r.gsm_id, rev: x.r.study_rev, n_columns: out.nRows, n_called: x.r.n_called, n_match: out.nMatch, runs, runs_truncated: out.runsTruncated });
          }
        } catch (e) {
          errors.push({ gse_id: x.r.gse_id, gsm_id: x.r.gsm_id, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        }
      }
      results.sort((a, b) => (a.gse_id === b.gse_id ? (a.gsm_id < b.gsm_id ? -1 : 1) : a.gse_id < b.gse_id ? -1 : 1));
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
    ...(lab.labels
      ? {
          cell_labels: {
            labels: lab.labels,
            samples_from_cells_table: fromTables,
            ...(labelCells
              ? {
                  cell_index: {
                    samples: deferred.length,
                    index_version: labelCells.version,
                    cells_labelled: labelCells.eligible,
                    cells_returned: labelCells.returned,
                    complete: labelCells.complete,
                  },
                }
              : {}),
            note:
              !labelCells || labelCells.complete
                ? "Every cell of these samples with these labels was considered."
                : `For samples without label columns the cell index returned a seeded uniform sample of ${fmt(labelCells.returned)} of ${fmt(labelCells.eligible ?? 0)} labelled cells; ask for fewer samples to cover them all.`,
          },
        }
      : {}),
    next_after: nextAfter,
    next: results.length ? `slice_cells with gse_id, gsm_id and runs gives the byte ranges of those cells' matrix chunks.` : null,
  };
  const textOut = `${fmt(cells)} cells match in ${results.length} of ${scanned} samples scanned (${requests} reads of the data host).${nextAfter ? ` More samples: pass after="${nextAfter}".` : ""}${errors.length ? ` ${errors.length} samples could not be read.` : ""}`;
  return toolResult(textOut, structured);
}

// ── slice_cells ─────────────────────────────────────────────────────────────

export async function sliceCells(ctx: S1ToolCtx, args: Record<string, unknown>): Promise<ToolResult> {
  const gse = gseOf(args);
  const gsm = gsmOf(args);
  if (!gse) return toolError("`gse_id` must be a GEO series accession like GSE200901.");
  if (!gsm) return toolError("`gsm_id` must be a GEO sample accession like GSM4746717.");
  const mods = modalitiesArg(args);
  if (isToolResult(mods)) return mods;
  if (mods && (args.file !== undefined || args.files !== undefined)) return toolError("Give `file` or `modalities`, not both.");
  let wantFiles = Array.isArray(args.files)
    ? (args.files as unknown[]).map((v) => String(v).trim()).filter(Boolean).slice(0, 4)
    : typeof args.file === "string" && args.file.trim()
      ? [args.file.trim()]
      : ["exon_counts.1pz", "intron_counts.1pz"];

  const state = await getS1State(ctx.db, gse);
  if (!state) return toolError(`${gse} is not in the per-sample format yet, so cells cannot be sliced by chunk. Use get_partial_download for the legacy file.`);
  const sample = await getS1Sample(ctx.db, gse, gsm, state.study.rev);
  if (!sample) return toolError(`${gsm} is not in ${gse}. Use list_bundle_files to see which samples are.`);

  const members = parseMembers(sample.members_json);
  const url = sampleObjectUrl(sample.key);
  const maxRanges = count(args.max_ranges, 64, 1, 200);

  const files: Record<string, unknown>[] = [];
  const skipped: { file: string; reason: string }[] = [];
  if (mods) {
    // the matrices of these modalities (the cells table is listed as cells_table below)
    const sel = selectMembers(members, mods.names);
    wantFiles = sel.files.filter((f) => f.name !== "cells").map((f) => f.name);
    for (const m of sel.missing) skipped.push({ file: m, reason: "this sample does not have it" });
    if (!wantFiles.length) return toolError(`${gsm} has none of ${mods.names.join(", ")}. It has: ${sampleLoadModalities(members).join(", ") || "no matrices"}.`);
  }
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
      if (e instanceof S1FetchError) return toolError(`Could not read ${name} of ${gsm}: ${e.message}`);
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
    ...(mods ? { modalities: mods.names, load: loadSnippets(gse, gsm, mods.names) } : {}),
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
  const res = await fetch(s1PackIndexUrl(), { cf: { cacheEverything: true, cacheTtl: 300 } } as RequestInit);
  if (!res.ok) throw new S1FetchError(`pack index answered ${res.status}`, res.status);
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
  const res = await fetch(s1PackUrl(id32), { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit);
  if (!res.ok) throw new S1FetchError(`pack ${id32} answered ${res.status}`, res.status);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > 32 * 1024 * 1024) throw new S1FetchError(`pack ${id32} is too large`);
  return new Uint8Array(await res.arrayBuffer());
};

export async function resolveFeatures(ctx: S1ToolCtx, args: Record<string, unknown>, deps: { fetchPack?: PackFetcher; loadIndex?: () => Promise<PackIndexEntry[]> } = {}): Promise<ToolResult> {
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
    const sample = await getS1Sample(ctx.db, gse, gsm);
    if (!sample) return toolError(`${gsm} is not in ${gse} in the catalog.`);
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
    if (e instanceof PackError || e instanceof S1FetchError) return toolError(`Could not resolve: ${e.message}`);
    throw e;
  }
}
