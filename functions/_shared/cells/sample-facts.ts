/**
 * Every served sample's catalog facts in one snapshot, for cell search (./query.ts).
 *
 * Read from D1 once per colo and hour (then kept in the Cache API and in the isolate), so a cell query touches no D1 rows at all:
 *   samples     s1_sample (current rev) of studies on DOWNLOADABLE_SQL, sample_qc usable with qc_tier <= 1, Alpha exclusions applied
 *               (the same basis as the site's headline numbers; tier 1 is only counted when a query asks for low-QC samples)
 *   gsm         organism_primary, assay_family, tissue_group, disease_group
 *   sample_qc   chemistry (protocol), median UMI / genes / mito fraction, cells called, mapping rate, qc_tier
 *   gse_meta    study year; gse.pubmed_ids (has a publication)
 *   sample_term ontology terms per sample (tissue UBERON, disease MONDO/PATO, development_stage HsapDv/MmusDv, author sex PATO,
 *               author ancestry HANCESTRO, author-sorted cell type CL)
 *   sample_property  donor_status, perturbation, sample_kind
 *   sample_attr age (geo), converted to years
 *   ontology_closure / ontology_term / ontology_label  descendants, labels and synonyms of the terms the samples use
 * About 400k D1 rows per build ($0.0004 at the D1 list price), a few MB of JSON.
 */
import { sampleServedSql } from "../alpha";
import { downloadableSql } from "../search-core";

export const SAMPLE_TERM_ATTRS = ["tissue", "disease", "development_stage", "sex", "ancestry", "cell_type"] as const;
export type SampleTermAttr = (typeof SAMPLE_TERM_ATTRS)[number];

export const DONOR_STATUS = ["healthy", "diseased"] as const;
export const SAMPLE_KINDS = ["primary", "cell_line", "stem_cell", "organoid", "xenograft"] as const;
export const PERTURBATIONS = ["treated", "genetic", "control"] as const;

/** The snapshot as stored (columnar JSON). */
export interface FactsWire {
  v: 1;
  built_at: string;
  policy: string | null;
  gsm: string[];
  gse: string[];
  vocab: Record<"organism" | "assay" | "chemistry" | "tissue_group" | "disease_group", string[]>;
  organism: number[];
  assay: number[];
  chemistry: number[];
  tissue_group: number[];
  disease_group: number[];
  qc_tier: number[];
  called: (number | null)[];
  umi: (number | null)[];
  genes: (number | null)[];
  mito: (number | null)[];
  mapping: (number | null)[];
  age: (number | null)[];
  year: (number | null)[];
  pub: number[];
  /** 0 unknown, else 1 + index in DONOR_STATUS / SAMPLE_KINDS; perturbation: bit i = PERTURBATIONS[i] */
  donor_status: number[];
  sample_kind: number[];
  perturbation: number[];
  /** attr -> term -> sample indices */
  terms: Record<string, Record<string, number[]>>;
  /** term -> its ancestors (the closure, restricted to terms the samples use) */
  ancestors: Record<string, string[]>;
  labels: Record<string, string>;
  /** normalised label or synonym -> term ids */
  synonyms: Record<string, string[]>;
}

export interface SampleFacts extends FactsWire {
  n: number;
  index: Map<string, number>;
  /** attr -> term -> sample indices */
  termSamples: Map<string, Map<string, Int32Array>>;
  /** ancestor -> its descendants among the terms the samples use (itself included) */
  descendants: Map<string, Set<string>>;
  /** lower-case id -> id as stored ("hsapdv:0000258" -> "HsapDv:0000258") */
  idCase: Map<string, string>;
  bytes: number;
  source: "isolate" | "edge" | "d1";
}

export const normLabel = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim();

/** Age as written in GEO (value and unit) in years, or null. */
export function ageYears(value: number | null, unit: string | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const u = (unit ?? "years").toLowerCase();
  const f = /^y/.test(u) ? 1 : /^mo/.test(u) ? 1 / 12 : /^w/.test(u) ? 7 / 365.25 : /^d/.test(u) ? 1 / 365.25 : /^h/.test(u) ? 1 / 8766 : null;
  return f === null ? null : Math.round(value * f * 10000) / 10000;
}

type Row = Record<string, unknown>;

/** All rows of a statement, paged by a key so no single D1 answer is large. */
async function pagedRows(db: D1Database, sql: (after: string) => string, key: string, page = 20000): Promise<Row[]> {
  const out: Row[] = [];
  let after = "";
  for (;;) {
    const rs = await db.prepare(sql(after)).bind(after, page).all<Row>();
    const rows = rs.results ?? [];
    out.push(...rows);
    if (rows.length < page) return out;
    after = String(rows[rows.length - 1][key]);
  }
}

/** Build the snapshot from D1 (read-only). */
export async function buildFacts(db: D1Database): Promise<FactsWire> {
  const samples = await pagedRows(
    db,
    () => `SELECT s.gsm_id, s.gse_id, g.organism_primary AS organism, g.assay_family AS assay, g.tissue_group, g.disease_group,
                  q.protocol AS chemistry, COALESCE(q.qc_tier, 0) AS qc_tier, q.n_cells_called AS called, q.median_umi AS umi,
                  q.median_genes AS genes, q.median_mito_fraction AS mito, q.mapping_rate AS mapping, m.year,
                  (SELECT CASE WHEN x.pubmed_ids IS NOT NULL AND x.pubmed_ids NOT IN ('', '[]', 'null') THEN 1 ELSE 0 END FROM gse x WHERE x.id = s.gse_id) AS pub
             FROM s1_sample s
             JOIN s1_study st ON st.gse_id = s.gse_id AND st.rev = s.rev
             JOIN gse_meta m ON m.gse_id = s.gse_id AND ${downloadableSql(true)}
             JOIN sample_qc q ON q.gsm_id = s.gsm_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) <= 1
             LEFT JOIN gsm g ON g.gsm_id = s.gsm_id
            WHERE ${sampleServedSql("s.gsm_id")} AND s.gsm_id > ?1
            ORDER BY s.gsm_id LIMIT ?2`,
    "gsm_id"
  );
  // a sample can appear under two revs only if the catalog is mid-update: keep the first
  const index = new Map<string, number>();
  const keep: Row[] = [];
  for (const r of samples) {
    const g = String(r.gsm_id);
    if (index.has(g)) continue;
    index.set(g, keep.length);
    keep.push(r);
  }
  const n = keep.length;
  const vocab: FactsWire["vocab"] = { organism: [], assay: [], chemistry: [], tissue_group: [], disease_group: [] };
  const code = (field: keyof FactsWire["vocab"], v: unknown): number => {
    if (v === null || v === undefined || v === "") return -1;
    const s = String(v);
    let i = vocab[field].indexOf(s);
    if (i < 0) i = vocab[field].push(s) - 1;
    return i;
  };
  const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const wire: FactsWire = {
    v: 1,
    built_at: new Date().toISOString(),
    policy: null,
    gsm: keep.map((r) => String(r.gsm_id)),
    gse: keep.map((r) => String(r.gse_id)),
    vocab,
    organism: keep.map((r) => code("organism", r.organism)),
    assay: keep.map((r) => code("assay", r.assay)),
    chemistry: keep.map((r) => code("chemistry", r.chemistry)),
    tissue_group: keep.map((r) => code("tissue_group", r.tissue_group)),
    disease_group: keep.map((r) => code("disease_group", r.disease_group)),
    qc_tier: keep.map((r) => Number(r.qc_tier) || 0),
    called: keep.map((r) => num(r.called)),
    umi: keep.map((r) => num(r.umi)),
    genes: keep.map((r) => num(r.genes)),
    mito: keep.map((r) => num(r.mito)),
    mapping: keep.map((r) => num(r.mapping)),
    age: new Array(n).fill(null),
    year: keep.map((r) => num(r.year)),
    pub: keep.map((r) => Number(r.pub) || 0),
    donor_status: new Array(n).fill(0),
    sample_kind: new Array(n).fill(0),
    perturbation: new Array(n).fill(0),
    terms: {},
    ancestors: {},
    labels: {},
    synonyms: {},
  };

  const [terms, props, ages, policy] = await Promise.all([
    db.prepare(`SELECT gsm_id, attr, term_id FROM sample_term`).all<Row>().then((r) => r.results ?? []),
    db.prepare(`SELECT gsm_id, property, value FROM sample_property`).all<Row>(),
    db.prepare(`SELECT gsm_id, value_num, unit FROM sample_attr WHERE attr = 'age' AND source = 'geo' AND value_num IS NOT NULL`).all<Row>(),
    db.prepare(`SELECT MAX(policy_version) AS p FROM alpha_exclusions`).first<{ p: string | null }>(),
  ]);
  wire.policy = policy?.p ?? null;
  const used = new Set<string>();
  for (const r of terms) {
    const i = index.get(String(r.gsm_id));
    if (i === undefined) continue;
    const attr = String(r.attr);
    const t = String(r.term_id);
    ((wire.terms[attr] ??= {})[t] ??= []).push(i);
    used.add(t);
  }
  for (const r of props.results ?? []) {
    const i = index.get(String(r.gsm_id));
    if (i === undefined) continue;
    const v = String(r.value);
    if (r.property === "donor_status") wire.donor_status[i] = (DONOR_STATUS as readonly string[]).indexOf(v) + 1;
    else if (r.property === "sample_kind") wire.sample_kind[i] = (SAMPLE_KINDS as readonly string[]).indexOf(v) + 1;
    else if (r.property === "perturbation") {
      const b = (PERTURBATIONS as readonly string[]).indexOf(v);
      if (b >= 0) wire.perturbation[i] |= 1 << b;
    }
  }
  for (const r of ages.results ?? []) {
    const i = index.get(String(r.gsm_id));
    if (i === undefined || wire.age[i] !== null) continue;
    wire.age[i] = ageYears(num(r.value_num), r.unit === null || r.unit === undefined ? null : String(r.unit));
  }

  // the ontology slice: every term the samples use and its ancestors, with labels and synonyms
  const [closure, labels, syn] = await Promise.all([
    db.prepare(`SELECT term_id, ancestor_id FROM ontology_closure`).all<Row>(),
    db.prepare(`SELECT term_id, label FROM ontology_term`).all<Row>(),
    db.prepare(`SELECT label_norm, term_id FROM ontology_label`).all<Row>(),
  ]);
  for (const r of closure.results ?? []) {
    const t = String(r.term_id);
    if (!used.has(t)) continue;
    (wire.ancestors[t] ??= []).push(String(r.ancestor_id));
  }
  const known = new Set<string>(used);
  for (const a of Object.values(wire.ancestors)) for (const x of a) known.add(x);
  for (const r of labels.results ?? []) if (known.has(String(r.term_id))) wire.labels[String(r.term_id)] = String(r.label);
  for (const r of syn.results ?? []) {
    const t = String(r.term_id);
    if (!known.has(t)) continue;
    const k = normLabel(String(r.label_norm));
    const l = (wire.synonyms[k] ??= []);
    if (!l.includes(t)) l.push(t);
  }
  return wire;
}

/** In-memory form: indices and descendant sets. */
export function hydrateFacts(w: FactsWire, bytes: number, source: SampleFacts["source"]): SampleFacts {
  const index = new Map<string, number>();
  w.gsm.forEach((g, i) => index.set(g, i));
  const termSamples = new Map<string, Map<string, Int32Array>>();
  for (const [attr, m] of Object.entries(w.terms)) termSamples.set(attr, new Map(Object.entries(m).map(([t, a]) => [t, Int32Array.from(a)])));
  const descendants = new Map<string, Set<string>>();
  const idCase = new Map<string, string>();
  const addCase = (t: string) => idCase.set(t.toLowerCase(), t);
  for (const [t, anc] of Object.entries(w.ancestors)) {
    addCase(t);
    for (const a of [t, ...anc]) {
      addCase(a);
      let s = descendants.get(a);
      if (!s) descendants.set(a, (s = new Set()));
      s.add(t);
    }
  }
  for (const m of termSamples.values()) for (const t of m.keys()) {
    addCase(t);
    if (!descendants.has(t)) descendants.set(t, new Set([t]));
  }
  for (const t of Object.keys(w.labels)) addCase(t);
  return { ...w, n: w.gsm.length, index, termSamples, descendants, idCase, bytes, source };
}

const SNAPSHOT_TTL_S = 3600;
const SNAPSHOT_URL = "https://singlet.bio/__internal/cell-search/sample-facts";
let memo: { at: number; facts: Promise<SampleFacts> } | null = null;

/** Test hook. */
export function clearFactsMemo(): void {
  memo = null;
}

/** The snapshot: this isolate's copy (an hour), else the colo's Cache API copy (an hour), else a fresh build from D1. */
export async function sampleFacts(db: D1Database, waitUntil?: (p: Promise<unknown>) => void, now = Date.now()): Promise<SampleFacts> {
  if (memo && now - memo.at < SNAPSHOT_TTL_S * 1000) return memo.facts;
  const p = (async (): Promise<SampleFacts> => {
    const hour = Math.floor(now / (SNAPSHOT_TTL_S * 1000));
    const key = new Request(`${SNAPSHOT_URL}?h=${hour}&v=1`);
    let cache: Cache | null = null;
    try {
      cache = (caches as unknown as { default?: Cache }).default ?? null;
    } catch {
      cache = null;
    }
    if (cache) {
      const hit = await cache.match(key).catch(() => undefined);
      if (hit) {
        const text = await hit.text();
        return hydrateFacts(JSON.parse(text) as FactsWire, text.length, "edge");
      }
    }
    const wire = await buildFacts(db);
    const text = JSON.stringify(wire);
    if (cache) {
      const put = cache.put(key, new Response(text, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${SNAPSHOT_TTL_S}` } })).catch(() => undefined);
      if (waitUntil) waitUntil(put);
    }
    return hydrateFacts(wire, text.length, "d1");
  })();
  memo = { at: now, facts: p };
  p.catch(() => {
    if (memo?.facts === p) memo = null;
  });
  return p;
}
