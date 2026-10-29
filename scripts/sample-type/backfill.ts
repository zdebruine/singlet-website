/**
 * Sample type and disease backfill (functions/_shared/sample-type.ts) over every served sample's stored GEO text. Writes files only;
 * nothing here touches D1. Zach reviews the CSV and applies the SQL.
 *
 * 1. Export (read-only; SV = the served-sample subquery of scripts/metadata-gaps/backfill.ts), each as
 *    `npx wrangler d1 execute singlet-catalog --remote --json --command "<sql>" > <in>/<name>.json`:
 *      samples  SELECT g.gsm_id, g.gse_id, g.organism_primary, g.source, g.characteristics FROM gsm g WHERE g.gsm_id IN ($SV)
 *      attrs    SELECT gsm_id, attr, value_raw, value_norm, ontology_id FROM sample_attr WHERE source='geo' AND gsm_id IN ($SV)
 *      props    SELECT gsm_id, gse_id, property, value, source, confidence, evidence, version FROM sample_property WHERE gsm_id IN ($SV)
 *      dterms   SELECT gsm_id, attr, term_id, source, confidence FROM sample_term WHERE attr IN ('disease','tissue','cell_type')
 *      ovm      SELECT attr, organism, value_norm, term_id, method, confidence FROM ontology_value_map WHERE attr IN ('disease','tissue','cell_type_sorted')
 *      oterms   SELECT term_id FROM ontology_term
 *      tmiss    SELECT DISTINCT t.term_id FROM sample_term t WHERE NOT EXISTS (SELECT 1 FROM ontology_term o WHERE o.term_id = t.term_id)
 * 2. python scripts/sample-type/cellosaurus_resolve.py <in>/samples.json scripts/sample-type/cellosaurus_resolved.json
 * 3. npx vite-node scripts/sample-type/backfill.ts -- --in <dir> --obo <dir with mondo.obo, uberon-basic.obo, hsapdv.obo, mmusdv.obo>
 *    [--out scripts/sample-type/out]
 *
 * Output: out/sample-type.sql (tissue_type, tumor_sample_type, sample_kind, cell_line; Cellosaurus terms), out/disease.sql (disease
 * attrs and terms, donor_status), out/ontology-terms.sql (labels and is_a closure for every term samples use that D1 lacks),
 * out/review.csv (one line per row proposed, with its evidence), out/summary.json. Every statement is idempotent. Each file ends by
 * bumping meta_cache.facts_epoch so cell search rebuilds its facts snapshot.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePairs } from "../../functions/_shared/attr-extract";
import {
  SAMPLE_TYPE_VERSION,
  classifySampleType,
  diseaseCandidate,
  DISEASE_ALIASES,
  type CellLineHit,
} from "../../functions/_shared/sample-type";
import { parseObo, type OboTerm } from "../metadata-gaps/onto/obo";
import { buildLabelIndex, matchValue } from "../metadata-gaps/onto/map-core";
import { normLabel } from "../metadata-gaps/onto/ontology";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const IN = arg("in"), OBO = arg("obo"), OUT = arg("out", "scripts/sample-type/out");
if (!IN || !OBO) throw new Error("--in <exports dir> and --obo <OBO dir> are required");

type Row = Record<string, any>;
const load = (name: string): Row[] => {
  const t = readFileSync(join(IN, `${name}.json`), "utf8");
  return JSON.parse(t.slice(t.indexOf("[")))[0].results;
};
const samples = load("samples");
const attrs = load("attrs");
const props = load("props");
const dterms = load("dterms");
const ovm = load("ovm");
const oterms = new Set(load("oterms").map((r) => String(r.term_id)));
const tmiss = load("tmiss").map((r) => String(r.term_id));

// ── ontologies ──────────────────────────────────────────────────────────────
const terms = new Map<string, OboTerm>();
for (const [f, p] of [["mondo.obo", "MONDO"], ["uberon-basic.obo", "UBERON"], ["hsapdv.obo", "HsapDv"], ["mmusdv.obo", "MmusDv"]] as const) {
  for (const [id, t] of parseObo(readFileSync(join(OBO, f), "utf8"), [p])) terms.set(id, t);
}
const mondoIndex = buildLabelIndex(terms, ["MONDO"]);
const release = (f: string) => /^data-version:\s*(\S+)/m.exec(readFileSync(join(OBO, f), "utf8").slice(0, 2000))?.[1] ?? null;
const RELEASE: Record<string, string | null> = { MONDO: release("mondo.obo"), UBERON: release("uberon-basic.obo"), HsapDv: release("hsapdv.obo"), MmusDv: release("mmusdv.obo") };

/** Alias label -> MONDO id, checked against the OBO file (unique label or exact synonym). */
const aliasId = new Map<string, string>();
const aliasBad: string[] = [];
for (const [abbr, label] of Object.entries(DISEASE_ALIASES)) {
  const m = matchValue("disease", label, { index: mondoIndex, aliases: [] });
  if (m && m.term_id.startsWith("MONDO:")) aliasId.set(abbr, m.term_id);
  else aliasBad.push(`${abbr} -> ${label}`);
}

const ovmDisease = new Map<string, string>();
for (const r of ovm) if (r.attr === "disease") ovmDisease.set(`${r.organism ?? ""}|${String(r.value_norm).toLowerCase()}`, String(r.term_id));

function diseaseTerm(text: string, organism: string): { id: string; how: string } | null {
  const t = text.toLowerCase();
  const a = aliasId.get(t);
  if (a) return { id: a, how: `alias "${t}" = ${DISEASE_ALIASES[t]}` };
  const o = ovmDisease.get(`${organism}|${t}`) ?? ovmDisease.get(`|${t}`);
  if (o) return { id: o, how: "ontology_value_map" };
  const m = matchValue("disease", text, { index: mondoIndex, aliases: [] });
  // A short abbreviation ("MM": myeloma, melanoma or Miyoshi myopathy) is only read through the curated DISEASE_ALIASES, never through
  // a MONDO synonym of the same letters.
  const bare = t.replace(/[^a-z0-9]/g, "");
  if (m?.method === "exact_synonym" && (bare.length <= 3 || (bare.length <= 5 && /\d/.test(bare)))) return null; // "MM", "CeD1": sample codes
  if (m && m.term_id.startsWith("MONDO:") && (m.method === "label" || m.method === "exact_synonym" || m.method === "id")) return { id: m.term_id, how: m.evidence };
  return null;
}

// ── cell lines ──────────────────────────────────────────────────────────────
type Candidate = { ac: string; id: string; category: string | null };
const resolved: Record<string, { via: string; name: string; candidates: Candidate[] } | null> = JSON.parse(
  readFileSync("scripts/sample-type/cellosaurus_resolved.json", "utf8")
);
/** Cellosaurus synonyms by accession, from the index of the dump (scripts/sample-type/cellosaurus_index.py). */
const synonymsOf = new Map<string, string[]>();
for (const list of Object.values(JSON.parse(readFileSync("scripts/sample-type/cello_index.json", "utf8")) as Record<string, { ac: string; synonyms?: string[] }[]>)) {
  for (const e of list) if (!synonymsOf.has(e.ac)) synonymsOf.set(e.ac, e.synonyms ?? []);
}
const STEM_CATEGORY = /stem cell/i;
/** One line for a value: the only candidate of the species, or the only stem-cell one when the record says stem cells. */
/** In a stem cell record, "H1" / "H7" / "H9" are the WiCell ES lines (other lines share those names: an H9 T-cell line, ES lines named H-1). */
const WICELL: Record<string, string> = { h1: "CVCL_9771", h7: "CVCL_9772", h9: "CVCL_9773" };
function pickLine(r: { name: string; candidates: Candidate[] } | null | undefined, stem: boolean): Candidate | null {
  if (!r) return null;
  if (r.candidates.length === 1) return r.candidates[0];
  if (stem) {
    const wi = WICELL[r.name.toLowerCase().replace(/[\s\-_.]/g, "")];
    const w = wi ? r.candidates.find((c) => c.ac === wi) : undefined;
    if (w) return w;
    const s = r.candidates.filter((c) => STEM_CATEGORY.test(c.category ?? ""));
    if (s.length === 1) return s[0];
  }
  return null; // a name several lines share ("H9": a T-cell line and the WA09 ES line) with nothing to tell them apart
}
const cellosaurusTerms = new Map<string, { name: string; synonyms: string[] }>();

// ── existing rows ───────────────────────────────────────────────────────────
const haveProp = new Set(props.map((r) => `${r.gsm_id}|${r.property}`));
const haveDisease = new Set(dterms.filter((r) => r.attr === "disease").map((r) => String(r.gsm_id)));
const haveAttr = new Set(attrs.map((r) => `${r.gsm_id}|${r.attr}|${String(r.value_norm)}`));

// ── run ─────────────────────────────────────────────────────────────────────
const q = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const typeSql: string[] = [];
const disSql: string[] = [];
const csv: string[][] = [["file", "change", "gsm_id", "gse_id", "organism", "field", "value", "term_id", "term_label", "confidence", "how", "evidence"]];
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
const newTerms = new Set<string>();
const unmappedDisease = new Map<string, number>();

for (const s of samples) {
  const gsm = String(s.gsm_id), gse = String(s.gse_id), org = String(s.organism_primary ?? "");
  const lookup = (raw: string, stem: boolean): CellLineHit | null => {
    const c = pickLine(resolved[`${raw.trim().toLowerCase()}|${org}`], stem);
    return c ? { ac: c.ac, name: c.id, category: c.category } : null;
  };
  const res = classifySampleType(s, lookup);
  for (const f of res.facts) {
    if (haveProp.has(`${gsm}|${f.property}`)) {
      bump(`skip_existing:${f.property}`);
      continue;
    }
    typeSql.push(
      `INSERT OR IGNORE INTO sample_property (gsm_id, gse_id, property, value, source, confidence, evidence, version) VALUES (${q(gsm)}, ${q(gse)}, ${q(f.property)}, ${q(f.value)}, 'geo', ${f.confidence}, ${q(f.evidence)}, ${q(SAMPLE_TYPE_VERSION)});`
    );
    csv.push(["sample-type", "add_property", gsm, gse, org, f.property, f.value, "", "", String(f.confidence), "rule", f.evidence]);
    bump(`${f.property}:${f.value}`);
  }
  for (const c of res.cellLines) {
    cellosaurusTerms.set(c.ac, { name: c.name, synonyms: synonymsOf.get(c.ac) ?? [] });
    if (!haveAttr.has(`${gsm}|cell_line|${c.name}`)) {
      typeSql.push(
        `INSERT OR IGNORE INTO sample_attr (gsm_id, gse_id, attr, value_raw, value_norm, ontology_id, unit, value_num, source, confidence, evidence, extractor_version) VALUES (${q(gsm)}, ${q(gse)}, 'cell_line', ${q(c.raw)}, ${q(c.name)}, ${q(c.ac)}, NULL, NULL, 'geo', 0.95, ${q(c.evidence)}, ${q(SAMPLE_TYPE_VERSION)});`
      );
    }
    typeSql.push(`INSERT OR IGNORE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr) VALUES (${q(gsm)}, ${q(gse)}, 'cell_line', ${q(c.ac)}, 'geo', 0.95, 'cell_line');`);
    csv.push(["sample-type", "add_term", gsm, gse, org, "cell_line", c.raw, c.ac, c.name, "0.95", `Cellosaurus ${c.category ?? ""}`, c.evidence]);
    bump("cell_line");
  }

  // disease: only samples with no disease term yet
  if (haveDisease.has(gsm)) continue;
  const cands = parsePairs(s.characteristics)
    .map((p) => ({ p, c: diseaseCandidate(p, org) }))
    .filter((x) => x.c);
  const healthy = cands.filter((x) => x.c!.kind === "healthy");
  const mapped = cands
    .filter((x) => x.c!.kind === "disease")
    .map((x) => ({ ...x, t: diseaseTerm(x.c!.text, org) }))
    .filter((x) => x.t);
  if (healthy.length && mapped.length) {
    bump("disease_conflict_skipped");
    continue;
  }
  const chosen = healthy.length
    ? [{ p: healthy[0].p, c: healthy[0].c!, t: { id: "PATO:0000461", how: "explicit healthy phrase" } }]
    : [...new Map(mapped.map((x) => [x.t!.id, { p: x.p, c: x.c!, t: x.t! }])).values()].slice(0, 3);
  if (!chosen.length) {
    if (cands.some((x) => x.c!.kind === "disease")) bump("disease_unmapped_value");
    for (const x of cands) if (x.c!.kind === "disease") {
      const k = `${x.p.key} = ${x.c!.text}`;
      unmappedDisease.set(k, (unmappedDisease.get(k) ?? 0) + 1);
    }
    continue;
  }
  for (const x of chosen) {
    const norm = x.t.id === "PATO:0000461" ? "healthy" : terms.get(x.t.id)?.name ?? x.c.text;
    if (!haveAttr.has(`${gsm}|disease|${norm}`)) {
      disSql.push(
        `INSERT OR IGNORE INTO sample_attr (gsm_id, gse_id, attr, value_raw, value_norm, ontology_id, unit, value_num, source, confidence, evidence, extractor_version) VALUES (${q(gsm)}, ${q(gse)}, 'disease', ${q(x.p.value)}, ${q(norm)}, ${q(x.t.id)}, NULL, NULL, 'geo', ${x.c.confidence}, ${q(x.p.evidence)}, ${q(SAMPLE_TYPE_VERSION)});`
      );
    }
    disSql.push(`INSERT OR IGNORE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr) VALUES (${q(gsm)}, ${q(gse)}, 'disease', ${q(x.t.id)}, 'geo', ${x.c.confidence}, 'disease');`);
    csv.push(["disease", "add_term", gsm, gse, org, "disease", x.p.value, x.t.id, terms.get(x.t.id)?.name ?? "normal", String(x.c.confidence), x.t.how, x.p.evidence]);
    if (x.t.id.startsWith("MONDO:") && !oterms.has(x.t.id)) newTerms.add(x.t.id);
    bump(x.t.id === "PATO:0000461" ? "disease:healthy" : "disease:mondo");
  }
  if (!haveProp.has(`${gsm}|donor_status`)) {
    const st = chosen[0].t.id === "PATO:0000461" ? "healthy" : "diseased";
    disSql.push(
      `INSERT OR IGNORE INTO sample_property (gsm_id, gse_id, property, value, source, confidence, evidence, version) VALUES (${q(gsm)}, ${q(gse)}, 'donor_status', ${q(st)}, 'geo', ${chosen[0].c.confidence}, ${q(chosen[0].p.evidence)}, ${q(SAMPLE_TYPE_VERSION)});`
    );
    csv.push(["disease", "add_property", gsm, gse, org, "donor_status", st, "", "", String(chosen[0].c.confidence), "from the disease term", chosen[0].p.evidence]);
    bump(`donor_status:${st}`);
  }
}

// ── ontology rows: Cellosaurus terms and every sample term D1 lacks ─────────
const ontoSql: string[] = [];
for (const [ac, t] of cellosaurusTerms) {
  ontoSql.push(`INSERT OR IGNORE INTO ontology_term (term_id, ontology, label, release, depth) VALUES (${q(ac)}, 'Cellosaurus', ${q(t.name)}, 'cellosaurus-api-2026-10-28', 0);`);
  ontoSql.push(`INSERT OR IGNORE INTO ontology_label (label_norm, term_id, ontology, kind) VALUES (${q(ac.toLowerCase())}, ${q(ac)}, 'Cellosaurus', 'id');`);
  ontoSql.push(`INSERT OR IGNORE INTO ontology_label (label_norm, term_id, ontology, kind) VALUES (${q(normLabel(t.name))}, ${q(ac)}, 'Cellosaurus', 'label');`);
  for (const syn of new Set(t.synonyms.map(normLabel))) {
    if (syn && syn !== normLabel(t.name)) ontoSql.push(`INSERT OR IGNORE INTO ontology_label (label_norm, term_id, ontology, kind) VALUES (${q(syn)}, ${q(ac)}, 'Cellosaurus', 'exact');`);
  }
}
for (const id of tmiss) newTerms.add(id);
const notInObo: string[] = [];
const closureOf = (id: string) => {
  const out = new Map<string, number>();
  let frontier = [id];
  for (let d = 1; frontier.length && d < 60; d++) {
    const next: string[] = [];
    for (const f of frontier) for (const p of [...(terms.get(f)?.isA ?? []), ...(terms.get(f)?.partOf ?? [])]) if (!out.has(p)) { out.set(p, d); next.push(p); }
    frontier = next;
  }
  return out;
};
for (const id of newTerms) {
  const t = terms.get(id);
  if (!t) { notInObo.push(id); continue; }
  const ont = id.slice(0, id.indexOf(":"));
  ontoSql.push(`INSERT OR IGNORE INTO ontology_term (term_id, ontology, label, release, depth) VALUES (${q(id)}, ${q(ont)}, ${q(t.name)}, ${q(RELEASE[ont])}, NULL);`);
  ontoSql.push(`INSERT OR IGNORE INTO ontology_label (label_norm, term_id, ontology, kind) VALUES (${q(normLabel(t.name))}, ${q(id)}, ${q(ont)}, 'label');`);
  for (const s of t.synonyms) if (s.scope === "EXACT") ontoSql.push(`INSERT OR IGNORE INTO ontology_label (label_norm, term_id, ontology, kind) VALUES (${q(normLabel(s.text))}, ${q(id)}, ${q(ont)}, 'exact');`);
  ontoSql.push(`INSERT OR IGNORE INTO ontology_closure (term_id, ancestor_id, distance) VALUES (${q(id)}, ${q(id)}, 0);`);
  for (const [a, d] of closureOf(id)) {
    ontoSql.push(`INSERT OR IGNORE INTO ontology_closure (term_id, ancestor_id, distance) VALUES (${q(id)}, ${q(a)}, ${d});`);
    // ancestors D1 lacks need a label too, or a filter on them cannot be named
    if (!oterms.has(a) && terms.get(a)) {
      oterms.add(a);
      const at = terms.get(a)!;
      const ao = a.slice(0, a.indexOf(":"));
      ontoSql.push(`INSERT OR IGNORE INTO ontology_term (term_id, ontology, label, release, depth) VALUES (${q(a)}, ${q(ao)}, ${q(at.name)}, ${q(RELEASE[ao])}, NULL);`);
      ontoSql.push(`INSERT OR IGNORE INTO ontology_label (label_norm, term_id, ontology, kind) VALUES (${q(normLabel(at.name))}, ${q(a)}, ${q(ao)}, 'label');`);
    }
  }
}

const EPOCH = `INSERT OR REPLACE INTO meta_cache (key, value, updated_at) VALUES ('facts_epoch', strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));`;
mkdirSync(OUT, { recursive: true });
const header = (what: string) => `-- ${what}\n-- Generated by scripts/sample-type/backfill.ts (${SAMPLE_TYPE_VERSION}). NOT APPLIED. Every statement is idempotent.\n`;
writeFileSync(join(OUT, "ontology-terms.sql"), header("Cellosaurus terms and labels/closure for sample terms D1 lacks (apply first)") + ontoSql.join("\n") + `\n${EPOCH}\n`);
writeFileSync(join(OUT, "sample-type.sql"), header("tissue_type, tumor_sample_type, sample_kind, cell_line from GEO fields") + typeSql.join("\n") + `\n${EPOCH}\n`);
writeFileSync(join(OUT, "disease.sql"), header("disease terms (MONDO / PATO:0000461) and donor_status from GEO fields") + disSql.join("\n") + `\n${EPOCH}\n`);
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(join(OUT, "review.csv"), csv.map((r) => r.map((x) => esc(String(x ?? ""))).join(",")).join("\n") + "\n");
const summary = {
  generated: new Date().toISOString(),
  version: SAMPLE_TYPE_VERSION,
  served_samples: samples.length,
  counts: Object.fromEntries(Object.entries(counts).sort()),
  statements: { "ontology-terms.sql": ontoSql.length, "sample-type.sql": typeSql.length, "disease.sql": disSql.length },
  cellosaurus_terms: cellosaurusTerms.size,
  new_ontology_terms: newTerms.size,
  terms_not_in_obo: notInObo,
  aliases_not_resolved: aliasBad,
  releases: RELEASE,
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
writeFileSync(join(OUT, "disease-unmapped.json"), JSON.stringify(Object.fromEntries([...unmappedDisease].sort((a, b) => b[1] - a[1])), null, 0));
console.log(JSON.stringify(summary, null, 1));
