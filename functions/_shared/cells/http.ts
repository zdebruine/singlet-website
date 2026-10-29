/**
 * The HTTP side of cell search: /api/cells (query, also natural language), /api/cells/slice (pages of cells) and /api/cells/fields
 * (the vocabulary with coverage). Requests are read the same way for GET and POST:
 *
 *   where=<JSON filter>        tree or flat form (./query.ts parseWhere)
 *   <field>=a|b, not_<field>=x flat filters as parameters (AND-ed; | ORs values; numbers as min..max)
 *   q=<plain English>          read by ./nl.ts (vocabulary first; the catalog interpreter for words it cannot place, ai=0 to skip)
 *   include_low_qc=1, limit=, offset=
 *
 * Answers are edge-cached by their canonical query (Cache API, 5 minutes), so a repeated question costs one cache read.
 */
import { cachedJson, NO_CACHE_HEADER } from "../cache";
import { CORS_HEADERS } from "../cors";
import type { AppEnv, WaitUntil } from "../env";
import type { Identity } from "../identity";
import { interpretQuery } from "../interpret";
import { loadRules } from "../vocab";
import { configureS1, s1Url } from "../s1-urls";
import { cellIndex, type CellIndex } from "./atlas-index";
import { FIELDS, fieldDef, UNAVAILABLE } from "./fields";
import { parseCellQuestion, toWhere, type Reading } from "./nl";
import { canonicalWhere, cellPushdown, joinOf, labelIdsFor, leavesOf, parseWhere, QueryError, relaxations, rowScanWhere, runCellQuery, type CellQuery, type Expr } from "./query";
import { sampleFacts, type SampleFacts } from "./sample-facts";
import { PAGE_CELLS_MAX, slicePage, slicePython } from "./slice";

export const CELLS_CACHE_TTL = 300;
const RESERVED = new Set(["where", "q", "include_low_qc", "limit", "offset", "ai", "cursor", "page_cells", "modalities", "format"]);

export const LABEL_CAVEATS = [
  "Cell types are the .s1 labeller's calls (Cell Ontology), validated per study at four depths: compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32. Filters at cell-type and subtype depth are previews: expect many wrong calls there; lineage-level terms (T cell, B cell, myeloid cell) are the reliable ones.",
  "The calibrated cell-type model and its public benchmark against CellTypist, scANVI, Seurat mapping and SingleR (Singlet-Bio/singlet#32, #44) are research-beta work, not merged; Alpha serves the forced labels described above.",
  "Chromosomal sex is called per cell from XIST and chrY expression; at sample level it agrees with GEO's recorded sex for 98.1% of samples. A cell without enough signal is 'unknown' and a mixed call 'ambiguous'.",
  "Genetic ancestry is called only for human donors with enough covered sites, so most cells have none: an ancestry filter covers a small part of the atlas. Genotypes are never stored or served.",
  "Tissue, disease and developmental stage are sample facts mapped from GEO text to UBERON / MONDO / HsapDv-MmusDv: a cell inherits its sample's terms, and samples whose GEO record does not say are 'not recorded'.",
];

export interface ParsedRequest {
  query: CellQuery;
  q: string | null;
  ai: boolean;
  pageCells: number;
  cursor: string | null;
  modalities: string[] | null;
}

function int(v: unknown, d: number, lo: number, hi: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : d;
}

/** GET parameters and/or a JSON body into one request. */
export function parseCellRequest(url: URL, body: Record<string, unknown> | null): ParsedRequest {
  const get = (k: string): unknown => (body && body[k] !== undefined ? body[k] : (url.searchParams.get(k) ?? undefined));
  const parts: Expr[] = [];
  const where = get("where");
  const parsed = parseWhere(where ?? null);
  if (parsed) parts.push(parsed);
  // flat field parameters
  const flat: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => {
    if (!RESERVED.has(k)) flat[k] = (flat[k] ? `${flat[k]}|` : "") + v;
  });
  for (const [k, v] of Object.entries(body ?? {})) if (!RESERVED.has(k)) flat[k] = v;
  if (Object.keys(flat).length) parts.push(parseWhere(flat)!);
  const q = typeof get("q") === "string" && (get("q") as string).trim() ? (get("q") as string).trim().slice(0, 500) : null;
  const low = get("include_low_qc");
  const mods = get("modalities");
  return {
    query: {
      where: parts.length === 0 ? null : parts.length === 1 ? parts[0] : { and: parts },
      include_low_qc: low === true || low === "1" || low === "true",
      limit: int(get("limit"), 20, 1, 500),
      offset: int(get("offset"), 0, 0, 100_000),
    },
    q,
    ai: !(get("ai") === "0" || get("ai") === false),
    pageCells: int(get("page_cells"), 5000, 1, PAGE_CELLS_MAX),
    cursor: typeof get("cursor") === "string" ? (get("cursor") as string) : null,
    modalities: Array.isArray(mods) ? mods.map(String) : typeof mods === "string" && mods ? mods.split(/[|,]/) : null,
  };
}

/** The cache key of a request: its canonical filter, flags and paging (and the question, when there is one). */
export function cacheKey(p: ParsedRequest, extra = ""): string {
  const u = new URLSearchParams();
  if (p.query.where) u.set("w", canonicalWhere(p.query.where));
  if (p.q) u.set("q", p.q.toLowerCase().replace(/\s+/g, " "));
  if (p.query.include_low_qc) u.set("low", "1");
  u.set("l", String(p.query.limit));
  if (p.query.offset) u.set("o", String(p.query.offset));
  if (!p.ai) u.set("ai", "0");
  if (extra) u.set("x", extra);
  return u.toString();
}

export interface Inputs {
  idx: CellIndex;
  facts: SampleFacts;
  ms: { index: number; facts: number };
  cold: { index: boolean; facts: string };
}

let warmIndex = false;

export async function loadInputs(env: AppEnv, waitUntil: WaitUntil): Promise<Inputs> {
  configureS1(env);
  const t0 = Date.now();
  const wasWarm = warmIndex;
  const timed = <T,>(p: Promise<T>) => p.then((v) => [v, Date.now() - t0] as const);
  const [[idx, msIndex], [facts, msFacts]] = await Promise.all([timed(cellIndex()), timed(sampleFacts(env.DB, waitUntil))]);
  warmIndex = true;
  return { idx, facts, ms: { index: msIndex, facts: msFacts }, cold: { index: !wasWarm, facts: facts.source } };
}

/** The natural-language reading: vocabulary first, then the catalog interpreter for what is left (charged to the caller's AI allowance). */
export async function readQuestion(
  env: AppEnv,
  identity: Identity,
  waitUntil: WaitUntil,
  p: ParsedRequest,
  inputs: Inputs
): Promise<{ readings: Reading[]; unparsed: string[]; source: string; model?: string; note?: string; cacheable: boolean; where: Expr | null }> {
  const nl = parseCellQuestion(p.q!, inputs.idx, inputs.facts);
  let readings = nl.readings;
  let source = "vocabulary";
  let model: string | undefined;
  let note: string | undefined;
  let cacheable = true;
  const content = nl.unparsed.filter((w) => w.length > 2);
  if (content.length && p.ai) {
    const rules = await loadRules(env.DB, waitUntil);
    const r = await interpretQuery(env, { db: env.DB, rules, waitUntil }, identity, content.join(" "));
    if (r.degraded || r.quotaExceeded) cacheable = false;
    if (r.quotaExceeded) note = r.quotaExceeded.message;
    const i = r.interpreted;
    const add = (field: string, values: string[], text: string) => {
      if (!values.length || readings.some((x) => x.field === field)) return;
      const def = fieldDef(field)!;
      readings = [...readings, { text, field: def.name, level: def.level, values, labels: values, negated: false }];
    };
    const cts = i.cell_type.flatMap((c) => labelIdsFor(inputs.idx, inputs.facts, c));
    add("cell_type", cts, i.cell_type.join(", "));
    add("organism", i.organism.filter((o) => inputs.facts.vocab.organism.includes(o)), i.organism.join(", "));
    add("tissue_group", i.tissue_group.filter((t) => inputs.facts.vocab.tissue_group.includes(t)), i.tissue_group.join(", "));
    add("disease_group", i.disease_group.filter((t) => inputs.facts.vocab.disease_group.includes(t)), i.disease_group.join(", "));
    add("assay", i.assay_family.filter((t) => inputs.facts.vocab.assay.includes(t)), i.assay_family.join(", "));
    if (i.year_min !== null || i.year_max !== null) readings = [...readings, { text: "year", field: "year", level: "study", values: [`${i.year_min ?? ""}..${i.year_max ?? ""}`], labels: [], negated: false }];
    if (r.source !== "vocabulary") {
      source = `vocabulary+${r.source}`;
      model = r.model;
    }
  }
  const where = toWhere(readings.filter((r) => r.field !== "year"));
  const year = readings.find((r) => r.field === "year");
  const withYear: Expr | null = year ? (where ? { and: [where, parseWhere({ year: year.values[0] })!] } : parseWhere({ year: year.values[0] })) : where;
  const placed = new Set(readings.flatMap((r) => r.text.split(/[\s/,]+/)));
  return { readings, unparsed: nl.unparsed.filter((w) => !placed.has(w)), source, model, note, cacheable, where: withYear };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8", ...headers } });
}

/** Run a whole /api/cells request (no caching here). */
export async function cellSearchResponse(env: AppEnv, identity: Identity, waitUntil: WaitUntil, p: ParsedRequest): Promise<Response> {
  const t0 = Date.now();
  const inputs = await loadInputs(env, waitUntil);
  let nl: Awaited<ReturnType<typeof readQuestion>> | null = null;
  let where = p.query.where;
  if (p.q) {
    nl = await readQuestion(env, identity, waitUntil, p, inputs);
    where = nl.where && where ? { and: [nl.where, where] } : (nl.where ?? where);
  }
  const query: CellQuery = { ...p.query, where };
  const t1 = Date.now();
  const r = runCellQuery(query, inputs.idx, inputs.facts);
  const evalMs = Date.now() - t1;
  // per-cell ranges: the cell index's row scan (data Worker), on the samples with matching cells
  let rowScan: Record<string, unknown> | null = null;
  if (leavesOf(where).some((l) => fieldDef(l.field)?.rowScan)) {
    const gsms: string[] = [];
    r.perSample.forEach((c, i) => c > 0 && gsms.push(inputs.facts.gsm[i]));
    const w = rowScanWhere(where, inputs.idx, inputs.facts, gsms);
    const t = Date.now();
    const res = await fetch(s1Url("s1/cidx/query"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: inputs.idx.version, where: w, return: "count", by: ["study"] }),
    });
    const a = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    rowScan = res.ok
      ? { cells: a.count, complete: a.complete, cursor: a.cursor ?? null, rows_scanned: a.rows_scanned, by_study: ((a.groups as unknown[]) ?? []).slice(0, query.limit), ms: Date.now() - t, note: "Cells that also pass the per-cell ranges; the totals above count every cell of the other filters." }
      : { error: a.message ?? a.error ?? `HTTP ${res.status}` };
  }
  const rx = r.totals.cells === 0 ? relaxations(where, query.include_low_qc, inputs.idx, inputs.facts) : [];
  const params = new URLSearchParams();
  if (where) params.set("where", canonicalWhere(where));
  if (query.include_low_qc) params.set("include_low_qc", "1");
  const body = {
    query: { where: where ? JSON.parse(canonicalWhere(where)) : null, include_low_qc: query.include_low_qc, limit: query.limit, offset: query.offset },
    ...(nl ? { question: { q: p.q, readings: nl.readings, unparsed: nl.unparsed, source: nl.source, ...(nl.model ? { model: nl.model } : {}), ...(nl.note ? { note: nl.note } : {}) } } : {}),
    totals: r.totals,
    ...(rowScan ? { row_scan: rowScan } : {}),
    studies: r.studies,
    samples: r.samples,
    filters: r.filters,
    facets: r.facets,
    cell_type_lineage: r.cell_type_lineage,
    ...(rx.length ? { relaxations: rx } : {}),
    unmapped: unmappedFor(where, query.include_low_qc, inputs.idx, inputs.facts),
    slice: {
      url: `https://singlet.bio/api/cells/slice?${params}`,
      filtered: cellPushdown(where, inputs.idx, inputs.facts) ? "by the cell index" : "by the site (OR / NOT across cell fields)",
      python: slicePython("https://singlet.bio", JSON.stringify(paramsObject(params))),
    },
    basis: {
      index_version: inputs.idx.version,
      index_created_at: inputs.idx.created_at,
      facts_built_at: inputs.facts.built_at,
      release_policy: inputs.facts.policy,
      served: "QC-passed samples of downloadable studies, Research Alpha exclusions applied (include_low_qc adds low-QC samples)",
    },
    caveats: LABEL_CAVEATS,
    timing: { total_ms: Date.now() - t0, eval_ms: evalMs, inputs_ms: Math.max(inputs.ms.index, inputs.ms.facts), index_cold: inputs.cold.index, facts_source: inputs.cold.facts },
  };
  const headers: Record<string, string> = {
    "Server-Timing": `inputs;dur=${Math.max(inputs.ms.index, inputs.ms.facts)}, eval;dur=${evalMs}, total;dur=${Date.now() - t0}`,
    "X-Cell-Index": inputs.idx.version,
  };
  if (nl && !nl.cacheable) headers[NO_CACHE_HEADER] = "1";
  return json(200, body, headers);
}

export async function sliceResponse(env: AppEnv, request: Request, waitUntil: WaitUntil, p: ParsedRequest, identity: Identity): Promise<Response> {
  const inputs = await loadInputs(env, waitUntil);
  let where = p.query.where;
  if (p.q) {
    const nl = parseCellQuestion(p.q, inputs.idx, inputs.facts);
    where = nl.where && where ? { and: [nl.where, where] } : (nl.where ?? where);
  }
  const query: CellQuery = { ...p.query, where, offset: 0 };
  const r = runCellQuery(query, inputs.idx, inputs.facts);
  rowScanWhere(where, inputs.idx, inputs.facts, []); // refuses ranges the index cannot apply
  const page = await slicePage(query, r, inputs.idx, inputs.facts, {
    pageCells: p.pageCells,
    cursor: p.cursor,
    modalities: p.modalities,
    // only a personal API key means something to the data Worker (an MCP OAuth token does not)
    authorization: /^Bearer sk_live_/.test(request.headers.get("authorization") ?? "") ? request.headers.get("authorization") : null,
  });
  void identity;
  const params = new URLSearchParams();
  if (where) params.set("where", canonicalWhere(where));
  if (query.include_low_qc) params.set("include_low_qc", "1");
  params.set("page_cells", String(p.pageCells));
  return json(200, { ...page, python: slicePython("https://singlet.bio", JSON.stringify(paramsObject(params))) }, { "Cache-Control": "no-store" });
}

/** Sample-level fields a served sample can lack (the facts have no value for it). */
export const UNMAPPABLE = [
  "tissue", "disease", "development_stage", "donor_sex", "donor_ancestry", "sorted_cell_type", "age_years", "organism", "assay", "chemistry",
  "tissue_group", "disease_group", "donor_status", "perturbation", "sample_kind", "tissue_type", "tumor_sample_type", "cell_line",
] as const;
const TERM_ATTR: Record<string, string> = { tissue: "tissue", disease: "disease", development_stage: "development_stage", donor_sex: "sex", donor_ancestry: "ancestry", sorted_cell_type: "cell_type", cell_line: "cell_line" };

/** Whether served sample i carries any value for a sample-level field; null for fields every sample has and for cell-level fields. */
export function sampleFieldHas(name: string, facts: SampleFacts): ((i: number) => boolean) | null {
  const attr = TERM_ATTR[name];
  if (attr) {
    const has = new Uint8Array(facts.n);
    for (const list of facts.termSamples.get(attr)?.values() ?? []) for (const i of list) has[i] = 1;
    return (i) => has[i] === 1;
  }
  switch (name) {
    case "age_years": return (i) => facts.age[i] !== null;
    case "organism": return (i) => facts.organism[i] >= 0;
    case "assay": return (i) => facts.assay[i] >= 0 && facts.vocab.assay[facts.assay[i]] !== "Unknown";
    case "chemistry": return (i) => facts.chemistry[i] >= 0 && !/^(unknown|other)$/.test(facts.vocab.chemistry[facts.chemistry[i]]);
    case "tissue_group": return (i) => facts.tissue_group[i] >= 0;
    case "disease_group": return (i) => facts.disease_group[i] >= 0;
    case "donor_status": return (i) => facts.donor_status[i] > 0;
    case "perturbation": return (i) => facts.perturbation[i] > 0;
    case "sample_kind": return (i) => facts.sample_kind[i] > 0;
    case "tissue_type": return (i) => (facts.tissue_type?.[i] ?? 0) > 0;
    case "tumor_sample_type": return (i) => (facts.tumor_sample_type?.[i] ?? 0) > 0;
    default: return null;
  }
}

/**
 * The gap behind each sample-level filter of a query: served samples (and their cells) with no value for the field. Such samples can never
 * match the filter (and always pass a NOT on it), so an agent should know how much of the atlas a filter cannot see.
 */
export function unmappedFor(where: Expr | null, includeLowQc: boolean, idx: CellIndex, facts: SampleFacts) {
  const fields = [...new Set(leavesOf(where).map((l) => l.field))].filter((f) => (UNMAPPABLE as readonly string[]).includes(f));
  if (!fields.length) return [];
  const { siCells } = joinOf(idx, facts);
  const served: number[] = [];
  for (let i = 0; i < facts.n; i++) if (facts.qc_tier[i] === 0 || (includeLowQc && facts.qc_tier[i] === 1)) served.push(i);
  const totalCells = served.reduce((s, i) => s + siCells[i], 0);
  return fields.map((field) => {
    const has = sampleFieldHas(field, facts)!;
    let samples = 0;
    let cells = 0;
    for (const i of served) if (!has(i)) (samples++, (cells += siCells[i]));
    return { field, samples, cells, samples_share: round(samples / Math.max(served.length, 1)), cells_share: round(cells / Math.max(totalCells, 1)) };
  });
}

/** The vocabulary with live coverage: per field, how many served samples and cells carry a value. */
export function fieldsBody(inputs: Inputs): Record<string, unknown> {
  const { idx, facts } = inputs;
  const n = facts.n;
  const r = runCellQuery({ where: null, include_low_qc: false, limit: 1, offset: 0 }, idx, facts);
  const per = r.perSample;
  const totalCells = r.totals.cells;
  const passSamples = facts.qc_tier.filter((t) => t === 0).length;
  const sampleCov = (has: (i: number) => boolean) => {
    let s = 0;
    let c = 0;
    for (let i = 0; i < n; i++) if (facts.qc_tier[i] === 0 && has(i)) (s++, (c += per[i]));
    return { samples: s, samples_share: round(s / passSamples), cells: c, cells_share: round(c / totalCells) };
  };
  const cellCov = (facet: { value: string; cells: number }[]) => {
    const known = facet.filter((x) => x.value !== "unknown" && x.value !== "ambiguous").reduce((s, x) => s + x.cells, 0);
    return { cells: known, cells_share: round(known / totalCells) };
  };
  const has = (name: string) => sampleFieldHas(name, facts) ?? (() => true);
  const cov: Record<string, unknown> = {
    cell_type: cellCov(r.facets.cell_type),
    sex: cellCov(r.facets.sex),
    ancestry: cellCov(r.facets.ancestry),
    ...Object.fromEntries(UNMAPPABLE.map((f) => [f, sampleCov(has(f))])),
    median_umi: sampleCov((i) => facts.umi[i] !== null),
    median_genes: sampleCov((i) => facts.genes[i] !== null),
    mito_fraction: sampleCov((i) => facts.mito[i] !== null),
    cells_called: sampleCov((i) => facts.called[i] !== null),
    mapping_rate: sampleCov((i) => facts.mapping[i] !== null),
    qc: sampleCov(() => true),
    sample: sampleCov(() => true),
    study: sampleCov(() => true),
    year: sampleCov((i) => facts.year[i] !== null),
    has_publication: sampleCov((i) => facts.pub[i] === 1),
  };
  const values = (name: string): unknown => {
    const f = r.facets[name];
    if (name === "cell_type") return r.cell_type_lineage.slice(0, 60);
    return f ? f.slice(0, 60) : undefined;
  };
  return {
    fields: FIELDS.map((f) => ({
      name: f.name,
      level: f.level,
      kind: f.kind,
      ...(f.ontology ? { ontology: f.ontology } : {}),
      ...(f.values ? { values: f.values } : {}),
      ...(f.unit ? { unit: f.unit } : {}),
      ...(f.aliases ? { aliases: f.aliases } : {}),
      description: f.description,
      source: f.source,
      ...(f.rowScan ? { note: "per-cell range: counted by the cell index's row scan; AND-ed with plain cell filters only" } : {}),
      coverage: cov[f.name] ?? null,
      top_values: values(f.name),
    })),
    unavailable: UNAVAILABLE,
    syntax: {
      flat: '{"cell_type": "T cell", "sex": "female", "tissue": ["lung", "UBERON:0002048"], "age_years": [18, 65], "not": {"disease": "MONDO:0004992"}}',
      tree: '{"and": [{"field": "cell_type", "any": ["CL:0000084"]}, {"or": [{"field": "tissue", "any": ["lung"]}, {"field": "disease", "any": ["lung cancer"]}]}, {"not": {"field": "sex", "any": ["male"]}}]}',
      params: "/api/cells?cell_type=T%20cell|B%20cell&tissue=lung&not_disease=cancer&age_years=18..65",
      question: "/api/cells?q=female%20CD8%20T%20cells%20from%20adult%20lung%20tumours",
      ontology: "Ontology fields match a term and every descendant (exact: true for the term alone). Values are ontology ids or labels and synonyms.",
    },
    totals: { cells: totalCells, samples: passSamples, studies: r.totals.studies },
    basis: { index_version: idx.version, facts_built_at: facts.built_at, release_policy: facts.policy },
    caveats: LABEL_CAVEATS,
  };
}

function paramsObject(p: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  p.forEach((v, k) => (o[k] = v));
  return o;
}

const round = (x: number) => Math.round(x * 10000) / 10000;

export function errorResponse(e: unknown, where: string): Response {
  if (e instanceof QueryError) return json(400, { error: "bad_query", message: e.message, ...e.detail }, { "Cache-Control": "no-store" });
  console.error(`[cells ${where}]`, e instanceof Error ? (e.stack ?? e.message) : String(e));
  return json(503, { error: "unavailable", message: "Cell search could not answer right now. Try again in a minute." }, { "Cache-Control": "no-store" });
}

export { cachedJson };
