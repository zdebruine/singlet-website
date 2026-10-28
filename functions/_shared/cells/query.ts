/**
 * Atlas-wide cell search: a boolean filter (AND / OR / NOT over cell, sample and study fields; ./fields.ts) evaluated exactly over every
 * row of the cell index summary (./atlas-index.ts: sample x cell type x chromosomal sex x genetic ancestry -> cells) joined to the served
 * samples' catalog facts (./sample-facts.ts). Ontology filters match a term and every descendant. The answer: matching cells, their
 * studies and samples, a breakdown by every other facet, and per filter the descendant terms that contributed.
 *
 * Nothing here reads cell data or D1 per query: both inputs are in isolate memory. Per-cell numeric ranges (n_umi, n_genes) are the one
 * exception: they need the cell index's row scan, which the data Worker runs (`rowScanWhere` builds its request).
 */
import { HANCESTRO_LABELS } from "../hancestro";
import { organismToScientific } from "../vocab";
import type { CellIndex, IndexDictEntry } from "./atlas-index";
import { fieldDef, FIELDS, type FieldDef } from "./fields";
import { DONOR_STATUS, normLabel, PERTURBATIONS, SAMPLE_KINDS, type SampleFacts } from "./sample-facts";

// ── the query ───────────────────────────────────────────────────────────────

export interface Leaf {
  field: string;
  /** ontology / enum / accession values, OR-ed */
  any?: string[];
  min?: number | null;
  max?: number | null;
  /** boolean fields */
  is?: boolean;
  /** ontology fields: the term itself only, no descendants */
  exact?: boolean;
}
export type Expr = { and: Expr[] } | { or: Expr[] } | { not: Expr } | Leaf;

export interface CellQuery {
  where: Expr | null;
  include_low_qc: boolean;
  /** rows of the study and sample lists */
  limit: number;
  offset: number;
}

export class QueryError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const MAX_LEAVES = 48;
const MAX_DEPTH = 8;
const MAX_VALUES = 100;

const isLeaf = (e: Expr): e is Leaf => typeof (e as Leaf).field === "string";

function parseValues(field: FieldDef, raw: unknown): Leaf {
  const leaf: Leaf = { field: field.name };
  if (field.kind === "number") {
    let lo: unknown = null;
    let hi: unknown = null;
    if (Array.isArray(raw)) [lo, hi] = raw;
    else if (raw && typeof raw === "object") ({ min: lo = null, max: hi = null } = raw as { min?: unknown; max?: unknown });
    else if (typeof raw === "string" && /^\s*[-\d.eE+]*\s*(\.\.|:)\s*[-\d.eE+]*\s*$/.test(raw)) [lo, hi] = raw.split(/\.\.|:/).map((s) => s.trim() || null);
    else lo = hi = raw;
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    leaf.min = num(lo);
    leaf.max = num(hi);
    if ((leaf.min !== null && !Number.isFinite(leaf.min)) || (leaf.max !== null && !Number.isFinite(leaf.max))) throw new QueryError(`${field.name} takes a number range: [min, max], {min, max} or "min..max".`);
    if (leaf.min === null && leaf.max === null) throw new QueryError(`${field.name} needs a min or a max.`);
    return leaf;
  }
  if (field.kind === "boolean") {
    leaf.is = raw === true || raw === "true" || raw === "1" || raw === 1 || raw === "yes";
    return leaf;
  }
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("|") : [raw]).map((v) => String(v ?? "").trim()).filter(Boolean);
  if (!list.length) throw new QueryError(`${field.name} needs at least one value.`);
  if (list.length > MAX_VALUES) throw new QueryError(`${field.name} takes at most ${MAX_VALUES} values.`);
  leaf.any = [...new Set(list)].sort();
  return leaf;
}

/**
 * The filter, in either form:
 *   tree  {"and": [...]}, {"or": [...]}, {"not": {...}}, {"field": "cell_type", "any": ["T cell"], "exact"?: true} or {"field": "age_years", "min": 18}
 *   flat  {"cell_type": "T cell", "sex": "female", "tissue": ["lung", "UBERON:0002048"], "not": {"disease": "MONDO:0004992"}}: fields AND-ed,
 *         list values OR-ed, numbers as [min, max]
 */
export function parseWhere(input: unknown): Expr | null {
  if (input === null || input === undefined || input === "") return null;
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new QueryError("`where` is not valid JSON.");
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && !Object.keys(raw).length) return null;
  let leaves = 0;
  const walk = (v: unknown, depth: number): Expr => {
    if (depth > MAX_DEPTH) throw new QueryError(`The filter nests deeper than ${MAX_DEPTH} levels.`);
    if (Array.isArray(v)) return { and: v.map((x) => walk(x, depth + 1)) };
    if (!v || typeof v !== "object") throw new QueryError("Each filter is an object.");
    const o = v as Record<string, unknown>;
    if (typeof o.field === "string") {
      const f = fieldDef(o.field);
      if (!f) throw new QueryError(`Unknown field '${o.field}'.`, { fields: FIELDS.map((x) => x.name) });
      if (++leaves > MAX_LEAVES) throw new QueryError(`At most ${MAX_LEAVES} filters per query.`);
      const leaf = parseValues(f, f.kind === "number" ? (o.min !== undefined || o.max !== undefined ? { min: o.min, max: o.max } : o.any ?? o.value) : f.kind === "boolean" ? (o.is ?? o.value ?? true) : (o.any ?? o.values ?? o.value));
      if (o.exact === true && f.kind === "ontology") leaf.exact = true;
      return leaf;
    }
    const parts: Expr[] = [];
    for (const [k, x] of Object.entries(o)) {
      if (k === "and" || k === "or") {
        if (!Array.isArray(x) || !x.length) throw new QueryError(`'${k}' takes a non-empty list.`);
        const kids = x.map((y) => walk(y, depth + 1));
        parts.push(k === "and" ? { and: kids } : { or: kids });
      } else if (k === "not") {
        parts.push({ not: walk(x, depth + 1) });
      } else {
        const neg = k.startsWith("not_") || k.startsWith("-");
        const name = k.replace(/^(not_|-)/, "");
        const f = fieldDef(name);
        if (!f) throw new QueryError(`Unknown field '${name}'.`, { fields: FIELDS.map((y) => y.name) });
        if (++leaves > MAX_LEAVES) throw new QueryError(`At most ${MAX_LEAVES} filters per query.`);
        const leaf = parseValues(f, x);
        parts.push(neg ? { not: leaf } : leaf);
      }
    }
    if (!parts.length) throw new QueryError("An empty filter object.");
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  return simplify(walk(raw, 0));
}

function simplify(e: Expr): Expr {
  if (isLeaf(e)) return e;
  if ("not" in e) {
    const c = simplify(e.not);
    return !isLeaf(c) && "not" in c ? c.not : { not: c };
  }
  const op = "and" in e ? "and" : "or";
  const kids = ("and" in e ? e.and : e.or).map(simplify).flatMap((c) => (!isLeaf(c) && op in c ? (c as Record<string, Expr[]>)[op] : [c]));
  return kids.length === 1 ? kids[0] : op === "and" ? { and: kids } : { or: kids };
}

/** A stable text form (cache key): keys sorted, and/or members sorted. */
export function canonicalWhere(e: Expr | null): string {
  if (!e) return "";
  const c = (x: Expr): string => {
    if (isLeaf(x)) {
      const o: Record<string, unknown> = { field: x.field };
      if (x.any) o.any = x.any;
      if (x.min !== undefined) o.min = x.min;
      if (x.max !== undefined) o.max = x.max;
      if (x.is !== undefined) o.is = x.is;
      if (x.exact) o.exact = true;
      return JSON.stringify(o);
    }
    if ("not" in x) return `{"not":${c(x.not)}}`;
    const op = "and" in x ? "and" : "or";
    return `{"${op}":[${("and" in x ? x.and : x.or).map(c).sort().join(",")}]}`;
  };
  return c(e);
}

export function leavesOf(e: Expr | null): Leaf[] {
  if (!e) return [];
  if (isLeaf(e)) return [e];
  if ("not" in e) return leavesOf(e.not);
  return ("and" in e ? e.and : e.or).flatMap(leavesOf);
}

// ── resolving values ────────────────────────────────────────────────────────

/** Common names the ontology labels do not carry. */
export const CELL_TYPE_ALIASES: Record<string, string[]> = {
  "cd8 t cell": ["CL:0000625"],
  "cd8+ t cell": ["CL:0000625"],
  "cd8-positive t cell": ["CL:0000625"],
  "cytotoxic t cell": ["CL:0000625"],
  "cd4 t cell": ["CL:0000624"],
  "cd4+ t cell": ["CL:0000624"],
  "cd4-positive t cell": ["CL:0000624"],
  "helper t cell": ["CL:0000624"],
  treg: ["CL:0000815"],
  "regulatory t cell": ["CL:0000815"],
  "nk cell": ["CL:0000623"],
  "natural killer cell": ["CL:0000623"],
  "gamma delta t cell": ["CL:0000798"],
  pdc: ["CL:0000784"],
  microglia: ["CL:0000129"],
  "b lymphocyte": ["CL:0000236"],
  "t lymphocyte": ["CL:0000084"],
  macrophages: ["CL:0000235"],
  hsc: ["CL:0000037"],
  hspc: ["CL:0000837"],
  "red blood cell": ["CL:0000232"],
  rbc: ["CL:0000232"],
};
export const ANCESTRY_ALIASES: Record<string, string[]> = {
  african: ["HANCESTRO:0010"],
  "african ancestry": ["HANCESTRO:0010"],
  european: ["HANCESTRO:0005"],
  "european ancestry": ["HANCESTRO:0005"],
  "east asian": ["HANCESTRO:0009"],
  "south asian": ["HANCESTRO:0006"],
  hispanic: ["HANCESTRO:0014"],
  latino: ["HANCESTRO:0014"],
  "latin american": ["HANCESTRO:0014"],
  "hispanic or latin american": ["HANCESTRO:0014"],
  admixed: ["HANCESTRO:0306"],
  "admixed ancestry": ["HANCESTRO:0306"],
};
export const STAGE_ALIASES: Record<string, string[]> = {
  adult: ["HsapDv:0000258", "MmusDv:0000153", "MmusDv:0000136", "MmusDv:0000135", "MmusDv:0000134"],
  fetal: ["HsapDv:0000037", "MmusDv:0000031"],
  foetal: ["HsapDv:0000037", "MmusDv:0000031"],
  embryonic: ["HsapDv:0000002", "MmusDv:0000002"],
  prenatal: ["HsapDv:0000045", "MmusDv:0000042"],
  postnatal: ["HsapDv:0010000", "MmusDv:0000092"],
  newborn: ["HsapDv:0000262"],
  neonatal: ["HsapDv:0000262"],
  infant: ["HsapDv:0000261", "MmusDv:0000177"],
  child: ["HsapDv:0000265", "HsapDv:0000270"],
  "young adult": ["HsapDv:0000266", "MmusDv:0000153"],
  "middle aged": ["HsapDv:0000267", "MmusDv:0000135"],
  aged: ["HsapDv:0000227", "MmusDv:0000134"],
  elderly: ["HsapDv:0000227"],
};

const ID_RE = /^[A-Za-z][A-Za-z_]*:\d+$/;

/** Singular forms to try for a label that did not match ("T cells" -> "t cell", "tumours" -> "tumour"). */
export function singulars(s: string): string[] {
  const out = [s];
  if (s.endsWith("ies")) out.push(s.slice(0, -3) + "y");
  if (s.endsWith("es")) out.push(s.slice(0, -2));
  if (s.endsWith("s")) out.push(s.slice(0, -1));
  // "t cells from" style: plural on an inner word ("b cells" handled above); "cells of x"
  return out;
}

export interface Resolved {
  leaf: Leaf;
  def: FieldDef;
  /** per value: the ids it named */
  values: { value: string; ids: string[] }[];
  unknown: string[];
  /** cell fields: codes; sample fields: samples */
  codeMask?: Uint8Array;
  sampleMask?: Uint8Array;
  /** ontology fields: every term the filter covers (descendants included), as present in the data */
  covered: Set<string>;
  subject?: "ct" | "sex" | "anc";
}

function cellCodes(entries: IndexDictEntry[], ids: Set<string>, exact: boolean): Uint8Array {
  const m = new Uint8Array(entries.length + 1);
  for (const e of entries) if (e.id && (ids.has(e.id) || (!exact && (e.anc ?? []).some((a) => ids.has(a))))) m[e.code] = 1;
  return m;
}

function labelIds(idx: CellIndex, facts: SampleFacts, v: string, ontologies: string[], extra: Record<string, string[]>): string[] {
  for (const s of singulars(normLabel(v))) {
    const ids = new Set<string>();
    for (const id of extra[s] ?? []) ids.add(id);
    for (const id of facts.synonyms[s] ?? []) if (ontologies.some((o) => id.startsWith(o + ":"))) ids.add(id);
    if (ontologies.includes("CL")) {
      for (const e of idx.cellTypes) if (e.id && normLabel(e.label) === s) ids.add(e.id);
      for (const [id, l] of Object.entries(idx.terms)) if (id.startsWith("CL:") && normLabel(l) === s) ids.add(id);
    }
    if (ontologies.includes("HANCESTRO")) for (const [id, l] of Object.entries(HANCESTRO_LABELS)) if (normLabel(l) === s) ids.add(id);
    for (const [id, l] of Object.entries(facts.labels)) if (normLabel(l) === s && ontologies.some((o) => id.startsWith(o + ":"))) ids.add(id);
    if (ids.size) return [...ids].sort();
  }
  return [];
}

/** CL ids for a cell-type label or synonym (for the catalog interpreter's cell types). */
export const labelIdsFor = (idx: CellIndex, facts: SampleFacts, v: string): string[] => labelIds(idx, facts, v, ["CL"], CELL_TYPE_ALIASES);

function canonId(facts: SampleFacts, idx: CellIndex, v: string): string {
  const lower = v.toLowerCase();
  const known = facts.idCase.get(lower);
  if (known) return known;
  const [p, n] = v.split(":");
  for (const id of Object.keys(idx.terms)) if (id.toLowerCase() === lower) return id;
  return /^(hsapdv|mmusdv)$/i.test(p) ? `${p.toLowerCase() === "hsapdv" ? "HsapDv" : "MmusDv"}:${n}` : `${p.toUpperCase()}:${n}`;
}

const SAMPLE_TERM_FIELD: Record<string, string> = {
  tissue: "tissue",
  disease: "disease",
  development_stage: "development_stage",
  donor_sex: "sex",
  donor_ancestry: "ancestry",
  sorted_cell_type: "cell_type",
};

const SEX_CODES: Record<string, number> = { unknown: 0, female: 1, male: 2, ambiguous: 3, "pato:0000383": 1, "pato:0000384": 2 };

/** Resolve one leaf against the index and the facts: masks over cell codes or samples, and the terms it covers. */
export function resolveLeaf(leaf: Leaf, idx: CellIndex, facts: SampleFacts): Resolved {
  const def = fieldDef(leaf.field)!;
  const r: Resolved = { leaf, def, values: [], unknown: [], covered: new Set() };
  const vals = leaf.any ?? [];
  const n = facts.n;
  const sampleMask = (pred: (i: number) => boolean) => {
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (pred(i)) m[i] = 1;
    return m;
  };
  switch (def.name) {
    case "cell_type": {
      const ids = new Set<string>();
      let unknownLabel = false;
      for (const v of vals) {
        const got = ID_RE.test(v) ? [canonId(facts, idx, v)] : labelIds(idx, facts, v, ["CL"], CELL_TYPE_ALIASES);
        if (normLabel(v) === "unknown") unknownLabel = true;
        else if (!got.length) r.unknown.push(v);
        got.forEach((x) => ids.add(x));
        r.values.push({ value: v, ids: got });
      }
      r.codeMask = cellCodes(idx.cellTypes, ids, !!leaf.exact);
      if (unknownLabel) r.codeMask[0] = 1;
      r.subject = "ct";
      for (const e of idx.cellTypes) if (r.codeMask[e.code] && e.id) r.covered.add(e.id);
      return r;
    }
    case "sex": {
      const m = new Uint8Array(8);
      for (const v of vals) {
        const c = SEX_CODES[v.toLowerCase()];
        if (c === undefined) r.unknown.push(v);
        else m[c] = 1;
        r.values.push({ value: v, ids: c === 1 ? ["PATO:0000383"] : c === 2 ? ["PATO:0000384"] : [] });
      }
      r.codeMask = m;
      r.subject = "sex";
      return r;
    }
    case "ancestry": {
      const ids = new Set<string>();
      let unknownLabel = false;
      for (const v of vals) {
        const got = ID_RE.test(v) ? [v.toUpperCase()] : labelIds(idx, facts, v, ["HANCESTRO"], ANCESTRY_ALIASES);
        if (normLabel(v) === "unknown") unknownLabel = true;
        else if (!got.length) r.unknown.push(v);
        got.forEach((x) => ids.add(x));
        r.values.push({ value: v, ids: got });
      }
      r.codeMask = cellCodes(idx.ancestries, ids, !!leaf.exact);
      if (unknownLabel) r.codeMask[0] = 1;
      r.subject = "anc";
      for (const e of idx.ancestries) if (r.codeMask[e.code] && e.id) r.covered.add(e.id);
      return r;
    }
    case "n_umi":
    case "n_genes":
      return r;
  }
  const attr = SAMPLE_TERM_FIELD[def.name];
  if (attr) {
    const ont = def.ontology ?? [];
    const extra = def.name === "development_stage" ? STAGE_ALIASES : def.name === "donor_ancestry" ? ANCESTRY_ALIASES : def.name === "sorted_cell_type" ? CELL_TYPE_ALIASES : {};
    const ids = new Set<string>();
    for (const v of vals) {
      const got = ID_RE.test(v) ? [canonId(facts, idx, v)] : labelIds(idx, facts, v, ont, extra);
      if (!got.length) r.unknown.push(v);
      got.forEach((x) => ids.add(x));
      r.values.push({ value: v, ids: got });
    }
    const terms = facts.termSamples.get(attr) ?? new Map<string, Int32Array>();
    const m = new Uint8Array(n);
    for (const id of ids) {
      const desc = leaf.exact ? new Set([id]) : (facts.descendants.get(id) ?? new Set([id]));
      for (const t of desc) {
        const s = terms.get(t);
        if (!s) continue;
        r.covered.add(t);
        for (let k = 0; k < s.length; k++) m[s[k]] = 1;
      }
    }
    r.sampleMask = m;
    return r;
  }
  const ci = (list: string[], wanted: string[]) => {
    const w = new Set(wanted.map((x) => x.toLowerCase()));
    const hit = new Uint8Array(list.length + 1);
    list.forEach((x, k) => {
      if (w.has(x.toLowerCase())) hit[k] = 1;
    });
    for (const x of wanted) if (!list.some((y) => y.toLowerCase() === x.toLowerCase())) r.unknown.push(x);
    return hit;
  };
  const numMask = (col: (number | null)[]) => {
    const lo = leaf.min ?? -Infinity;
    const hi = leaf.max ?? Infinity;
    return sampleMask((i) => col[i] !== null && (col[i] as number) >= lo && (col[i] as number) <= hi);
  };
  const enumCol = (field: keyof SampleFacts["vocab"], col: number[], map: (v: string) => string = (v) => v) => {
    const hit = ci(facts.vocab[field], vals.map(map));
    r.values = vals.map((v) => ({ value: v, ids: [] }));
    return sampleMask((i) => col[i] >= 0 && hit[col[i]] === 1);
  };
  switch (def.name) {
    case "organism":
      r.sampleMask = enumCol("organism", facts.organism, (v) => organismToScientific(v) ?? v);
      break;
    case "assay":
      r.sampleMask = enumCol("assay", facts.assay);
      break;
    case "chemistry":
      r.sampleMask = enumCol("chemistry", facts.chemistry);
      break;
    case "tissue_group":
      r.sampleMask = enumCol("tissue_group", facts.tissue_group);
      break;
    case "disease_group":
      r.sampleMask = enumCol("disease_group", facts.disease_group);
      break;
    case "donor_status":
    case "sample_kind": {
      const list = (def.name === "donor_status" ? DONOR_STATUS : SAMPLE_KINDS) as readonly string[];
      const col = def.name === "donor_status" ? facts.donor_status : facts.sample_kind;
      const hit = ci([...list], vals);
      const unk = vals.some((v) => v.toLowerCase() === "unknown");
      r.unknown = r.unknown.filter((v) => v.toLowerCase() !== "unknown");
      r.sampleMask = sampleMask((i) => (col[i] === 0 ? unk : hit[col[i] - 1] === 1));
      break;
    }
    case "perturbation": {
      let bits = 0;
      for (const v of vals) {
        const b = (PERTURBATIONS as readonly string[]).indexOf(v.toLowerCase());
        if (b < 0) r.unknown.push(v);
        else bits |= 1 << b;
      }
      r.sampleMask = sampleMask((i) => (facts.perturbation[i] & bits) !== 0);
      break;
    }
    case "qc": {
      const want = new Set(vals.map((v) => v.toLowerCase()));
      for (const v of want) if (v !== "pass" && v !== "low") r.unknown.push(v);
      r.sampleMask = sampleMask((i) => want.has(facts.qc_tier[i] === 0 ? "pass" : "low"));
      break;
    }
    case "age_years":
      r.sampleMask = numMask(facts.age);
      break;
    case "median_umi":
      r.sampleMask = numMask(facts.umi);
      break;
    case "median_genes":
      r.sampleMask = numMask(facts.genes);
      break;
    case "mito_fraction":
      r.sampleMask = numMask(facts.mito);
      break;
    case "cells_called":
      r.sampleMask = numMask(facts.called);
      break;
    case "mapping_rate":
      r.sampleMask = numMask(facts.mapping);
      break;
    case "year":
      r.sampleMask = numMask(facts.year);
      break;
    case "has_publication":
      r.sampleMask = sampleMask((i) => (facts.pub[i] === 1) === (leaf.is !== false));
      break;
    case "sample": {
      const w = new Set(vals.map((v) => v.toUpperCase()));
      r.sampleMask = sampleMask((i) => w.has(facts.gsm[i]));
      for (const v of w) if (!facts.index.has(v)) r.unknown.push(v);
      break;
    }
    case "study": {
      const w = new Set(vals.map((v) => v.toUpperCase()));
      r.sampleMask = sampleMask((i) => w.has(facts.gse[i]));
      const have = new Set(facts.gse);
      for (const v of w) if (!have.has(v)) r.unknown.push(v);
      break;
    }
    default:
      throw new QueryError(`Field '${def.name}' cannot be searched yet.`);
  }
  return r;
}

// ── the join of the two inputs (memoised per index version and facts build) ──

interface Join {
  key: string;
  /** summary row -> facts sample index (-1: not served) */
  rowSi: Int32Array;
  /** served rows: every tier, and QC-passed only */
  rowsAll: Int32Array;
  rowsPass: Int32Array;
  /** cells of each served sample in the index (all labels) */
  siCells: Float64Array;
}
let joinMemo: Join | null = null;

export function joinOf(idx: CellIndex, facts: SampleFacts): Join {
  const key = `${idx.version}|${facts.built_at}`;
  if (joinMemo?.key === key) return joinMemo;
  const soSi = new Int32Array(idx.maxSo + 1).fill(-1);
  for (let so = 0; so <= idx.maxSo; so++) {
    const g = idx.gsmOf[so];
    if (!g) continue;
    const i = facts.index.get(`GSM${g}`);
    if (i !== undefined) soSi[so] = i;
  }
  const rowSi = new Int32Array(idx.n);
  const siCells = new Float64Array(facts.n);
  const all: number[] = [];
  const pass: number[] = [];
  for (let r = 0; r < idx.n; r++) {
    const si = soSi[idx.so[r]];
    rowSi[r] = si;
    if (si < 0) continue;
    siCells[si] += idx.cells[r];
    all.push(r);
    if (facts.qc_tier[si] === 0) pass.push(r);
  }
  joinMemo = { key, rowSi, rowsAll: Int32Array.from(all), rowsPass: Int32Array.from(pass), siCells };
  return joinMemo;
}

// ── evaluation ──────────────────────────────────────────────────────────────

function evalExpr(e: Expr, dom: Int32Array, res: Map<Leaf, Resolved>, idx: CellIndex, rowSi: Int32Array): Int32Array {
  if (isLeaf(e)) {
    const r = res.get(e)!;
    if (r.def.rowScan) return dom; // applied by the row scan
    const out = new Int32Array(dom.length);
    let k = 0;
    if (r.sampleMask) {
      const m = r.sampleMask;
      for (let i = 0; i < dom.length; i++) if (m[rowSi[dom[i]]]) out[k++] = dom[i];
    } else {
      const m = r.codeMask!;
      const col = r.subject === "ct" ? idx.ct : r.subject === "sex" ? idx.sex : idx.anc;
      for (let i = 0; i < dom.length; i++) if (m[col[dom[i]]]) out[k++] = dom[i];
    }
    return out.subarray(0, k);
  }
  if ("not" in e) {
    const m = evalExpr(e.not, dom, res, idx, rowSi);
    const out = new Int32Array(dom.length);
    let k = 0;
    let j = 0;
    for (let i = 0; i < dom.length; i++) {
      while (j < m.length && m[j] < dom[i]) j++;
      if (j < m.length && m[j] === dom[i]) continue;
      out[k++] = dom[i];
    }
    return out.subarray(0, k);
  }
  if ("and" in e) {
    // sample filters first: they usually cut the most rows for the least work
    const kids = [...e.and].sort((a, b) => rank(a, res) - rank(b, res));
    let d = dom;
    for (const c of kids) {
      if (!d.length) break;
      d = evalExpr(c, d, res, idx, rowSi);
    }
    return d;
  }
  // or: each member only looks at the rows no earlier member took
  const hit = new Uint8Array(dom.length);
  let rest = Int32Array.from(dom.keys());
  for (const c of e.or) {
    if (!rest.length) break;
    const sub = new Int32Array(rest.length);
    for (let i = 0; i < rest.length; i++) sub[i] = dom[rest[i]];
    const m = evalExpr(c, sub, res, idx, rowSi);
    const next = new Int32Array(rest.length);
    let k = 0;
    let j = 0;
    for (let i = 0; i < rest.length; i++) {
      while (j < m.length && m[j] < sub[i]) j++;
      if (j < m.length && m[j] === sub[i]) hit[rest[i]] = 1;
      else next[k++] = rest[i];
    }
    rest = next.subarray(0, k);
  }
  const out = new Int32Array(dom.length);
  let k = 0;
  for (let i = 0; i < dom.length; i++) if (hit[i]) out[k++] = dom[i];
  return out.subarray(0, k);
}

function rank(e: Expr, res: Map<Leaf, Resolved>): number {
  if (isLeaf(e)) return res.get(e)!.sampleMask ? 0 : 1;
  return 2;
}

// ── the answer ──────────────────────────────────────────────────────────────

export interface FacetValue {
  id?: string | null;
  value: string;
  label?: string;
  cells: number;
  samples?: number;
}

export interface CellSearchResult {
  totals: { cells: number; samples: number; studies: number; rows: number };
  studies: { gse_id: string; cells: number; samples: number }[];
  samples: { gsm_id: string; gse_id: string; cells: number }[];
  facets: Record<string, FacetValue[]>;
  /** cell types matched at every level of the ontology (a cell counts for its call and every ancestor) */
  cell_type_lineage: FacetValue[];
  filters: {
    field: string;
    level: string;
    values: { value: string; ids: string[]; labels: string[] }[];
    exact: boolean;
    terms_covered: number;
    contributing: FacetValue[];
  }[];
  /** the matching rows' sample indices with cells (for the slice path) */
  perSample: Float64Array;
}

const TOP = 40;

export function runCellQuery(q: CellQuery, idx: CellIndex, facts: SampleFacts): CellSearchResult {
  const leaves = leavesOf(q.where);
  const res = new Map<Leaf, Resolved>();
  const unknown: { field: string; values: string[] }[] = [];
  for (const l of leaves) {
    const r = resolveLeaf(l, idx, facts);
    res.set(l, r);
    if (r.unknown.length) unknown.push({ field: r.def.name, values: r.unknown });
  }
  if (unknown.length) throw new QueryError(`Unknown values: ${unknown.map((u) => `${u.field} ${u.values.map((v) => `'${v}'`).join(", ")}`).join("; ")}. GET /api/cells/fields lists every field and its values.`, { unknown });
  const join = joinOf(idx, facts);
  const dom = q.include_low_qc ? join.rowsAll : join.rowsPass;
  const rows = q.where ? evalExpr(q.where, dom, res, idx, join.rowSi) : dom;

  const perSi = new Float64Array(facts.n);
  const perCt = new Float64Array(idx.cellTypes.length + 1);
  const perSex = new Float64Array(8);
  const perAnc = new Float64Array(idx.ancestries.length + 1);
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = idx.cells[r];
    total += c;
    perSi[join.rowSi[r]] += c;
    perCt[idx.ct[r]] += c;
    perSex[idx.sex[r]] += c;
    perAnc[idx.anc[r]] += c;
  }
  // studies and samples
  const studyCells = new Map<string, { cells: number; samples: number }>();
  const sampleList: { gsm_id: string; gse_id: string; cells: number }[] = [];
  for (let i = 0; i < facts.n; i++) {
    if (!perSi[i]) continue;
    const g = facts.gse[i];
    const s = studyCells.get(g) ?? { cells: 0, samples: 0 };
    s.cells += perSi[i];
    s.samples++;
    studyCells.set(g, s);
    sampleList.push({ gsm_id: facts.gsm[i], gse_id: g, cells: perSi[i] });
  }
  const studies = [...studyCells].map(([gse_id, s]) => ({ gse_id, ...s })).sort((a, b) => b.cells - a.cells || (a.gse_id < b.gse_id ? -1 : 1));
  sampleList.sort((a, b) => b.cells - a.cells || (a.gsm_id < b.gsm_id ? -1 : 1));

  const label = (id: string) => idx.terms[id] ?? facts.labels[id] ?? HANCESTRO_LABELS[id] ?? id;
  const facets: Record<string, FacetValue[]> = {};
  const fromCodes = (dict: IndexDictEntry[], arr: Float64Array) =>
    dict
      .filter((e) => arr[e.code] > 0)
      .map((e) => ({ id: e.id, value: e.id ?? e.label, label: e.label, cells: arr[e.code] }))
      .sort((a, b) => b.cells - a.cells);
  facets.cell_type = fromCodes(idx.cellTypes, perCt).slice(0, 100);
  facets.sex = fromCodes(idx.sexes, perSex);
  facets.ancestry = fromCodes(idx.ancestries, perAnc);

  // lineage: every ancestor level of the matched calls
  const roll = new Map<string, number>();
  for (const e of idx.cellTypes) {
    const c = perCt[e.code];
    if (!c || !e.id) continue;
    for (const a of new Set([e.id, ...(e.anc ?? [])])) roll.set(a, (roll.get(a) ?? 0) + c);
  }
  const lineage = [...roll].map(([id, cells]) => ({ id, value: id, label: label(id), cells })).sort((a, b) => b.cells - a.cells).slice(0, 60);

  // sample-level facets: cells of the matching samples, per value
  const termFacet = (attr: string) => {
    const m = facts.termSamples.get(attr);
    const out: FacetValue[] = [];
    const covered = new Uint8Array(facts.n);
    if (m)
      for (const [t, list] of m) {
        let cells = 0;
        let ns = 0;
        for (let k = 0; k < list.length; k++) {
          const c = perSi[list[k]];
          if (c) {
            cells += c;
            ns++;
            covered[list[k]] = 1;
          }
        }
        if (cells) out.push({ id: t, value: t, label: label(t), cells, samples: ns });
      }
    out.sort((a, b) => b.cells - a.cells);
    let none = 0;
    for (let i = 0; i < facts.n; i++) if (perSi[i] && !covered[i]) none += perSi[i];
    if (none) out.push({ id: null, value: "unknown", label: "not recorded", cells: none });
    return out.slice(0, TOP);
  };
  for (const [field, attr] of Object.entries(SAMPLE_TERM_FIELD)) facets[field] = termFacet(attr);
  const vocabFacet = (field: keyof SampleFacts["vocab"], col: number[]) => {
    const sums = new Float64Array(facts.vocab[field].length + 1);
    const ns = new Uint32Array(facts.vocab[field].length + 1);
    for (let i = 0; i < facts.n; i++) {
      if (!perSi[i]) continue;
      const k = col[i] < 0 ? facts.vocab[field].length : col[i];
      sums[k] += perSi[i];
      ns[k]++;
    }
    const out: FacetValue[] = [];
    sums.forEach((c, k) => {
      if (c) out.push({ value: k === facts.vocab[field].length ? "unknown" : facts.vocab[field][k], cells: c, samples: ns[k] });
    });
    return out.sort((a, b) => b.cells - a.cells).slice(0, TOP);
  };
  facets.organism = vocabFacet("organism", facts.organism);
  facets.assay = vocabFacet("assay", facts.assay);
  facets.chemistry = vocabFacet("chemistry", facts.chemistry);
  facets.tissue_group = vocabFacet("tissue_group", facts.tissue_group);
  facets.disease_group = vocabFacet("disease_group", facts.disease_group);
  const codeFacet = (list: readonly string[], col: number[]) => {
    const sums = new Float64Array(list.length + 1);
    const ns = new Uint32Array(list.length + 1);
    for (let i = 0; i < facts.n; i++) {
      if (!perSi[i]) continue;
      sums[col[i]] += perSi[i];
      ns[col[i]]++;
    }
    const out: FacetValue[] = [];
    sums.forEach((c, k) => {
      if (c) out.push({ value: k === 0 ? "unknown" : list[k - 1], cells: c, samples: ns[k] });
    });
    return out.sort((a, b) => b.cells - a.cells);
  };
  facets.donor_status = codeFacet(DONOR_STATUS, facts.donor_status);
  facets.sample_kind = codeFacet(SAMPLE_KINDS, facts.sample_kind);
  {
    const sums = new Float64Array(PERTURBATIONS.length + 1);
    const ns = new Uint32Array(PERTURBATIONS.length + 1);
    for (let i = 0; i < facts.n; i++) {
      if (!perSi[i]) continue;
      const b = facts.perturbation[i];
      if (!b) {
        sums[PERTURBATIONS.length] += perSi[i];
        ns[PERTURBATIONS.length]++;
      }
      PERTURBATIONS.forEach((_, k) => {
        if (b & (1 << k)) {
          sums[k] += perSi[i];
          ns[k]++;
        }
      });
    }
    facets.perturbation = [...PERTURBATIONS, "unknown"].map((value, k) => ({ value, cells: sums[k], samples: ns[k] })).filter((x) => x.cells > 0).sort((a, b) => b.cells - a.cells);
  }
  {
    let pass = 0;
    let low = 0;
    for (let i = 0; i < facts.n; i++) if (perSi[i]) facts.qc_tier[i] === 0 ? (pass += perSi[i]) : (low += perSi[i]);
    facets.qc = [
      { value: "pass", cells: pass },
      { value: "low", cells: low },
    ].filter((x) => x.cells > 0);
  }

  // per filter: the values as resolved, and the descendant terms that contributed cells
  const filters = leaves.map((l) => {
    const r = res.get(l)!;
    let contributing: FacetValue[] = [];
    if (r.subject === "ct" || r.subject === "anc") {
      const dict = r.subject === "ct" ? idx.cellTypes : idx.ancestries;
      const arr = r.subject === "ct" ? perCt : perAnc;
      contributing = dict.filter((e) => r.codeMask![e.code] && arr[e.code] > 0).map((e) => ({ id: e.id, value: e.id ?? e.label, label: e.label, cells: arr[e.code] }));
    } else if (r.def.kind === "ontology" && r.sampleMask) {
      const m = facts.termSamples.get(SAMPLE_TERM_FIELD[r.def.name]);
      for (const t of r.covered) {
        const list = m?.get(t);
        if (!list) continue;
        let cells = 0;
        let ns = 0;
        for (let k = 0; k < list.length; k++) if (perSi[list[k]]) (cells += perSi[list[k]]), ns++;
        if (cells) contributing.push({ id: t, value: t, label: label(t), cells, samples: ns });
      }
    }
    contributing.sort((a, b) => b.cells - a.cells);
    return {
      field: r.def.name,
      level: r.def.level,
      values: r.values.map((v) => ({ value: v.value, ids: v.ids, labels: v.ids.map(label) })),
      exact: !!l.exact,
      terms_covered: r.covered.size,
      contributing: contributing.slice(0, 50),
    };
  });

  return {
    totals: { cells: total, samples: sampleList.length, studies: studies.length, rows: rows.length },
    studies: studies.slice(q.offset, q.offset + q.limit),
    samples: sampleList.slice(q.offset, q.offset + q.limit),
    facets,
    cell_type_lineage: lineage,
    filters,
    perSample: perSi,
  };
}

/** Matching cells of a filter (no breakdowns): for relaxations. */
export function countCells(where: Expr | null, includeLow: boolean, idx: CellIndex, facts: SampleFacts): number {
  const res = new Map<Leaf, Resolved>();
  for (const l of leavesOf(where)) res.set(l, resolveLeaf(l, idx, facts));
  const join = joinOf(idx, facts);
  const dom = includeLow ? join.rowsAll : join.rowsPass;
  const rows = where ? evalExpr(where, dom, res, idx, join.rowSi) : dom;
  let n = 0;
  for (let i = 0; i < rows.length; i++) n += idx.cells[rows[i]];
  return n;
}

/**
 * For an AND that matches nothing: per filter, the cells it matches alone and the cells of the query without it, so a reader sees which
 * filters are thin and which one empties the answer.
 */
export function relaxations(where: Expr | null, includeLow: boolean, idx: CellIndex, facts: SampleFacts): { filter: string; alone: number; without: number }[] {
  if (!where || isLeaf(where) || !("and" in where) || where.and.length < 2 || where.and.length > 8) return [];
  const describe = (e: Expr): string => (isLeaf(e) ? `${e.field}=${(e.any ?? [`${e.min ?? ""}..${e.max ?? ""}`]).join("|")}` : "not" in e ? `not ${describe(e.not)}` : canonicalWhere(e));
  return where.and
    .map((part, k) => ({
      filter: describe(part),
      alone: countCells(part, includeLow, idx, facts),
      without: countCells(simplify({ and: where.and.filter((_, j) => j !== k) }), includeLow, idx, facts),
    }))
    .sort((a, b) => b.without - a.without || a.alone - b.alone);
}

// ── per-cell ranges: the data Worker's row scan ─────────────────────────────

/**
 * The cell part of a query in the cell index's own `where` (fields AND-ed, values OR-ed, descendants matched): possible when every cell
 * filter is a plain AND-ed member of the query, each field at most once, none `exact`; the sample part is then just the list of samples.
 * Null when it is not (OR / NOT around a cell filter): the caller filters the cells itself.
 */
export function cellPushdown(where: Expr | null, idx: CellIndex, facts: SampleFacts): Record<string, unknown> | null {
  const top = where && !isLeaf(where) && "and" in where ? where.and : where ? [where] : [];
  const w: Record<string, unknown> = {};
  for (const e of top) {
    const cellish = leavesOf(e).some((l) => fieldDef(l.field)?.level === "cell");
    if (!cellish) continue;
    if (!isLeaf(e) || e.exact) return null;
    const def = fieldDef(e.field)!;
    if (def.rowScan) {
      const ranges = (w.ranges ??= {}) as Record<string, [number | null, number | null]>;
      if (ranges[def.name]) return null;
      ranges[def.name] = [e.min ?? null, e.max ?? null];
      continue;
    }
    if (w[def.name]) return null;
    const r = resolveLeaf(e, idx, facts);
    if (def.name === "sex") w.sex = (e.any ?? []).map((v) => ({ "pato:0000383": "female", "pato:0000384": "male" })[v.toLowerCase()] ?? v.toLowerCase());
    else {
      const ids = [...new Set(r.values.flatMap((v) => v.ids))];
      if (r.codeMask?.[0]) ids.push("unknown");
      w[def.name] = ids;
    }
  }
  return w;
}

/**
 * The `where` of a cell-index count for a query with per-cell ranges (n_umi, n_genes): its samples (the ones with matching cells), the
 * ranges, and the cell-label filters. Null when the query has no ranges; a QueryError when the query cannot be put in the index's form.
 */
export function rowScanWhere(where: Expr | null, idx: CellIndex, facts: SampleFacts, gsms: string[]): Record<string, unknown> | null {
  if (!leavesOf(where).some((l) => fieldDef(l.field)?.rowScan)) return null;
  const push = cellPushdown(where, idx, facts);
  if (!push || !push.ranges)
    throw new QueryError("Per-cell ranges (n_umi, n_genes) work when every cell filter is a plain AND-ed filter, each field once (no OR or NOT around cell type, sex, ancestry or a range).");
  return { samples: gsms, ...push };
}

/** Cells (rows of a cell-index answer, with their cell type id, sex label and ancestry id) that satisfy the query, by position. */
export function filterCellRows(
  where: Expr | null,
  idx: CellIndex,
  facts: SampleFacts,
  cells: { gsm: string[]; cell_type: (string | null)[]; sex: (string | null)[]; ancestry: (string | null)[] }
): Int32Array {
  const n = cells.gsm.length;
  const ctCode = new Map<string, number>();
  for (const e of idx.cellTypes) if (e.id) ctCode.set(e.id, e.code);
  const ancCode = new Map<string, number>();
  for (const e of idx.ancestries) if (e.id) ancCode.set(e.id, e.code);
  const sexCode = new Map<string, number>();
  for (const e of idx.sexes) sexCode.set(e.label, e.code);
  const mini = { ct: new Uint16Array(n), sex: new Uint8Array(n), anc: new Uint8Array(n) } as unknown as CellIndex;
  const rowSi = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    mini.ct[i] = ctCode.get(cells.cell_type[i] ?? "") ?? 0;
    mini.sex[i] = sexCode.get(cells.sex[i] ?? "unknown") ?? 0;
    mini.anc[i] = ancCode.get(cells.ancestry[i] ?? "") ?? 0;
    rowSi[i] = facts.index.get(cells.gsm[i]) ?? -1;
  }
  const dom = Int32Array.from({ length: n }, (_, i) => i).filter((i) => rowSi[i] >= 0);
  if (!where) return dom;
  const res = new Map<Leaf, Resolved>();
  for (const l of leavesOf(where)) res.set(l, resolveLeaf(l, idx, facts));
  return evalExpr(where, dom, res, mini, rowSi);
}
