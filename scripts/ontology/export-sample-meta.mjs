// Export per-sample ontology terms and derived properties from production D1 (read-only) as the cell-index builder's
// --sample-meta input (singlet-bio scripts/v2_cidx_build.py; docs/CELL-ARCHITECTURE.md). One row per sample with any term
// or property; one term per attribute: the highest confidence, then the most specific (deepest) term.
//
//   node scripts/ontology/export-sample-meta.mjs > sample_meta.csv
//
// Columns: gsm, gse, organism, tissue, tissue_label, cell_type, cell_type_label, development_stage, development_stage_label,
// disease, disease_label, sex, ancestry, donor_status, perturbation, sample_kind. Empty = unknown.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const WRANGLER = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");

const ATTRS = ["tissue", "cell_type", "development_stage", "disease", "sex", "ancestry"];
const PROPS = ["donor_status", "perturbation", "sample_kind"];

function query(sql) {
  // wrangler's own entry point through node: no shell, so the SQL reaches it as one argument on every platform.
  const out = execFileSync(process.execPath, [WRANGLER, "d1", "execute", "singlet-catalog", "--remote", "--json", `--command=${sql.replace(/\s+/g, " ").trim()}`], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return JSON.parse(out)[0].results;
}

const pick = query(`
  SELECT gsm_id, gse_id, attr, term_id, label FROM (
    SELECT st.gsm_id, st.gse_id, st.attr, st.term_id, t.label,
           ROW_NUMBER() OVER (PARTITION BY st.gsm_id, st.attr ORDER BY st.confidence DESC, COALESCE(t.depth, 0) DESC, st.term_id) AS r
    FROM sample_term st JOIN ontology_term t ON t.term_id = st.term_id
  ) WHERE r = 1`);
const props = query(`SELECT gsm_id, gse_id, property, value FROM sample_property`);
const organisms = query(`SELECT gsm_id, organism_primary FROM gsm WHERE gsm_id IN (SELECT gsm_id FROM sample_term UNION SELECT gsm_id FROM sample_property)`);

const rows = new Map();
const row = (gsm, gse) => {
  let r = rows.get(gsm);
  if (!r) rows.set(gsm, (r = { gsm, gse }));
  return r;
};
for (const p of pick) {
  const r = row(p.gsm_id, p.gse_id);
  r[p.attr] = p.term_id;
  r[`${p.attr}_label`] = p.label;
}
for (const p of props) row(p.gsm_id, p.gse_id)[p.property] = p.value;
for (const o of organisms) if (rows.has(o.gsm_id)) rows.get(o.gsm_id).organism = o.organism_primary ?? "";

const cols = ["gsm", "gse", "organism", ...ATTRS.flatMap((a) => (a === "sex" || a === "ancestry" ? [a] : [a, `${a}_label`])), ...PROPS];
const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
process.stdout.write(cols.join(",") + "\n");
for (const r of [...rows.values()].sort((a, b) => a.gsm.localeCompare(b.gsm))) process.stdout.write(cols.map((c) => esc(r[c])).join(",") + "\n");
process.stderr.write(`${rows.size} samples\n`);
