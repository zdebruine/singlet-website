/**
 * Metadata-gap backfill: proposes the sample_attr / sample_term / gsm group / gse_meta rows that the catalog misses for served samples,
 * from the GEO text already stored in D1. Writes files only; nothing here touches D1. Zach reviews the CSV and applies the SQL.
 *
 * 1. Export (read-only, one line each, from ~/Projects/singlet-website; SV = the served-sample subquery):
 *      SV="SELECT ss.gsm_id FROM s1_sample ss JOIN s1_study s ON s.gse_id=ss.gse_id AND s.rev=ss.rev WHERE ss.gse_id NOT IN (SELECT gse_id FROM alpha_withheld)"
 *      samples  SELECT g.gsm_id, g.gse_id, g.organism_primary, g.title, g.source, g.characteristics, g.tissue_group, g.disease_group FROM gsm g WHERE g.gsm_id IN ($SV)
 *      attrs    SELECT gsm_id, attr, value_raw, value_norm, ontology_id, confidence, evidence, extractor_version FROM sample_attr WHERE source='geo' AND attr IN ('tissue','disease','age','life_stage','sample_type','disease_state') AND gsm_id IN ($SV)
 *      terms    SELECT gsm_id, gse_id, attr, term_id, source, confidence, from_attr FROM sample_term WHERE attr IN ('tissue','disease','development_stage') AND gsm_id IN ($SV)
 *      ovm      SELECT * FROM ontology_value_map
 *      vocab    SELECT field, priority, grp, match_type, pattern FROM vocab_rules ORDER BY field, priority, rowid
 *      labels   SELECT label_norm, term_id, ontology, kind FROM ontology_label WHERE ontology IN ('UBERON','MONDO','PATO','HsapDv','MmusDv')
 *    each as `npx wrangler d1 execute singlet-catalog --remote --json --command "<sql>" > <in>/<name>.json`.
 * 2. npx tsx scripts/metadata-gaps/backfill.ts --in <dir> [--out scripts/metadata-gaps/out]
 * 3. Review <out>/proposed-changes.csv, then apply <out>/backfill.sql (GEO sample fields) and, separately and only if wanted,
 *    <out>/backfill-title.sql (tissue read from the sample title alone, lower confidence).
 *
 * Rules: a row is proposed only when its evidence is a substring of the stored GEO text (evidenceHolds); a term only when the value is in
 * ontology_value_map for that attr (and organism, for stages) or is exactly a UBERON / MONDO label or exact synonym. Rows the fixed
 * extractor no longer produces (e.g. "region: R1" read as rhombomere 1) are deleted together with the sample_term rows built from them.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTRACTOR_VERSION, evidenceHolds, extractSampleAttrs, tissueInText, type AttrRow } from "../../functions/_shared/attr-extract";
import { toGroup, type VocabRule } from "../../functions/_shared/vocab";
import { sampleServedSql } from "../../functions/_shared/alpha";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const IN = arg("in", "");
const OUT = arg("out", "scripts/metadata-gaps/out");
if (!IN) throw new Error("--in <dir with the wrangler JSON exports> is required");

type Row = Record<string, any>;
const load = (name: string): Row[] => {
  const t = readFileSync(join(IN, `${name}.json`), "utf8");
  return JSON.parse(t.slice(t.indexOf("[")))[0].results;
};

const samples = load("samples");
const attrs = load("attrs");
const terms = load("terms");
const ovm = load("ovm");
const rules = load("vocab").map((r) => ({ ...r, priority: Number(r.priority), pattern: String(r.pattern).toLowerCase() })) as VocabRule[];
const labels = load("labels");

// ── lookups ────────────────────────────────────────────────────────────────
const TERM_ATTR: Record<string, "tissue" | "disease" | "development_stage"> = { tissue: "tissue", disease: "disease", age: "development_stage", life_stage: "development_stage" };
const ATTRS_TRACKED = new Set(["tissue", "disease", "disease_state", "age", "life_stage"]);
const ONTO_FOR: Record<string, string[]> = { tissue: ["UBERON"], disease: ["MONDO", "PATO"] };

const ovmBy = new Map<string, Row[]>();
for (const r of ovm) {
  const k = `${r.attr}|${r.organism ?? ""}|${String(r.value_norm).toLowerCase()}`;
  (ovmBy.get(k) ?? ovmBy.set(k, []).get(k)!).push(r);
}
const labelBy = new Map<string, Row[]>();
for (const r of labels) (labelBy.get(r.label_norm) ?? labelBy.set(r.label_norm, []).get(r.label_norm)!).push(r);
const normLabel = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[_\s]+/g, " ").trim();
const termLabel = new Map<string, string>();
for (const r of labels) if (r.kind === "label") termLabel.set(r.term_id, r.label_norm);

interface Mapped { term_id: string; method: string; source: string; confidence: number; evidence: string }
/** The terms a value maps to: the catalog's own value map first, then an exact UBERON / MONDO label or synonym (unambiguous only). */
function mapValue(attr: string, organism: string, value: string): Mapped[] {
  const v = value.toLowerCase();
  const hits = ovmBy.get(`${attr}|${organism}|${v}`) ?? ovmBy.get(`${attr}||${v}`);
  if (hits?.length) return hits.map((h) => ({ term_id: h.term_id, method: `value_map:${h.method}`, source: h.source, confidence: Number(h.confidence), evidence: h.evidence ?? "" }));
  const onto = ONTO_FOR[attr];
  if (!onto) return [];
  const cands = [...new Set((labelBy.get(normLabel(value)) ?? []).filter((l) => onto.includes(l.ontology)).map((l) => l.term_id))];
  if (cands.length !== 1) return [];
  const kind = (labelBy.get(normLabel(value)) ?? []).find((l) => l.term_id === cands[0])!.kind;
  return [{ term_id: cands[0], method: `label:${kind}`, source: "geo", confidence: kind === "label" ? 0.9 : 0.85, evidence: `${kind} "${normLabel(value)}"` }];
}

// ── current state ──────────────────────────────────────────────────────────
const attrBy = new Map<string, Row>(); // gsm|attr -> row
for (const a of attrs) attrBy.set(`${a.gsm_id}|${a.attr}`, a);
const termBy = new Map<string, Row[]>(); // gsm|attr -> rows
for (const t of terms) (termBy.get(`${t.gsm_id}|${t.attr}`) ?? termBy.set(`${t.gsm_id}|${t.attr}`, []).get(`${t.gsm_id}|${t.attr}`)!).push(t);

// ── proposals ──────────────────────────────────────────────────────────────
const q = (v: unknown) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const CSV_HEAD = ["change", "file", "gsm_id", "gse_id", "organism", "attr", "old_value", "new_value", "term_id", "term_label", "method", "confidence", "evidence"];
const csv: string[] = [CSV_HEAD.join(",")];
const sql = { geo: [] as string[], title: [] as string[] };
const touchedGse = { geo: new Set<string>(), title: new Set<string>() };
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
const TITLE_VERSION = "geo-title-2026-10-28";

function emitAttr(file: "geo" | "title", s: Row, r: AttrRow, old: Row | undefined) {
  if (old) sql[file].push(`DELETE FROM sample_attr WHERE gsm_id = ${q(s.gsm_id)} AND attr = ${q(r.attr)} AND source = 'geo';`);
  const mapped = TERM_ATTR[r.attr] ? mapValue(r.attr, s.organism_primary ?? "", r.value_norm) : [];
  const onto = mapped.length === 1 ? mapped[0].term_id : null;
  sql[file].push(
    `INSERT OR REPLACE INTO sample_attr (gsm_id, gse_id, attr, value_raw, value_norm, ontology_id, unit, value_num, source, confidence, evidence, extractor_version) VALUES (${[
      s.gsm_id, s.gse_id, r.attr, r.value_raw, r.value_norm, onto, r.unit, r.value_num, "geo", r.confidence, r.evidence, r.extractor_version,
    ].map(q).join(", ")});`
  );
  csv.push([old ? "replace_attr" : "add_attr", file, s.gsm_id, s.gse_id, s.organism_primary, r.attr, old?.value_norm, r.value_norm, onto, onto ? termLabel.get(onto) : "", "", r.confidence, r.evidence].map(csvCell).join(","));
  bump(`${file}:${old ? "replace" : "add"}_attr:${r.attr}`);
  const tAttr = TERM_ATTR[r.attr];
  if (!tAttr) return;
  // sample_term rows built from the old value go; the new value's terms come in (only where the sample has none for that attr from another field)
  if (old) sql[file].push(`DELETE FROM sample_term WHERE gsm_id = ${q(s.gsm_id)} AND attr = ${q(tAttr)} AND from_attr = ${q(r.attr)};`);
  const others = (termBy.get(`${s.gsm_id}|${tAttr}`) ?? []).filter((t) => t.from_attr !== r.attr);
  for (const m of mapped) {
    if (others.some((t) => t.term_id === m.term_id)) continue;
    const conf = Math.min(m.confidence, r.confidence);
    sql[file].push(
      `INSERT OR REPLACE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr) VALUES (${[s.gsm_id, s.gse_id, tAttr, m.term_id, m.source, conf, r.attr].map(q).join(", ")});`
    );
    csv.push(["add_term", file, s.gsm_id, s.gse_id, s.organism_primary, tAttr, "", r.value_norm, m.term_id, termLabel.get(m.term_id) ?? "", m.method, conf, `${r.evidence} -> ${m.evidence}`].map(csvCell).join(","));
    bump(`${file}:add_term:${tAttr}`);
  }
  if (!mapped.length) bump(`${file}:no_term:${r.attr}`);
}

function dropAttr(s: Row, old: Row) {
  sql.geo.push(`DELETE FROM sample_attr WHERE gsm_id = ${q(s.gsm_id)} AND attr = ${q(old.attr)} AND source = 'geo';`);
  const tAttr = TERM_ATTR[old.attr];
  if (tAttr) sql.geo.push(`DELETE FROM sample_term WHERE gsm_id = ${q(s.gsm_id)} AND attr = ${q(tAttr)} AND from_attr = ${q(old.attr)};`);
  const gone = tAttr ? (termBy.get(`${s.gsm_id}|${tAttr}`) ?? []).filter((t) => t.from_attr === old.attr) : [];
  csv.push(["drop_attr", "geo", s.gsm_id, s.gse_id, s.organism_primary, old.attr, old.value_norm, "", gone.map((t) => t.term_id).join("|"), gone.map((t) => termLabel.get(t.term_id) ?? "").join("|"), "extractor no longer reads this", "", old.evidence].map(csvCell).join(","));
  bump(`geo:drop_attr:${old.attr}`);
}

/**
 * gsm groups for a NULL column, from the tissue / disease value the sample will have after this backfill (the crank's own rules). Only a
 * named group is written; the fallback ("Other", "Other / unspecified") is left to the fixed crank, which sets it on its next pass.
 */
function emitGroups(file: "geo" | "title", s: Row, tissue: string | null, disease: string | null, skipTissue = false) {
  const sets: string[] = [];
  const set = (col: "tissue_group" | "disease_group", g: string | null, from: string | null) => {
    if (!g) return bump(`${file}:group_left_to_crank:${col}`);
    sets.push(`${col} = COALESCE(${col}, ${q(g)})`);
    csv.push(["set_group", file, s.gsm_id, s.gse_id, s.organism_primary, col, "", g, "", "", "vocab_rules", "", from ?? ""].map(csvCell).join(","));
    bump(`${file}:set_group:${col}`);
  };
  if (s.tissue_group == null && !skipTissue) set("tissue_group", toGroup(rules, "tissue", tissue), tissue);
  if (s.disease_group == null && file === "geo") set("disease_group", toGroup(rules, "disease", disease), disease);
  if (!sets.length) return;
  sql[file].push(`UPDATE gsm SET ${sets.join(", ")} WHERE gsm_id = ${q(s.gsm_id)};`);
  touchedGse[file].add(s.gse_id);
}

for (const s of samples) {
  bump("served_samples");
  const text = { title: s.title, source: s.source, characteristics: s.characteristics };
  const ex = extractSampleAttrs({ gsm_id: s.gsm_id, gse_id: s.gse_id, title: s.title, source: s.source, characteristics: s.characteristics, organism_primary: s.organism_primary });
  const fresh = new Map(ex.rows.filter((r) => ATTRS_TRACKED.has(r.attr) && evidenceHolds(r, text)).map((r) => [r.attr, r] as const));
  let tissue: string | null = attrBy.get(`${s.gsm_id}|tissue`)?.value_norm ?? null;
  let disease: string | null = attrBy.get(`${s.gsm_id}|disease`)?.value_norm ?? null;
  for (const attr of ATTRS_TRACKED) {
    const old = attrBy.get(`${s.gsm_id}|${attr}`);
    const r = fresh.get(attr);
    if (r && (!old || old.value_norm !== r.value_norm)) emitAttr("geo", s, r, old);
    // only rows the fixed rules reject outright are dropped; a row from an older or model pass with no fresh counterpart stays
    else if (!r && old && old.extractor_version === "geo-rules-2026-10-20" && attr === "tissue" && /^region:/i.test(String(old.evidence ?? "").trim())) dropAttr(s, old);
    if (attr === "tissue") tissue = r ? r.value_norm : old && !(old.extractor_version === "geo-rules-2026-10-20" && /^region:/i.test(String(old.evidence ?? "").trim())) ? old.value_norm : null;
    if (attr === "disease" && r) disease = r.value_norm;
  }
  // Title-only tissue: the sample has no tissue from its GEO fields (no characteristics or source stored), but its own title names one.
  const hasChars = !!(s.characteristics && String(s.characteristics).trim()) || !!(s.source && String(s.source).trim());
  if (!tissue && !hasChars && s.title) {
    const t = tissueInText(String(s.title));
    if (t) {
      const r: AttrRow = { gsm_id: s.gsm_id, gse_id: s.gse_id, attr: "tissue", value_raw: String(s.title), value_norm: t, value_num: null, unit: null, source: "geo", evidence: String(s.title), confidence: 0.6, extractor_version: TITLE_VERSION };
      emitAttr("title", s, r, undefined);
      emitGroups("title", s, t, null);
      // backfill.sql leaves this sample's tissue_group NULL so the optional title file can still set it (the crank sets "Other" otherwise)
      emitGroups("geo", s, null, disease, true);
      continue;
    }
  }
  emitGroups("geo", s, tissue, disease);
}

// ── study rollups (served samples only, the same SQL as metaRollupSql) ───
const served = sampleServedSql("gsm.gsm_id");
const rollup = (gses: Set<string>) => {
  const out: string[] = [];
  const ids = [...gses].sort();
  for (let i = 0; i < ids.length; i += 200) {
    const list = ids.slice(i, i + 200).map(q).join(", ");
    const arr = (col: string) =>
      `(SELECT json_group_array(v) FROM (SELECT DISTINCT ${col} AS v FROM gsm WHERE gse_id = gse_meta.gse_id AND ${col} IS NOT NULL AND ${col} != '' AND ${served} LIMIT 60))`;
    out.push(`UPDATE gse_meta SET tissue_groups = ${arr("tissue_group")}, disease_groups = ${arr("disease_group")} WHERE gse_id IN (${list});`);
  }
  return out;
};

const header = (what: string) => [
  `-- ${what}`,
  `-- Generated by scripts/metadata-gaps/backfill.ts (extractor ${EXTRACTOR_VERSION}) from read-only D1 exports of ${new Date().toISOString().slice(0, 10)}.`,
  "-- NOT APPLIED. Review proposed-changes.csv first. Apply with: npx wrangler d1 execute singlet-catalog --remote --file <this file>",
  "-- Every statement is idempotent (INSERT OR REPLACE / DELETE by key / COALESCE on NULL groups), so a rerun after a partial apply is safe.",
  "",
];
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "backfill.sql"), [...header("Sample facts from GEO sample fields (characteristics, source)"), ...sql.geo, "", "-- study rollups", ...rollup(touchedGse.geo), ""].join("\n"));
writeFileSync(
  join(OUT, "backfill-title.sql"),
  [...header("OPTIONAL, lower confidence (0.6): tissue named only in the sample title, for samples with no characteristics or source stored"), ...sql.title, "", "-- study rollups", ...rollup(touchedGse.title), ""].join("\n")
);
writeFileSync(join(OUT, "proposed-changes.csv"), csv.join("\n") + "\n");
const summary = { generated: new Date().toISOString(), extractor: EXTRACTOR_VERSION, counts: Object.fromEntries(Object.entries(counts).sort()), studies_rolled_up: { geo: touchedGse.geo.size, title: touchedGse.title.size } };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
