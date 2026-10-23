/**
 * Deterministic value -> ontology term matching (docs/ONTOLOGY.md). Pure functions; scripts/ontology/build.ts
 * does the I/O.
 *
 * A value is matched against the primary labels and synonyms of the attribute's ontology after the shared
 * normalisation (functions/_shared/ontology.ts normLabel), then after removing qualifiers that do not change the
 * entity ("human", "primary", "tissue", plural endings). A match must be unique at its tier: a string two terms
 * share as label or exact synonym is ambiguous and stays unmapped. Curated aliases (./aliases.ts) cover common
 * abbreviations the ontologies do not list. Ages are placed in the narrowest developmental stage whose
 * start/end interval contains them.
 */
import { normLabel } from "../../functions/_shared/ontology";
import type { OboTerm } from "./obo";
import { ALIASES, type Alias } from "./aliases";

export const MAPPER_VERSION = "onto-map-2026-10-23";

/** sample_attr.attr -> filter attribute and the ontologies its values map into. */
export const SOURCE_ATTRS: Record<string, { target: string; ontologies: string[] }> = {
  tissue: { target: "tissue", ontologies: ["UBERON"] },
  cell_type_sorted: { target: "cell_type", ontologies: ["CL"] },
  // PATO "normal" comes only from the curated healthy/control aliases, never from label matching.
  disease: { target: "disease", ontologies: ["MONDO"] },
  ancestry: { target: "ancestry", ontologies: ["HANCESTRO"] },
  sex: { target: "sex", ontologies: ["PATO"] },
  life_stage: { target: "development_stage", ontologies: ["HsapDv", "MmusDv"] },
  age: { target: "development_stage", ontologies: ["HsapDv", "MmusDv"] },
};

/** Ontologies a mapped term may come from, per source attribute (matching ontologies plus curated extras). */
export const TARGET_ONTOLOGIES: Record<string, string[]> = { disease: ["MONDO", "PATO"] };

/** Roots and near-roots: true of every value, so a value that only reaches one of these stays unmapped. */
export const TOO_GENERAL = new Set([
  "CL:0000000", "CL:0000003", "CL:0000255", "CL:0000548",
  "UBERON:0001062", "UBERON:0000465", "UBERON:0000061", "UBERON:0010000", "UBERON:0000468", "UBERON:0000062", "UBERON:0000479",
  "MONDO:0000001", "MONDO:0700096",
]);

/** Ontologies whose closure follows part_of as well as is_a. */
export const PART_OF_ONTOLOGIES = new Set(["UBERON", "HsapDv", "MmusDv"]);

export type Method = "id" | "label" | "exact_synonym" | "synonym" | "variant" | "curated" | "stage";

export interface Mapping {
  term_id: string;
  method: Method;
  confidence: number;
  evidence: string;
}

type Tier = 0 | 1 | 2; // label, exact synonym, related/narrow synonym
const TIER_CONF: Record<Tier, number> = { 0: 0.95, 1: 0.9, 2: 0.75 };
const TIER_METHOD: Record<Tier, Method> = { 0: "label", 1: "exact_synonym", 2: "synonym" };

export interface LabelIndex {
  /** normalised string -> per tier, the term ids carrying it. */
  byKey: Map<string, { tier: Tier; ids: Set<string>; text: string }[]>;
  terms: Map<string, OboTerm>;
}

export function ontologyOf(id: string): string {
  return id.slice(0, id.indexOf(":"));
}

export function buildLabelIndex(terms: Map<string, OboTerm>, ontologies: string[]): LabelIndex {
  const byKey: LabelIndex["byKey"] = new Map();
  const add = (key: string, tier: Tier, id: string, text: string) => {
    if (!key) return;
    let tiers = byKey.get(key);
    if (!tiers) byKey.set(key, (tiers = []));
    let t = tiers.find((x) => x.tier === tier);
    if (!t) tiers.push((t = { tier, ids: new Set(), text }));
    t.ids.add(id);
  };
  for (const t of terms.values()) {
    // MONDO keeps "X, non-human animal" twins of human diseases; GEO samples name the disease, not the twin.
    if (t.obsolete || !ontologies.includes(ontologyOf(t.id)) || /non-human animal/.test(t.name)) continue;
    add(normLabel(t.name), 0, t.id, t.name);
    for (const s of t.synonyms) {
      if (s.scope === "BROAD") continue;
      add(normLabel(s.text), s.scope === "EXACT" ? 1 : 2, t.id, s.text);
    }
  }
  return { byKey, terms };
}

/** The unique term for one normalised string, best tier first; null when absent or ambiguous at that tier. */
function lookup(index: LabelIndex, key: string): { id: string; tier: Tier; text: string } | null | "ambiguous" {
  const tiers = index.byKey.get(key);
  if (!tiers) return null;
  for (const tier of [0, 1, 2] as Tier[]) {
    const t = tiers.find((x) => x.tier === tier);
    if (!t) continue;
    if (t.ids.size === 1) return { id: [...t.ids][0], tier, text: t.text };
    // Several terms share it at this tier; a label beats synonyms of other terms, so only a label tie is final.
    return "ambiguous";
  }
  return null;
}

const LEADING = /^(?:human|homo sapiens|mouse|mice|murine|mus musculus|primary|whole|fresh|frozen|normal|healthy|adult|total|isolated|sorted|facs sorted|purified|dissociated)\s+/;
const TRAILING = /\s+(?:tissues?|samples?|biops(?:y|ies)|specimens?|sections?|organoids?|from (?:human|mouse|mice|patients?|donors?)|of (?:human|mouse|mice))$/;

/** Forms of a normalised value worth trying after the value itself, in order. */
export function variants(base: string, attr: string): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    v = v.replace(/\s+/g, " ").trim();
    if (v && v !== base && !out.includes(v)) out.push(v);
  };
  let v = base;
  for (let i = 0; i < 3; i++) {
    const next = v.replace(LEADING, "").replace(TRAILING, "");
    if (next === v) break;
    v = next;
    push(v);
  }
  for (const w of [base, v]) {
    // Plural endings: "t cells" -> "t cell", "monocytes" -> "monocyte", "b lymphocytes" -> "b lymphocyte".
    push(w.replace(/\bcells\b/g, "cell"));
    push(w.replace(/(\w{3,}[^s])s$/, "$1"));
    push(w.replace(/(\w{3,})ies$/, "$1y"));
    if (attr === "cell_type_sorted") {
      push(w.replace(/\bcells?\b$/, "").trim());
      if (!/\bcells?$/.test(w)) push(`${w} cell`);
      // "cd8 t" / "cd4 t cell" -> the alpha-beta forms CL labels use.
      push(w.replace(/\b(cd4|cd8) t cells?\b/, "$1 positive alpha beta t cell"));
      push(w.replace(/\b(cd\d+[a-z]?)\b/g, "$1 positive"));
      // "blood monocytes" -> "monocyte": where a circulating cell was taken from is not part of its type.
      const unblood = w.replace(/^(?:peripheral blood|blood|circulating)\s+(?=[a-z])/, "");
      if (unblood !== w) {
        push(unblood);
        push(unblood.replace(/\bcells\b/g, "cell").replace(/(\w{3,}[^s])s$/, "$1"));
      }
      // Sort markers before a type name the type: "cd3 t cells" -> "t cell", "cd11b myeloid cells" -> "myeloid cell".
      const unmarked = w.replace(/^(?:(?:cd\d+[a-z]?|lin|epcam|live)\s+(?:positive\s+|negative\s+|hi\s+|low\s+)?)+/, "");
      if (unmarked !== w && /^[a-z]{3,}|^[a-z] cells?$/.test(unmarked)) {
        push(unmarked);
        push(unmarked.replace(/\bcells\b/g, "cell"));
      }
    }
  }
  return out;
}

export interface MatchContext {
  index: LabelIndex;
  aliases?: Alias[];
}

/** Deterministic mapping of one value for one source attribute, or null. */
export function matchValue(attr: string, value: string, ctx: MatchContext): Mapping | null {
  const spec = SOURCE_ATTRS[attr];
  if (!spec) return null;
  const base = normLabel(value);
  if (!base) return null;

  // An ontology id written as the value.
  const idm = /\b([A-Za-z]+)[:_](\d{5,})\b/.exec(value);
  if (idm) {
    const prefix = spec.ontologies.find((o) => o.toLowerCase() === idm[1].toLowerCase());
    const id = prefix ? `${prefix}:${idm[2]}` : null;
    const term = id ? ctx.index.terms.get(id) : undefined;
    if (term && !term.obsolete) return { term_id: term.id, method: "id", confidence: 0.99, evidence: `id ${term.id}` };
  }

  for (const a of ctx.aliases ?? ALIASES) {
    if (a.attr === attr && a.values.includes(base)) return { term_id: a.term, method: "curated", confidence: a.confidence ?? 0.9, evidence: `curated: ${a.note}` };
  }

  const direct = lookup(ctx.index, base);
  if (direct === "ambiguous") return null;
  // Related and narrow synonyms of short strings are mostly other things' abbreviations ("CD" -> Cowden disease).
  if (direct && (TOO_GENERAL.has(direct.id) || (direct.tier === 2 && base.replace(/ /g, "").length < 6))) return null;
  if (direct) return { term_id: direct.id, method: TIER_METHOD[direct.tier], confidence: TIER_CONF[direct.tier], evidence: `${TIER_METHOD[direct.tier]} "${direct.text}"` };

  for (const v of variants(base, attr)) {
    for (const a of ctx.aliases ?? ALIASES) {
      if (a.attr === attr && a.values.includes(v)) return { term_id: a.term, method: "curated", confidence: Math.min(0.85, a.confidence ?? 0.9), evidence: `curated: ${a.note} (as "${v}")` };
    }
    const hit = lookup(ctx.index, v);
    if (hit === "ambiguous" || !hit || hit.tier === 2 || TOO_GENERAL.has(hit.id)) continue;
    // An organoid is a model of the organ, not the organ: kept, at lower confidence and said so.
    const organoid = /\borganoids?\b/.test(base);
    return {
      term_id: hit.id,
      method: "variant",
      confidence: organoid ? 0.7 : hit.tier === 0 ? 0.85 : 0.8,
      evidence: `${TIER_METHOD[hit.tier]} "${hit.text}" after reading "${value}" as "${v}"${organoid ? " (organoid)" : ""}`,
    };
  }
  return null;
}

// ── developmental stage ──────────────────────────────────────────────────────

/** A stage interval in days after birth (negative before birth) or days post conception for embryos. */
interface StageInterval {
  id: string;
  start: number;
  end: number;
}

const DAYS = { day: 1, week: 7, month: 30.4375, year: 365.25 };
/** Mouse gestation is about 19 days, human about 266 from conception. */
const GESTATION_DAYS: Record<string, number> = { HsapDv: 266, MmusDv: 19 };

/** The stage intervals of one developmental-stage ontology, on the days-after-birth axis. */
export function stageIntervals(terms: Map<string, OboTerm>, ontology: "HsapDv" | "MmusDv"): StageInterval[] {
  const gest = GESTATION_DAYS[ontology];
  const out: StageInterval[] = [];
  for (const t of terms.values()) {
    if (t.obsolete || ontologyOf(t.id) !== ontology) continue;
    const p = t.props;
    const pick = (kind: "start" | "end"): number | null => {
      if (p[`${kind}_ypb`] != null) return p[`${kind}_ypb`] * DAYS.year;
      if (p[`${kind}_mpb`] != null) return p[`${kind}_mpb`] * DAYS.month;
      if (p[`${kind}_wpb`] != null) return p[`${kind}_wpb`] * DAYS.week;
      if (p[`${kind}_dpb`] != null) return p[`${kind}_dpb`];
      if (p[`${kind}_dpf`] != null) return p[`${kind}_dpf`] - gest;
      if (p[`${kind}_dpc`] != null) return p[`${kind}_dpc`] - gest;
      return null;
    };
    const start = pick("start");
    // A stage with a start and no end is open-ended ("late adult stage", 60 years and over).
    const end = pick("end") ?? (start != null && start >= 0 ? Infinity : null);
    if (start == null || end == null || end <= start) continue;
    out.push({ id: t.id, start, end });
  }
  return out;
}

/** The narrowest interval containing [lo, hi] (days after birth), or null. Ties go to the lower id. */
export function placeInStage(intervals: StageInterval[], lo: number, hi: number): StageInterval | null {
  let best: StageInterval | null = null;
  for (const s of intervals) {
    if (s.start <= lo && hi < s.end) {
      if (!best || s.end - s.start < best.end - best.start || (s.end - s.start === best.end - best.start && s.id < best.id)) best = s;
    }
  }
  return best;
}

export interface AgeFact {
  organism: string;
  value_norm: string;
  value_raw: string;
  unit: string | null;
  value_num: number | null;
}

/**
 * Age -> [lo, hi] in days after birth, or null when the reading is not certain. Mouse ages in days, weeks, months
 * or years are postnatal; "E" days are post conception. Human ages in years and months are postnatal; human days
 * and weeks are left alone unless the text says post-conception/gestation (fetal) or postnatal, because GEO uses
 * both.
 */
export function ageRange(f: AgeFact): { lo: number; hi: number; why: string } | null {
  const raw = `${f.value_raw} ${f.value_norm}`.toLowerCase();
  const nums = (f.value_norm.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length && f.value_num == null) return null;
  const lo0 = nums.length ? Math.min(...nums.slice(0, 2)) : f.value_num!;
  const hi0 = nums.length ? Math.max(...nums.slice(0, 2)) : f.value_num!;
  if (nums.length > 2) return null;
  const human = f.organism === "Homo sapiens";
  const mouse = f.organism === "Mus musculus";
  if (!human && !mouse) return null;
  const unit = (f.unit ?? "").toLowerCase();
  const prenatal = /post.?conception|\bpcw\b|gestation|\bgw\b|fetal|foetal|embryonic|\bpcd\b/.test(raw);
  const postnatal = /post.?natal|\bpnd\b|after birth|\bp\d/.test(raw);
  const gest = human ? GESTATION_DAYS.HsapDv : GESTATION_DAYS.MmusDv;
  if (unit === "e-days") return mouse ? { lo: lo0 - gest, hi: hi0 - gest, why: "embryonic day" } : null;
  if (unit === "postnatal days") return { lo: lo0, hi: hi0, why: "postnatal day" };
  const mult = unit.startsWith("year") ? DAYS.year : unit.startsWith("month") ? DAYS.month : unit.startsWith("week") ? DAYS.week : unit.startsWith("day") ? DAYS.day : null;
  if (mult == null) return null;
  if (prenatal) {
    // Gestational weeks/days counted from conception.
    if (unit.startsWith("year") || unit.startsWith("month")) return null;
    return { lo: lo0 * mult - gest, hi: hi0 * mult - gest, why: "post conception" };
  }
  if (human && (unit.startsWith("week") || unit.startsWith("day")) && !postnatal) return null;
  return { lo: lo0 * mult, hi: hi0 * mult, why: "after birth" };
}

/** life_stage value -> stage term per ontology (ids checked against the OBO by the tests; obsolete twins skipped). */
export const LIFE_STAGE_TERMS: Record<string, { HsapDv?: string; MmusDv?: string }> = {
  embryonic: { HsapDv: "HsapDv:0000002", MmusDv: "MmusDv:0000002" },
  fetal: { HsapDv: "HsapDv:0000037", MmusDv: "MmusDv:0000031" },
  neonatal: { HsapDv: "HsapDv:0000262" },
  pediatric: { HsapDv: "HsapDv:0000264" },
  adult: { HsapDv: "HsapDv:0000258", MmusDv: "MmusDv:0000110" },
  // The extractor calls 65 and over "aged"; HsapDv's open-ended late adult stage starts at 60.
  aged: { HsapDv: "HsapDv:0000227" },
};
