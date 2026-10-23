/**
 * Build the ontology slice and the value -> term map (docs/ONTOLOGY.md).
 *
 *   npm run ontology:build -- --obo <dir> --values <values.json> [--model <decisions.jsonl>] --out <dir>
 *
 * --obo     directory with cl.obo (cl-basic), uberon.obo (uberon-basic), mondo.obo, pato.obo, hancestro.obo,
 *           hsapdv.obo, mmusdv.obo (scripts/ontology/fetch-obo.sh)
 * --values  distinct sample_attr values with counts (scripts/ontology/export-values.sh): one JSON array, or the
 *           `wrangler d1 execute --json` envelope, of {attr, organism, value_norm, value_raw, unit, value_num, n,
 *           n_studies}
 * --model   optional decisions from the model pass ({attr, value_norm, term_id, label, confidence, reason}); a
 *           decision is kept only when the id exists, is not obsolete, is in the attribute's ontologies and the
 *           label matches the id's label
 *
 * Writes to --out:
 *   ontology-load.sql   replaces ontology_term, ontology_closure, ontology_label and ontology_value_map
 *   value-map.jsonl     the map, one row per (attr, organism, value_norm, term)
 *   candidates.jsonl    unmapped values with up to 10 candidate terms each (input to the model pass)
 *   coverage.json       values and samples mapped per attribute and method
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normLabel } from "../../functions/_shared/ontology";
import { parseObo, type OboTerm } from "./obo";
import {
  MAPPER_VERSION,
  TARGET_ONTOLOGIES,
  TOO_GENERAL,
  SOURCE_ATTRS,
  PART_OF_ONTOLOGIES,
  LIFE_STAGE_TERMS,
  ageRange,
  buildLabelIndex,
  matchValue,
  ontologyOf,
  placeInStage,
  stageIntervals,
  type LabelIndex,
  type Mapping,
} from "./map-core";
import { ALIASES } from "./aliases";

interface ValueRow {
  attr: string;
  organism: string;
  value_norm: string;
  value_raw: string | null;
  value_raw2?: string | null;
  unit: string | null;
  value_num: number | null;
  n: number;
  n_studies: number;
}

export interface MapRow extends Mapping {
  attr: string;
  organism: string;
  value_norm: string;
  source: "geo" | "model";
}

const FILES: [string, string][] = [
  ["cl.obo", "CL"],
  ["uberon.obo", "UBERON"],
  ["mondo.obo", "MONDO"],
  ["pato.obo", "PATO"],
  ["hancestro.obo", "HANCESTRO"],
  ["hsapdv.obo", "HsapDv"],
  ["mmusdv.obo", "MmusDv"],
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function loadValues(path: string): ValueRow[] {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const rows = Array.isArray(j) && j[0]?.results ? j.flatMap((x: { results: ValueRow[] }) => x.results) : j;
  return rows as ValueRow[];
}

function sqlStr(s: string | null | undefined): string {
  return s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`;
}

function main() {
  const oboDir = arg("obo");
  const valuesPath = arg("values");
  const out = arg("out") ?? "ontology-out";
  if (!oboDir || !valuesPath) {
    console.error("usage: build.ts --obo <dir> --values <values.json> [--model <decisions.jsonl>] --out <dir>");
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });

  // ── load ontologies ──
  const terms = new Map<string, OboTerm>();
  const release: Record<string, string> = {};
  for (const [file, prefix] of FILES) {
    const text = readFileSync(join(oboDir, file), "utf8");
    release[prefix] = /^data-version:\s*(.+)$/m.exec(text)?.[1].trim() ?? "";
    for (const [id, t] of parseObo(text, [prefix])) terms.set(id, t);
  }
  console.error(`terms: ${terms.size}`, release);

  // Every curated alias and life-stage id must name a live term.
  const bad: string[] = [];
  for (const a of ALIASES) {
    const t = terms.get(a.term);
    if (!t || t.obsolete || !(TARGET_ONTOLOGIES[a.attr] ?? SOURCE_ATTRS[a.attr].ontologies).includes(ontologyOf(a.term)) || t.name !== a.label) bad.push(`${a.attr} ${a.term} "${a.label}" is ${t ? `"${t.name}"${t.obsolete ? " (obsolete)" : ""}` : "unknown"}`);
  }
  for (const [stage, ids] of Object.entries(LIFE_STAGE_TERMS)) for (const id of Object.values(ids)) if (!terms.get(id!) || terms.get(id!)!.obsolete) bad.push(`life_stage ${stage} ${id}`);
  if (bad.length) {
    console.error(`unknown or obsolete curated terms:\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }

  const indexes = new Map<string, LabelIndex>();
  for (const [attr, spec] of Object.entries(SOURCE_ATTRS)) indexes.set(attr, buildLabelIndex(terms, spec.ontologies));
  const intervals = { HsapDv: stageIntervals(terms, "HsapDv"), MmusDv: stageIntervals(terms, "MmusDv") };

  // ── map ──
  const values = loadValues(valuesPath).filter((v) => SOURCE_ATTRS[v.attr]);
  const map: MapRow[] = [];
  const seen = new Set<string>();
  const push = (r: MapRow) => {
    const k = `${r.attr}|${r.organism}|${r.value_norm}|${r.term_id}`;
    if (!seen.has(k)) {
      seen.add(k);
      map.push(r);
    }
  };
  for (const v of values) {
    if (v.attr === "life_stage" || v.attr === "age") {
      const onto = v.organism === "Homo sapiens" ? "HsapDv" : v.organism === "Mus musculus" ? "MmusDv" : null;
      if (!onto) continue;
      if (v.attr === "life_stage") {
        const id = LIFE_STAGE_TERMS[v.value_norm]?.[onto];
        if (id) push({ attr: v.attr, organism: v.organism, value_norm: v.value_norm, term_id: id, method: "curated", confidence: 0.9, evidence: `life stage "${v.value_norm}"`, source: "geo" });
        continue;
      }
      const r = ageRange({ organism: v.organism, value_norm: v.value_norm, value_raw: v.value_raw ?? "", unit: v.unit, value_num: v.value_num });
      if (!r) continue;
      const s = placeInStage(intervals[onto], r.lo, r.hi);
      if (s) push({ attr: v.attr, organism: v.organism, value_norm: v.value_norm, term_id: s.id, method: "stage", confidence: 0.9, evidence: `age ${v.value_norm} (${r.why}) within ${terms.get(s.id)!.name}`, source: "geo" });
      continue;
    }
    const ctx = { index: indexes.get(v.attr)! };
    const m = matchValue(v.attr, v.value_norm, ctx) ?? (v.value_raw && v.value_raw !== v.value_norm ? matchValue(v.attr, v.value_raw, ctx) : null);
    if (m) push({ attr: v.attr, organism: "", value_norm: v.value_norm, ...m, source: "geo" });
  }

  // ── model decisions ──
  const modelPath = arg("model");
  let modelKept = 0;
  let modelRejected = 0;
  if (modelPath && existsSync(modelPath)) {
    const mapped = new Set(map.map((r) => `${r.attr}|${r.value_norm}`));
    for (const line of readFileSync(modelPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const d = JSON.parse(line) as { attr: string; value_norm: string; term_id: string | null; label?: string; confidence?: number; reason?: string };
      if (!d.term_id || mapped.has(`${d.attr}|${d.value_norm}`)) continue;
      const t = terms.get(d.term_id);
      const ok = t && !t.obsolete && (TARGET_ONTOLOGIES[d.attr] ?? SOURCE_ATTRS[d.attr]?.ontologies ?? []).includes(ontologyOf(t.id)) && !TOO_GENERAL.has(t.id) && (!d.label || normLabel(d.label) === normLabel(t.name));
      if (!ok) {
        modelRejected++;
        continue;
      }
      modelKept++;
      push({
        attr: d.attr,
        organism: "",
        value_norm: d.value_norm,
        term_id: t!.id,
        method: "model" as Mapping["method"],
        confidence: Math.min(0.8, Math.max(0.5, d.confidence ?? 0.7)),
        evidence: `model: ${(d.reason ?? "").slice(0, 200)}`,
        source: "model",
      });
    }
    console.error(`model decisions kept ${modelKept}, rejected ${modelRejected}`);
  }

  // ── slice and closure ──
  const parents = (t: OboTerm) => {
    const o = ontologyOf(t.id);
    return [...t.isA, ...(PART_OF_ONTOLOGIES.has(o) ? t.partOf : [])].filter((p) => ontologyOf(p) === o && terms.has(p));
  };
  const ancestorsMemo = new Map<string, Map<string, number>>();
  const ancestors = (id: string, stack = new Set<string>()): Map<string, number> => {
    const hit = ancestorsMemo.get(id);
    if (hit) return hit;
    const out = new Map<string, number>([[id, 0]]);
    if (!stack.has(id)) {
      stack.add(id);
      for (const p of parents(terms.get(id)!)) {
        for (const [a, d] of ancestors(p, stack)) {
          const prev = out.get(a);
          if (prev == null || d + 1 < prev) out.set(a, d + 1);
        }
      }
      stack.delete(id);
    }
    ancestorsMemo.set(id, out);
    return out;
  };
  const used = new Set(map.map((r) => r.term_id));
  const slice = new Set<string>();
  for (const id of used) for (const a of ancestors(id).keys()) slice.add(a);
  const depth = (id: string) => {
    let d = 0;
    for (const [a, dist] of ancestors(id)) if (parents(terms.get(a)!).length === 0) d = Math.max(d, dist);
    return d;
  };

  // ── SQL ──
  const lines: string[] = [];
  lines.push(`-- Generated by scripts/ontology/build.ts (${MAPPER_VERSION}) from ${Object.entries(release).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  lines.push("-- Replaces the ontology slice and the value map; run scripts/ontology/refresh.sql afterwards.");
  lines.push("DELETE FROM ontology_closure;", "DELETE FROM ontology_label;", "DELETE FROM ontology_term;", "DELETE FROM ontology_value_map;");
  const batch = (table: string, cols: string, rows: string[]) => {
    for (let i = 0; i < rows.length; i += 200) lines.push(`INSERT OR REPLACE INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + 200).join(",\n")};`);
  };
  const sliceIds = [...slice].sort();
  batch("ontology_term", "term_id, ontology, label, release, depth", sliceIds.map((id) => {
    const t = terms.get(id)!;
    return `(${sqlStr(id)}, ${sqlStr(ontologyOf(id))}, ${sqlStr(t.name)}, ${sqlStr(release[ontologyOf(id)])}, ${depth(id)})`;
  }));
  const closureRows: string[] = [];
  for (const id of sliceIds) for (const [a, d] of ancestors(id)) closureRows.push(`(${sqlStr(id)}, ${sqlStr(a)}, ${d})`);
  batch("ontology_closure", "term_id, ancestor_id, distance", closureRows);
  const labelRows = new Map<string, string>();
  for (const id of sliceIds) {
    const t = terms.get(id)!;
    const o = ontologyOf(id);
    const add = (key: string, kind: string) => {
      if (key && !labelRows.has(`${key}|${id}`)) labelRows.set(`${key}|${id}`, `(${sqlStr(key)}, ${sqlStr(id)}, ${sqlStr(o)}, '${kind}')`);
    };
    add(id.toLowerCase(), "id");
    add(normLabel(t.name), "label");
    for (const s of t.synonyms) if (s.scope === "EXACT") add(normLabel(s.text), "exact");
  }
  batch("ontology_label", "label_norm, term_id, ontology, kind", [...labelRows.values()]);
  batch("ontology_value_map", "attr, organism, value_norm, term_id, method, source, confidence, evidence, mapper_version", map.map((r) =>
    `(${sqlStr(r.attr)}, ${sqlStr(r.organism)}, ${sqlStr(r.value_norm)}, ${sqlStr(r.term_id)}, ${sqlStr(r.method)}, ${sqlStr(r.source)}, ${r.confidence}, ${sqlStr(r.evidence)}, ${sqlStr(MAPPER_VERSION)})`));
  writeFileSync(join(out, "ontology-load.sql"), lines.join("\n") + "\n");
  writeFileSync(join(out, "value-map.jsonl"), map.map((r) => JSON.stringify({ ...r, label: terms.get(r.term_id)!.name })).join("\n") + "\n");

  // ── coverage ──
  const mappedKey = new Set(map.map((r) => `${r.attr}|${r.organism}|${r.value_norm}`));
  const isMapped = (v: ValueRow) => mappedKey.has(`${v.attr}|${v.organism}|${v.value_norm}`) || mappedKey.has(`${v.attr}||${v.value_norm}`);
  const methodOf = new Map<string, string>();
  for (const r of map) methodOf.set(`${r.attr}|${r.organism}|${r.value_norm}`, r.method);
  const coverage: Record<string, { values: number; values_mapped: number; sample_rows: number; sample_rows_mapped: number; by_method: Record<string, number>; top_unmapped: [string, number][] }> = {};
  for (const v of values) {
    const c = (coverage[v.attr] ??= { values: 0, values_mapped: 0, sample_rows: 0, sample_rows_mapped: 0, by_method: {}, top_unmapped: [] });
    c.sample_rows += v.n;
    if (isMapped(v)) {
      c.sample_rows_mapped += v.n;
      const m = methodOf.get(`${v.attr}|${v.organism}|${v.value_norm}`) ?? methodOf.get(`${v.attr}||${v.value_norm}`)!;
      c.by_method[m] = (c.by_method[m] ?? 0) + v.n;
    }
  }
  const distinct = new Map<string, { attr: string; value_norm: string; value_raw: string | null; n: number; n_studies: number; mapped: boolean }>();
  for (const v of values) {
    const k = `${v.attr}|${v.value_norm}`;
    const d = distinct.get(k) ?? { attr: v.attr, value_norm: v.value_norm, value_raw: v.value_raw, n: 0, n_studies: 0, mapped: false };
    d.n += v.n;
    d.n_studies += v.n_studies;
    d.mapped ||= isMapped(v);
    distinct.set(k, d);
  }
  for (const d of distinct.values()) {
    const c = coverage[d.attr];
    c.values++;
    if (d.mapped) c.values_mapped++;
  }
  for (const [attr, c] of Object.entries(coverage)) {
    c.top_unmapped = [...distinct.values()].filter((d) => d.attr === attr && !d.mapped).sort((a, b) => b.n - a.n).slice(0, 25).map((d) => [d.value_norm, d.n]);
  }
  writeFileSync(join(out, "coverage.json"), JSON.stringify({ mapper_version: MAPPER_VERSION, release, slice_terms: sliceIds.length, closure_rows: closureRows.length, label_rows: labelRows.size, map_rows: map.length, model_kept: modelKept, model_rejected: modelRejected, coverage }, null, 2));

  // ── candidates for the model pass ──
  const cand: string[] = [];
  const tokenIndex = new Map<string, Map<string, Set<string>>>(); // attr -> token -> term ids
  const tokens = (s: string) => normLabel(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
  for (const [attr, spec] of Object.entries(SOURCE_ATTRS)) {
    if (attr === "age" || attr === "life_stage") continue;
    const ti = new Map<string, Set<string>>();
    for (const t of terms.values()) {
      if (t.obsolete || !spec.ontologies.includes(ontologyOf(t.id))) continue;
      for (const s of [t.name, ...t.synonyms.filter((x) => x.scope !== "BROAD").map((x) => x.text)]) for (const w of tokens(s)) {
        let set = ti.get(w);
        if (!set) ti.set(w, (set = new Set()));
        set.add(t.id);
      }
    }
    tokenIndex.set(attr, ti);
  }
  for (const d of distinct.values()) {
    if (d.mapped || !tokenIndex.has(d.attr)) continue;
    const ti = tokenIndex.get(d.attr)!;
    const ws = [...new Set(tokens(d.value_raw ? `${d.value_norm} ${d.value_raw}` : d.value_norm))];
    const score = new Map<string, number>();
    for (const w of ws) {
      const ids = ti.get(w);
      if (!ids || ids.size > 3000) continue;
      const idf = Math.log(1 + 20000 / ids.size);
      for (const id of ids) score.set(id, (score.get(id) ?? 0) + idf);
    }
    const top = [...score.entries()]
      .map(([id, s]) => [id, s / Math.sqrt(1 + tokens(terms.get(id)!.name).length)] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => ({ id, label: terms.get(id)!.name }));
    cand.push(JSON.stringify({ attr: d.attr, value_norm: d.value_norm, value_raw: d.value_raw, n_samples: d.n, n_studies: d.n_studies, candidates: top }));
  }
  writeFileSync(join(out, "candidates.jsonl"), cand.join("\n") + "\n");
  console.error(`map rows ${map.length}, slice ${sliceIds.length} terms, closure ${closureRows.length}, labels ${labelRows.size}, candidates ${cand.length}`);
}

const STOP = new Set(["of", "the", "and", "or", "in", "to", "cell", "cells", "tissue", "human", "mouse", "with", "from", "by", "on", "for", "type", "positive", "negative", "derived", "primary", "sample", "samples"]);

main();
