/**
 * A plain-English cell question -> a cell-search filter (./query.ts), shown back as the filters it read.
 *
 * Vocabulary first, as the catalog search does (../interpret.ts): the longest phrase that is a label or synonym of a term the atlas uses
 * (CL cell types of the cell index, UBERON tissues, MONDO diseases, HsapDv/MmusDv stages, HANCESTRO ancestries; ontology_label synonyms;
 * a few common abbreviations), plus sex words, organisms and the sample properties. "not", "non-", "without", "excluding" negate the next
 * phrase; several values of one field are OR-ed ("lung or liver", "T cells and B cells"); different fields are AND-ed. Words the
 * vocabulary cannot place are returned as `unparsed`; the endpoint may hand them to the catalog's interpreter (the model) for groups.
 */
import { organismToScientific } from "../vocab";
import type { CellIndex } from "./atlas-index";
import { fieldDef } from "./fields";
import { ANCESTRY_ALIASES, CELL_TYPE_ALIASES, STAGE_ALIASES, type Expr, type Leaf } from "./query";
import { normLabel, type SampleFacts } from "./sample-facts";
import { HANCESTRO_LABELS } from "../hancestro";

export interface Reading {
  text: string;
  field: string;
  level: string;
  values: string[];
  labels: string[];
  negated: boolean;
}

export interface NlParse {
  where: Expr | null;
  readings: Reading[];
  unparsed: string[];
}

interface Entry {
  field: string;
  values: string[];
}

/** Field preference when a phrase names terms in several ontologies. */
const FIELD_ORDER = ["sex", "ancestry", "cell_type", "development_stage", "disease", "tissue", "organism", "donor_status", "tissue_type", "tumor_sample_type", "sample_kind", "perturbation", "assay"];

const STOP = new Set(
  "a an the of from in on at to for with and by as that which are is were was be all any show me find get give list cells cell samples sample studies study donors donor patients patient people individuals subjects tissue tissues derived origin ancestry descent".split(
    " "
  )
);
const NEGATE = new Set(["not", "no", "non", "without", "excluding", "except", "exclude", "but"]);

const SEX_WORDS: Record<string, string> = { female: "female", females: "female", woman: "female", women: "female", girl: "female", girls: "female", male: "male", males: "male", man: "male", men: "male", boy: "male", boys: "male" };
const PROPERTY_WORDS: Record<string, Entry> = {
  healthy: { field: "donor_status", values: ["healthy"] },
  "healthy donor": { field: "donor_status", values: ["healthy"] },
  diseased: { field: "donor_status", values: ["diseased"] },
  organoid: { field: "tissue_type", values: ["organoid"] },
  organoids: { field: "tissue_type", values: ["organoid"] },
  "cell line": { field: "tissue_type", values: ["cell line"] },
  "cell lines": { field: "tissue_type", values: ["cell line"] },
  "primary cell culture": { field: "tissue_type", values: ["primary cell culture"] },
  "primary culture": { field: "tissue_type", values: ["primary cell culture"] },
  "adjacent normal": { field: "tumor_sample_type", values: ["adjacent normal"] },
  metastatic: { field: "tumor_sample_type", values: ["metastatic"] },
  metastasis: { field: "tumor_sample_type", values: ["metastatic"] },
  xenograft: { field: "sample_kind", values: ["xenograft"] },
  "stem cell derived": { field: "sample_kind", values: ["stem_cell"] },
  "ipsc derived": { field: "sample_kind", values: ["stem_cell"] },
  primary: { field: "sample_kind", values: ["primary"] },
  treated: { field: "perturbation", values: ["treated"] },
  knockout: { field: "perturbation", values: ["genetic"] },
  "genetically perturbed": { field: "perturbation", values: ["genetic"] },
  untreated: { field: "perturbation", values: ["control"] },
};
/** British spellings the ontologies write the American way. */
const SPELLING: [RegExp, string][] = [
  [/tumour/g, "tumor"],
  [/foetal/g, "fetal"],
  [/oesophag/g, "esophag"],
  [/haem/g, "hem"],
  [/anaem/g, "anem"],
  [/oedema/g, "edema"],
  [/leukaem/g, "leukem"],
  [/paediatric/g, "pediatric"],
];

let dictMemo: { key: string; dict: Map<string, Entry[]>; maxLen: number } | null = null;

function dictionary(idx: CellIndex, facts: SampleFacts): { dict: Map<string, Entry[]>; maxLen: number } {
  const key = `${idx.version}|${facts.built_at}`;
  if (dictMemo?.key === key) return dictMemo;
  const dict = new Map<string, Entry[]>();
  const add = (phrase: string, field: string, id: string) => {
    const p = normLabel(phrase);
    if (!p || p.length < 2 || STOP.has(p)) return;
    const list = dict.get(p) ?? [];
    const e = list.find((x) => x.field === field);
    if (e) {
      if (!e.values.includes(id)) e.values.push(id);
    } else list.push({ field, values: [id] });
    dict.set(p, list);
  };
  // cell types the index can match (a term or an ancestor of a call)
  const cl = new Set<string>();
  for (const e of idx.cellTypes) if (e.id) [e.id, ...(e.anc ?? []), ...(facts.ancestors[e.id] ?? [])].forEach((x) => cl.add(x));
  for (const id of cl) if (idx.terms[id] ?? facts.labels[id]) add(idx.terms[id] ?? facts.labels[id], "cell_type", id);
  for (const e of idx.cellTypes) if (e.id) add(e.label, "cell_type", e.id);
  for (const [p, ids] of Object.entries(CELL_TYPE_ALIASES)) ids.forEach((id) => add(p, "cell_type", id));
  // sample ontology terms in use (and their ancestors)
  const attrField: Record<string, string> = { tissue: "tissue", disease: "disease", development_stage: "development_stage" };
  const ontField = (id: string): string | null =>
    id.startsWith("UBERON:") ? "tissue" : id.startsWith("MONDO:") ? "disease" : /^(HsapDv|MmusDv):/.test(id) ? "development_stage" : null;
  const usable = new Set<string>();
  for (const [attr, m] of facts.termSamples) if (attrField[attr]) for (const t of m.keys()) [t, ...(facts.ancestors[t] ?? [])].forEach((a) => usable.add(a));
  for (const [id, label] of Object.entries(facts.labels)) {
    const f = ontField(id);
    if (f && usable.has(id)) add(label, f, id);
  }
  for (const [syn, ids] of Object.entries(facts.synonyms))
    for (const id of ids) {
      const f = ontField(id);
      if (f && usable.has(id)) add(syn, f, id);
      if (id.startsWith("CL:") && cl.has(id)) add(syn, "cell_type", id);
    }
  for (const [p, ids] of Object.entries(STAGE_ALIASES)) ids.forEach((id) => add(p, "development_stage", id));
  for (const [p, ids] of Object.entries(ANCESTRY_ALIASES)) ids.forEach((id) => add(p, "ancestry", id));
  for (const [id, l] of Object.entries(HANCESTRO_LABELS)) add(l, "ancestry", id);
  for (const [w, s] of Object.entries(SEX_WORDS)) add(w, "sex", s);
  for (const [p, e] of Object.entries(PROPERTY_WORDS)) e.values.forEach((v) => add(p, e.field, v));
  for (const org of facts.vocab.organism) add(org, "organism", org);
  for (const a of facts.vocab.assay) if (!/unknown|version unconfirmed|not single/i.test(a)) add(a, "assay", a);
  let maxLen = 1;
  for (const p of dict.keys()) maxLen = Math.max(maxLen, p.split(" ").length);
  dictMemo = { key, dict, maxLen: Math.min(maxLen, 8) };
  return dictMemo;
}

function variants(p: string): string[] {
  const out = new Set<string>([p]);
  let am = p;
  for (const [re, to] of SPELLING) am = am.replace(re, to);
  out.add(am);
  for (const x of [...out]) {
    const words = x.split(" ");
    const last = words[words.length - 1];
    const sing = last.endsWith("ies") ? last.slice(0, -3) + "y" : last.endsWith("ses") ? last.slice(0, -2) : last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
    out.add([...words.slice(0, -1), sing].join(" "));
    // "t cells from" -> "t cell": a plural inner word ("cells") before a qualifier is rare; leave it
  }
  return [...out];
}

function tokenize(q: string): string[] {
  return normLabel(q)
    .replace(/[“”"(),;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Read a question with the vocabulary alone (pure). */
export function parseCellQuestion(q: string, idx: CellIndex, facts: SampleFacts): NlParse {
  const { dict, maxLen } = dictionary(idx, facts);
  const toks = tokenize(q);
  const readings: Reading[] = [];
  const unparsed: string[] = [];
  let neg = false;
  let orNext = false;
  const label = (field: string, v: string) => idx.terms[v] ?? facts.labels[v] ?? HANCESTRO_LABELS[v] ?? v;
  for (let i = 0; i < toks.length; ) {
    const t = toks[i];
    if (NEGATE.has(t)) {
      neg = true;
      i++;
      continue;
    }
    if (t === "or") {
      orNext = true;
      i++;
      continue;
    }
    let hit: { len: number; entry: Entry; text: string } | null = null;
    for (let L = Math.min(maxLen, toks.length - i); L >= 1 && !hit; L--) {
      const phrase = toks.slice(i, i + L).join(" ");
      for (const v of variants(phrase)) {
        const list = dict.get(v);
        if (!list) continue;
        const entry = [...list].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field))[0];
        hit = { len: L, entry, text: phrase };
        break;
      }
      // organisms by common name ("human", "mouse"), when the atlas has them
      if (!hit && L <= 2) {
        const sci = organismToScientific(phrase);
        if (sci && facts.vocab.organism.includes(sci)) hit = { len: L, entry: { field: "organism", values: [sci] }, text: phrase };
      }
    }
    if (!hit && /^non-./.test(t)) {
      // "non-small cell lung carcinoma" is a term; "non-T cells" negates what follows
      neg = true;
      toks[i] = t.slice(4);
      continue;
    }
    if (!hit) {
      if (!STOP.has(t) && t !== "and") unparsed.push(t);
      i++;
      continue;
    }
    const sameField = readings.find((r) => r.field === hit!.entry.field && r.negated === neg);
    if (sameField && (orNext || !neg)) {
      for (const v of hit.entry.values) if (!sameField.values.includes(v)) sameField.values.push(v);
      sameField.labels = sameField.values.map((v) => label(sameField.field, v));
      sameField.text += ` / ${hit.text}`;
    } else {
      const def = fieldDef(hit.entry.field)!;
      readings.push({ text: hit.text, field: def.name, level: def.level, values: [...hit.entry.values], labels: hit.entry.values.map((v) => label(def.name, v)), negated: neg });
    }
    neg = false;
    orNext = false;
    i += hit.len;
  }
  return { where: toWhere(readings), readings, unparsed };
}

export function toWhere(readings: Reading[]): Expr | null {
  const parts: Expr[] = readings.map((r) => {
    const leaf: Leaf = { field: r.field, any: [...r.values].sort() };
    return r.negated ? { not: leaf } : leaf;
  });
  return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { and: parts };
}
