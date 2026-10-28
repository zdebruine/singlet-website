/**
 * Ontology terms for served samples' sample_attr values that have no sample_term (tissue, disease, age, life_stage).
 *
 *   npx vite-node scripts/metadata-gaps/map_unmapped.ts -- --obo <dir> --values <unmapped_values.json> --ages <age_attrs.json>
 *       [--decisions <model-decisions.jsonl> ...] --out <dir>
 *
 * 1. Deterministic: the 2026-10-23 mapper (onto/map-core.ts, vendored from claude/ontology-filters-46958f): curated aliases, unique
 *    label / exact synonym, variants; ages placed in the narrowest HsapDv / MmusDv stage; life stages from LIFE_STAGE_TERMS.
 * 2. Decisions: model / reviewer decisions (the 2026-10-23 pass, then this pass), validated against the OBO files exactly as build.ts
 *    does (live term, right ontology, not too general, label equal). A null decision keeps a value unmapped.
 * Writes <out>/mapped.jsonl (one row per value with its term), <out>/review.jsonl (values left for review, with the studies that use
 * them) and <out>/unmapped-summary.json. SQL is written by emit_sql.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseObo, type OboTerm } from "./onto/obo";
import { normLabel } from "./onto/ontology";
import {
  LIFE_STAGE_TERMS, MAPPER_VERSION, SOURCE_ATTRS, TARGET_ONTOLOGIES, TOO_GENERAL, ageRange, buildLabelIndex, matchValue, ontologyOf,
  placeInStage, stageIntervals, type LabelIndex,
} from "./onto/map-core";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const args = (k: string) => argv.flatMap((a, i) => (a === `--${k}` && argv[i + 1] ? [argv[i + 1]] : []));
const OBO = arg("obo")!, VALUES = arg("values")!, AGES = arg("ages")!, OUT = arg("out")!;
const FILES: [string, string][] = [["uberon.obo", "UBERON"], ["mondo.obo", "MONDO"], ["pato.obo", "PATO"], ["hsapdv.obo", "HsapDv"], ["mmusdv.obo", "MmusDv"]];

const terms = new Map<string, OboTerm>();
for (const [f, p] of FILES) for (const [id, t] of parseObo(readFileSync(join(OBO, f), "utf8"), [p])) terms.set(id, t);
const indexes = new Map<string, LabelIndex>();
for (const a of ["tissue", "disease"]) indexes.set(a, buildLabelIndex(terms, SOURCE_ATTRS[a].ontologies));
const intervals = { HsapDv: stageIntervals(terms, "HsapDv"), MmusDv: stageIntervals(terms, "MmusDv") };

interface Val { attr: string; value: string; organism: string; n_samples: number; gsm_ids: string[] }
const values: Val[] = JSON.parse(readFileSync(VALUES, "utf8"));
const ageRows: Record<string, any>[] = JSON.parse(readFileSync(AGES, "utf8").slice(readFileSync(AGES, "utf8").indexOf("[")))[0].results;
const ageBy = new Map<string, Record<string, any>>();
for (const r of ageRows) ageBy.set(`${r.attr}|${r.organism ?? ""}|${r.value_norm}`, r);

interface Mapped { attr: string; organism: string; value_norm: string; term_id: string; label: string; method: string; confidence: number; evidence: string; mapper_version: string; n_samples: number }
const mapped: Mapped[] = [];
const review: Val[] = [];
const decided = new Map<string, { term_id: string | null; label?: string; confidence?: number; reason?: string; who: string }>();
for (const p of args("decisions")) {
  if (!existsSync(p)) continue;
  for (const ln of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!ln.trim()) continue;
    const d = JSON.parse(ln);
    // A decision may name an organism (the same word can mean different things in human and mouse studies); "" means any.
    decided.set(`${d.attr}|${d.organism ?? ""}|${d.value_norm}`, { ...d, who: p.includes("1023") ? "model-2026-10-23" : "review-2026-10-28" });
  }
}
const validDecision = (attr: string, id: string, label?: string) => {
  const t = terms.get(id);
  return !!t && !t.obsolete && (TARGET_ONTOLOGIES[attr] ?? SOURCE_ATTRS[attr]?.ontologies ?? []).includes(ontologyOf(t.id)) && !TOO_GENERAL.has(t.id) && (!label || normLabel(label) === normLabel(t.name));
};
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

for (const v of values) {
  const add = (term_id: string, method: string, confidence: number, evidence: string, version = MAPPER_VERSION) => {
    mapped.push({ attr: v.attr, organism: v.attr === "age" || v.attr === "life_stage" ? v.organism : "", value_norm: v.value, term_id, label: terms.get(term_id)?.name ?? "", method, confidence, evidence, mapper_version: version, n_samples: v.n_samples });
    bump(`mapped:${v.attr}:${method}`);
    bump(`mapped_samples:${v.attr}`, v.n_samples);
  };
  if (v.attr === "age" || v.attr === "life_stage") {
    const onto = v.organism === "Homo sapiens" ? "HsapDv" : v.organism === "Mus musculus" ? "MmusDv" : null;
    if (!onto) { bump(`skip:${v.attr}:organism`); continue; }
    if (v.attr === "life_stage") {
      const id = LIFE_STAGE_TERMS[v.value]?.[onto];
      if (id) add(id, "curated", 0.9, `life stage "${v.value}"`);
      else review.push(v);
      continue;
    }
    const a = ageBy.get(`age|${v.organism}|${v.value}`);
    const r = a ? ageRange({ organism: v.organism, value_norm: v.value, value_raw: a.value_raw ?? "", unit: a.unit, value_num: a.value_num }) : null;
    const s = r ? placeInStage(intervals[onto], r.lo, r.hi) : null;
    if (s && r) { add(s.id, "stage", 0.9, `age ${v.value} (${r.why}) within ${terms.get(s.id)!.name}`); continue; }
    // A human age written as a bare range of two-digit numbers ("50-59", "61-70") with no unit is an adult age in years. Mouse bare
    // numbers ("2", "25") stay unmapped: GEO uses weeks, months and days for them.
    const dec = onto === "HsapDv" && a && !a.unit ? /^(\d{2})\s*-\s*(\d{2})$/.exec(v.value) : null;
    const s2 = dec && +dec[1] >= 18 && +dec[2] > +dec[1] ? placeInStage(intervals.HsapDv, +dec[1] * 365.25, (+dec[2] + 1) * 365.25 - 1) : null;
    if (s2) add(s2.id, "stage", 0.85, `age ${v.value} (unitless human range read as years) within ${terms.get(s2.id)!.name}`);
    else review.push(v);
    continue;
  }
  const ctx = { index: indexes.get(v.attr)! };
  const m = matchValue(v.attr, v.value, ctx);
  if (m) { add(m.term_id, m.method, m.confidence, m.evidence); continue; }
  const d = decided.get(`${v.attr}|${v.organism}|${v.value}`) ?? decided.get(`${v.attr}||${v.value}`) ?? decided.get(`${v.attr}||${normLabel(v.value)}`);
  if (d) {
    if (d.term_id && validDecision(v.attr, d.term_id, d.label)) add(d.term_id, "model", d.confidence ?? 0.8, `${d.who}: ${d.reason ?? ""}`.trim(), d.who);
    else if (d.term_id) { bump(`decision_rejected:${v.attr}`); review.push(v); }
    else bump(`decided_null:${v.attr}`);
    continue;
  }
  review.push(v);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "mapped.jsonl"), mapped.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(OUT, "review.jsonl"), review.map((r) => JSON.stringify({ attr: r.attr, value: r.value, organism: r.organism, n_samples: r.n_samples, gsm_ids: r.gsm_ids.slice(0, 5) })).join("\n") + "\n");
counts["review"] = review.length;
counts["review_samples"] = review.reduce((n, r) => n + r.n_samples, 0);
writeFileSync(join(OUT, "unmapped-summary.json"), JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + "\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2));
