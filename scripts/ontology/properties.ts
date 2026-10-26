/**
 * Derived sample properties (docs/CELL-ARCHITECTURE.md section 5, schema/035): value-level rules that place a
 * sample_attr value into one property value. build.ts writes the matches to `property_value_map`;
 * scripts/ontology/properties.sql joins them to the samples. Pure functions, no I/O.
 *
 *   perturbation   treated | genetic | control
 *   sample_kind    cell_line | stem_cell | organoid | xenograft | primary
 *
 * donor_status (healthy | diseased) needs no rules here: properties.sql reads it from sample_term disease terms.
 * A value no rule reads gives no row; nothing is inferred from the absence of a fact.
 */
import { normLabel } from "../../functions/_shared/ontology";

export const PROPERTY_VERSION = "props-2026-10-23";

export interface PropertyMatch {
  property: "perturbation" | "sample_kind";
  value: string;
  confidence: number;
  evidence: string;
}

/** Which column of sample_attr a rule reads: the normalised value, or the raw text where value_norm is the key name. */
export const MATCH_ON: Record<string, "value_norm" | "value_raw"> = {
  treatment_status: "value_norm",
  genotype: "value_norm",
  sample_type: "value_raw",
  tissue: "value_norm",
  cell_type_sorted: "value_norm",
};

// Genetic modification written into a genotype value. Strain names alone ("C57BL/6J", "BALB/c") are wild type; a donor's
// own karyotype ("trisomy 21") is not a perturbation and matches neither.
// Engineering words only: "BRCA1 mutation" or "16p11.2 deletion" describe a patient, not an experiment, and match neither.
const MODIFIED = /(?:^|[^a-z])(?:ko|kd|cko|tg)(?:$|[^a-z])|-\/-|\+\/-|\bfl\/fl\b|\bfl\/\+|flox|knock ?(?:out|down|in)|deficient mice|transgen|\bcre\b|cre[+-]|creert|crispr|sg ?rna|sh ?rna|si ?rna|overexpress|transduc|\bdb\/db\b|lepr ?db|\bob\/ob\b|\bapc ?min\b/;
const WILD = /^(?:wt|wild ?type|wildtype|control|normal|wt control|wild-type|c57bl\/?6[jn]?|c57bl6[jn]?|c57\/?bl6|b6|balb\/c|cd1|cd-1|fvb|wt fvb|sprague dawley|129|nod|dba\/2j?)$/;

export function perturbationOf(attr: string, value: string): PropertyMatch | null {
  const v = value.trim().toLowerCase();
  if (attr === "treatment_status") {
    if (v === "treated") return { property: "perturbation", value: "treated", confidence: 0.85, evidence: "treatment_status treated" };
    if (v === "untreated" || v === "vehicle") return { property: "perturbation", value: "control", confidence: 0.85, evidence: `treatment_status ${v}` };
    return null;
  }
  if (attr === "genotype") {
    if (WILD.test(v.replace(/\s+/g, " "))) return { property: "perturbation", value: "control", confidence: 0.7, evidence: `genotype "${value}" (wild type or strain)` };
    if (MODIFIED.test(v)) return { property: "perturbation", value: "genetic", confidence: 0.8, evidence: `genotype "${value}"` };
  }
  return null;
}

// Common cell lines by name (normalised). Not exhaustive: a value not listed stays unclassified.
const CELL_LINES = new Set([
  "hek293", "hek293t", "hek293ft", "hek 293", "293t", "k562", "jurkat", "hepg2", "hela", "a549", "mcf7", "mcf 7", "mda mb 231",
  "mda mb 468", "hct116", "ht29", "caco 2", "sw480", "lncap", "c4 2b", "22rv1", "pc3", "du145", "vcap", "u2os", "u937", "thp 1",
  "thp1", "hl 60", "molm 13", "mv4 11", "kasumi 1", "oci aml3", "nalm6", "raji", "daudi", "ramos", "gm12878", "imr 90", "imr90",
  "bj", "wi 38", "rpe 1", "rpe1", "arpe 19", "pc9", "h1299", "h358", "h460", "bxpc3", "panc 1", "capan 1", "aspc 1", "huh7",
  "hap1", "skbr3", "t47d", "bt474", "sum159", "mcf10a", "u87", "u251", "sh sy5y", "sk n sh", "kelly", "be2c", "a375", "sk mel 28",
  "wm266 4", "hmec", "huvec", "nih3t3", "nih 3t3", "3t3", "c2c12", "raw264 7", "raw 264 7", "b16", "b16f10", "4t1", "ct26", "mc38",
  "ly2", "karpas 422", "oci ly1", "oci ly3", "cho", "vero", "mdck",
]);
const STEM = /^(?:h ?esc|esc|es cells?|h ?ipsc|ipsc|i ps|ips|hpsc|psc|h1|h9|h7|wtc11|wtc 11|kolf2 1j|kolf2|m ?esc|e14|r1|v6 5)(?:\s.*)?$/;

export function sampleKindOf(attr: string, value: string): PropertyMatch | null {
  const v = normLabel(value);
  if (!v) return null;
  if (attr === "sample_type") {
    if (/^(?:primary (?:cells?|tissue)|tissue|autopsy|biopsy|surgical resection|fresh tissue)$/.test(v)) return { property: "sample_kind", value: "primary", confidence: 0.75, evidence: `cell line field "${value}"` };
    if (STEM.test(v)) return { property: "sample_kind", value: "stem_cell", confidence: 0.85, evidence: `cell line "${value}"` };
    const name = v.replace(/\b(?:cell ?line|cells?|human|parental|wild ?type|wt)\b/g, " ").replace(/\s+/g, " ").trim();
    if (CELL_LINES.has(name)) return { property: "sample_kind", value: "cell_line", confidence: 0.9, evidence: `cell line "${value}"` };
    return null;
  }
  if (attr === "tissue" || attr === "cell_type_sorted") {
    if (/\borganoids?\b|\bassembloids?\b|\bgastruloids?\b/.test(v)) return { property: "sample_kind", value: "organoid", confidence: 0.85, evidence: `${attr} "${value}"` };
    if (/\bxenografts?\b|\bpdx\b|\bcdx\b/.test(v)) return { property: "sample_kind", value: "xenograft", confidence: 0.85, evidence: `${attr} "${value}"` };
    if (attr === "tissue" && /^cell lines?$/.test(v)) return { property: "sample_kind", value: "cell_line", confidence: 0.8, evidence: `tissue "${value}"` };
    if (attr === "cell_type_sorted" && /\b(?:ipsc|i ps|esc|hpsc|psc|pluripotent|embryonic stem)\b/.test(v)) return { property: "sample_kind", value: "stem_cell", confidence: 0.8, evidence: `cell type "${value}"` };
  }
  return null;
}

export function propertiesOf(attr: string, value: string): PropertyMatch[] {
  return [perturbationOf(attr, value), sampleKindOf(attr, value)].filter((m): m is PropertyMatch => m !== null);
}
