/**
 * Cohort queries over the bit index: the part of the grammar in docs/COHORT-QUERY.md that bitsets can answer.
 *
 *   { version: 1,
 *     include: [{ attr, any: [...] } | { attr, num: { min, max } }],
 *     exclude: [same],
 *     require: { min_cells, min_samples_per_study, qc_tier },
 *     sources: ["geo", "pipeline", "model>=0.8"],
 *     level: "study" | "sample" }
 *
 * AND across clauses, OR within `any`. An include needs a fact; an exclude removes only samples that carry a
 * matching fact, so a sample unknown on the attribute is never removed by it (and never admitted by an include).
 * How many samples that leaves out on each axis is reported as `unknown_by_attr`. Nothing here calls D1 or a
 * model; the index is the only input.
 */
import { AMBIGUITY_ATTRS, ATTR_BY_KEY } from "./cohort-schema";
import { andInto, andNotInto, parseSources, popcount, type BitIndex, type Summary } from "./bitindex";

export class CohortError extends Error {
  status = 400;
  constructor(message: string, readonly token?: string) {
    super(message);
  }
}

export interface Clause {
  attr: string;
  any?: string[];
  num?: { min?: number | null; max?: number | null };
}

export interface CohortQuery {
  version?: number;
  include?: Clause[];
  exclude?: Clause[];
  require?: { min_cells?: number; min_samples_per_study?: number; qc_tier?: number | number[] };
  sources?: string[];
  level?: "study" | "sample" | "cell";
}

export interface ParsedQuery {
  version: 1;
  include: Clause[];
  exclude: Clause[];
  require: { min_cells: number; min_samples_per_study: number; qc_tier: number[] };
  sources: string[];
  level: "study" | "sample";
}

export const MAX_CLAUSES = 24;
export const MAX_VALUES_PER_CLAUSE = 200;

// ── parse ───────────────────────────────────────────────────────────────────

function parseClause(raw: unknown, where: string): Clause {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CohortError(`${where} must be an object`, where);
  const c = raw as Record<string, unknown>;
  const attr = typeof c.attr === "string" ? c.attr.trim() : "";
  const spec = ATTR_BY_KEY[attr];
  if (!spec) throw new CohortError(`Unknown attribute '${attr || String(c.attr)}' in ${where}`, attr || String(c.attr));
  if (spec.kind === "cat") {
    if (!Array.isArray(c.any) || !c.any.length) throw new CohortError(`${where}: '${attr}' needs a non-empty "any" list`, attr);
    if (c.any.length > MAX_VALUES_PER_CLAUSE) throw new CohortError(`${where}: at most ${MAX_VALUES_PER_CLAUSE} values per clause`, attr);
    const any = c.any.map((v) => {
      if (typeof v !== "string" && typeof v !== "number") throw new CohortError(`${where}: values must be strings`, String(v));
      return String(v).trim();
    });
    return { attr, any: [...new Set(any.filter(Boolean))] };
  }
  const num = c.num as Record<string, unknown> | undefined;
  if (!num || typeof num !== "object") throw new CohortError(`${where}: '${attr}' is numeric and needs {"num": {"min": ..., "max": ...}}`, attr);
  const bound = (v: unknown, name: string): number | null => {
    if (v == null) return null;
    const x = Number(v);
    if (typeof v === "boolean" || !Number.isFinite(x)) throw new CohortError(`${where}: num.${name} must be a number`, name);
    return x;
  };
  const min = bound(num.min, "min");
  const max = bound(num.max, "max");
  if (min == null && max == null) throw new CohortError(`${where}: num needs min or max`, attr);
  if (min != null && max != null && min > max) throw new CohortError(`${where}: num.min is above num.max`, attr);
  return { attr, num: { min, max } };
}

export function parseCohortQuery(raw: unknown): ParsedQuery {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CohortError("The cohort query must be a JSON object");
  const q = raw as CohortQuery & Record<string, unknown>;
  if (q.version != null && q.version !== 1) throw new CohortError(`Unsupported query version ${String(q.version)}`, "version");
  const list = (v: unknown, name: string): Clause[] => {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new CohortError(`"${name}" must be an array`, name);
    return v.map((c, i) => parseClause(c, `${name}[${i}]`));
  };
  const include = list(q.include, "include");
  const exclude = list(q.exclude, "exclude");
  if (include.length + exclude.length > MAX_CLAUSES) throw new CohortError(`At most ${MAX_CLAUSES} clauses`);

  const req = (q.require ?? {}) as Record<string, unknown>;
  const nonNeg = (v: unknown, name: string): number => {
    if (v == null) return 0;
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new CohortError(`require.${name} must be a non-negative number`, name);
    return Math.floor(x);
  };
  let tiers: number[] = [0];
  if (req.qc_tier != null) {
    const t = (Array.isArray(req.qc_tier) ? req.qc_tier : [req.qc_tier]).map(Number);
    if (t.some((x) => x === 2)) throw new CohortError("QC tier 2 (removed) samples are never part of a cohort", "qc_tier");
    if (t.some((x) => x !== 0 && x !== 1)) throw new CohortError("require.qc_tier takes 0, 1 or both", "qc_tier");
    tiers = [...new Set(t)].sort();
    if (!tiers.length) throw new CohortError("require.qc_tier is empty", "qc_tier");
  }
  const sources = q.sources == null ? ["geo", "pipeline", "model>=0.8"] : q.sources;
  if (!Array.isArray(sources) || sources.some((s) => typeof s !== "string")) throw new CohortError(`"sources" must be an array of strings`, "sources");
  const bad = parseSources(sources as string[]).bad;
  if (bad.length) throw new CohortError(`Unknown source '${bad[0]}'. Use geo, pipeline, model or model>=<confidence>`, bad[0]);
  const level = q.level ?? "sample";
  if (level === "cell") throw new CohortError("Cell-level cohorts need per-cell labels, which are not in the index yet", "level");
  if (level !== "study" && level !== "sample") throw new CohortError(`Unknown level '${String(level)}'`, "level");

  return {
    version: 1,
    include,
    exclude,
    require: { min_cells: nonNeg(req.min_cells, "min_cells"), min_samples_per_study: nonNeg(req.min_samples_per_study, "min_samples_per_study"), qc_tier: tiers },
    sources: [...(sources as string[])],
    level,
  };
}

/** Flat GET parameters: `tissue_group=Brain,Blood`, `not_treatment_status=treated`, `year_min=2020`, `min_cells=500`. */
export function cohortFromParams(url: URL): unknown {
  const sp = url.searchParams;
  const json = sp.get("query") ?? sp.get("q");
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      throw new CohortError("`query` is not valid JSON", "query");
    }
  }
  const list = (k: string) => sp.getAll(k).flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  const include: Clause[] = [];
  const exclude: Clause[] = [];
  for (const [key, spec] of Object.entries(ATTR_BY_KEY)) {
    if (spec.kind === "cat") {
      const inc = list(key);
      const exc = list(`not_${key}`);
      if (inc.length) include.push({ attr: key, any: inc });
      if (exc.length) exclude.push({ attr: key, any: exc });
    } else {
      const lo = sp.get(`${key}_min`);
      const hi = sp.get(`${key}_max`);
      if (lo != null || hi != null) include.push({ attr: key, num: { min: lo == null || lo === "" ? null : Number(lo), max: hi == null || hi === "" ? null : Number(hi) } });
    }
  }
  const out: CohortQuery = { version: 1, include, exclude, require: {} };
  if (sp.get("min_cells")) out.require!.min_cells = Number(sp.get("min_cells"));
  if (sp.get("min_samples_per_study")) out.require!.min_samples_per_study = Number(sp.get("min_samples_per_study"));
  if (sp.get("include_low_qc") === "1") out.require!.qc_tier = [0, 1];
  const qt = list("qc_tier");
  if (qt.length) out.require!.qc_tier = qt.map(Number);
  const src = list("sources");
  if (src.length) out.sources = src;
  if (sp.get("level")) out.level = sp.get("level") as CohortQuery["level"];
  return out;
}

/** Stable text form: same query, same string. Keys the response cache and the manifest hash. */
export function canonicalCohort(q: ParsedQuery): string {
  const clause = (c: Clause) =>
    c.any ? { attr: c.attr, any: [...new Set(c.any.map((v) => v.toLowerCase()))].sort() } : { attr: c.attr, num: { min: c.num!.min ?? null, max: c.num!.max ?? null } };
  const cmp = (a: unknown, b: unknown) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return JSON.stringify({
    v: 1,
    include: q.include.map(clause).sort(cmp),
    exclude: q.exclude.map(clause).sort(cmp),
    require: q.require,
    sources: [...new Set(q.sources.map((s) => s.toLowerCase()))].sort(),
    level: q.level,
  });
}

// ── resolve ─────────────────────────────────────────────────────────────────

export interface ResolveOptions {
  facetLimit?: number;
  studyLimit?: number;
  whatIf?: boolean;
  facets?: boolean;
}

export interface WhatIf {
  clause: string;
  samples: number;
  studies: number;
  cells: number;
  /** samples if the clause were dropped, minus samples now. */
  gain_samples: number;
}

export interface Resolution {
  query: ParsedQuery;
  index: { version: string; built_at: string; n_samples: number };
  totals: { studies: number; samples: number; cells: number; basis: "file" };
  studies: { gse_id: string; n_samples: number; n_cells: number }[];
  studies_truncated: boolean;
  facets: Record<string, { label: string; constrained: boolean; values: { value: string; n: number }[]; unknown: number }>;
  unknown_by_attr: Record<string, number>;
  what_if: WhatIf[];
  ambiguities: { attr: string; values: { value: string; n: number }[] }[];
  unmatched: { clause: string; value: string }[];
  snapped: { clause: string; attr: string; min: number | null; max: number | null }[];
  /** Applied to every cohort, shown so the totals can be reproduced. */
  base: string[];
}

interface Built {
  /** Samples that pass every clause. */
  mask: Uint32Array;
  /** One pass-mask per clause, in order, with the labels. */
  names: string[];
  passes: Uint32Array[];
  basePass: Uint32Array;
  attrOf: (string | null)[];
  unmatched: Resolution["unmatched"];
  snapped: Resolution["snapped"];
  base: string[];
  sourceMask: number;
}

/** Builds the clause masks and their AND. */
function build(index: BitIndex, q: ParsedQuery): Built {
  const sourceMask = parseSources(q.sources).mask;
  const unmatched: Built["unmatched"] = [];
  const snapped: Built["snapped"] = [];
  const base: string[] = [];

  let basePass = index.all();
  const baseValue = (attr: string, values: string[], label: string) => {
    if (!index.hasAttr(attr)) return;
    const ids = values.map((v) => index.valueId(attr, v)).filter((x) => x >= 0);
    andInto(basePass, index.valueMask(attr, ids, sourceMask));
    base.push(label);
  };
  baseValue("downloadable", ["1"], "in a downloadable study");
  baseValue("usable", ["1"], "sample passed the matrix and cell checks");
  baseValue("qc_tier", q.require.qc_tier.map(String), `qc_tier in {${q.require.qc_tier.join(",")}}`);

  const names: string[] = [];
  const passes: Uint32Array[] = [];
  const attrOf: (string | null)[] = [];

  const clauseMask = (c: Clause, name: string): Uint32Array => {
    if (!index.hasAttr(c.attr)) throw new CohortError(`The index has no '${c.attr}' yet`, c.attr);
    if (c.any) {
      const ids: number[] = [];
      for (const v of c.any) {
        const id = index.valueId(c.attr, v);
        if (id < 0) unmatched.push({ clause: name, value: v });
        else ids.push(id);
      }
      return index.valueMask(c.attr, ids, sourceMask);
    }
    const r = index.rangeMask(c.attr, c.num!.min ?? null, c.num!.max ?? null, sourceMask);
    snapped.push({ clause: name, attr: c.attr, min: r.snapped[0], max: r.snapped[1] });
    return r.mask;
  };

  q.include.forEach((c, i) => {
    const name = `include[${i}] ${c.attr}`;
    names.push(name);
    passes.push(clauseMask(c, name));
    attrOf.push(c.attr);
  });
  q.exclude.forEach((c, i) => {
    const name = `exclude[${i}] ${c.attr}`;
    names.push(name);
    passes.push(index.not(clauseMask(c, name)));
    attrOf.push(c.attr);
  });
  if (q.require.min_cells > 0) {
    names.push("require min_cells");
    passes.push(index.minCellsMask(q.require.min_cells));
    attrOf.push(null);
  }

  const mask = basePass.slice();
  for (const p of passes) andInto(mask, p);
  return { mask, names, passes, basePass, attrOf, unmatched, snapped, base, sourceMask };
}

/** The sample mask for a query (what the manifest slices). Applies min_samples_per_study. */
export function cohortMask(index: BitIndex, q: ParsedQuery): { mask: Uint32Array; summary: Summary } {
  const b = build(index, q);
  const summary = finish(index, b.mask, q);
  return { mask: b.mask, summary };
}

/** Summary after the per-study floor, which clears bits in `mask`. */
function finish(index: BitIndex, mask: Uint32Array, q: ParsedQuery): Summary {
  let s = index.summarize(mask);
  if (q.require.min_samples_per_study > 1) {
    if (index.dropSmallStudies(mask, q.require.min_samples_per_study, s) > 0) s = index.summarize(mask);
  }
  return s;
}

export function resolveCohort(index: BitIndex, q: ParsedQuery, opts: ResolveOptions = {}): Resolution {
  const facetLimit = opts.facetLimit ?? 15;
  const studyLimit = opts.studyLimit ?? 50;
  const b = build(index, q);
  const result = b.mask;
  const total = finish(index, result, q);
  const sm = b.sourceMask;
  const n = b.passes.length;

  const what_if: WhatIf[] = [];
  const unknown_by_attr: Record<string, number> = {};
  const constrained = new Set(b.attrOf.filter((a): a is string => !!a));

  if (opts.whatIf !== false) {
  // Masks with one clause left out: prefix and suffix ANDs, so each costs one word-wise AND.
  const prefix: Uint32Array[] = [b.basePass.slice()];
  for (let i = 0; i < n; i++) prefix.push(andInto(prefix[i].slice(), b.passes[i]));
  const suffix: Uint32Array[] = new Array(n + 1);
  suffix[n] = index.all();
  for (let i = n - 1; i >= 0; i--) suffix[i] = andInto(suffix[i + 1].slice(), b.passes[i]);
  const without = (i: number) => andInto(prefix[i].slice(), suffix[i + 1]);
    for (let i = 0; i < n; i++) {
      const m = without(i);
      const s = finish(index, m, q);
      what_if.push({ clause: b.names[i], samples: s.samples, studies: s.studies, cells: s.cells, gain_samples: s.samples - total.samples });
      // A dropped clause's attribute: candidates that pass everything else but carry no fact for it.
      const attr = b.attrOf[i];
      if (attr && q.include.some((c) => c.attr === attr) && !(attr in unknown_by_attr)) {
        const unk = m.slice();
        andNotInto(unk, index.known(attr, sm));
        unknown_by_attr[attr] = popcount(unk);
      }
    }
    if (q.require.min_samples_per_study > 1) {
      const s = index.summarize(prefix[n].slice());
      what_if.push({ clause: "require min_samples_per_study", samples: s.samples, studies: s.studies, cells: s.cells, gain_samples: s.samples - total.samples });
    }
  }

  const facets: Resolution["facets"] = {};
  const ambiguities: Resolution["ambiguities"] = [];
  if (opts.facets !== false) {
    for (const key of index.attrKeys()) {
      const spec = ATTR_BY_KEY[key];
      if (spec?.noFacet) continue;
      const f = index.facet(key, result, sm, spec?.kind === "num" ? Infinity : facetLimit);
      let values = f.values;
      if (spec?.kind === "num") {
        const order = new Map(index.attrDict(key).values.map((v, i) => [v, i]));
        values = values.slice().sort((x, y) => order.get(x.value)! - order.get(y.value)!);
      }
      facets[key] = { label: spec?.label ?? key, constrained: constrained.has(key), values, unknown: f.unknown };
      // Include-constrained attributes already carry the count of candidates that lack the fact.
      if (!q.include.some((c) => c.attr === key)) unknown_by_attr[key] = f.unknown;
      if ((AMBIGUITY_ATTRS as readonly string[]).includes(key) && !constrained.has(key) && f.known > 0) {
        const mixed = f.values.filter((v) => v.n / f.known >= 0.05);
        if (mixed.length >= 2) ambiguities.push({ attr: key, values: mixed });
      }
    }
  }

  const order = total.touched.slice();
  order.sort((x, y) => total.studyCells[y] - total.studyCells[x] || x - y);
  const studies = order.slice(0, studyLimit).map((s) => ({ gse_id: index.studies[s], n_samples: total.studySamples[s], n_cells: total.studyCells[s] }));

  return {
    query: q,
    index: { version: index.version, built_at: index.dict.built_at, n_samples: index.n },
    totals: { studies: total.studies, samples: total.samples, cells: total.cells, basis: "file" },
    studies,
    studies_truncated: order.length > studyLimit,
    facets,
    unknown_by_attr,
    what_if,
    ambiguities,
    unmatched: b.unmatched,
    snapped: b.snapped,
    base: b.base,
  };
}
