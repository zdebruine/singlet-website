/**
 * Builds the bit index (layout: functions/_shared/bitindex.ts) from a D1 export.
 *
 *   wrangler d1 execute singlet-catalog --remote --json --file=scripts/search-index/export-samples.sql > samples.json
 *   node scripts/search-index/build-index.ts --samples samples.json [--facts facts.jsonl] --out dist/search-index
 *
 * Needs Node >= 22.18 (runs TypeScript directly). Writes `index.json` (dictionary) and `index.<version>.sbix`
 * into --out and prints the sizes. Upload both to the data bucket under search-index/v1/ (the binary first, then
 * index.json, so a reader never sees a dictionary whose binary is missing):
 *
 *   wrangler r2 object put singlet-data/search-index/v1/index.<version>.sbix --file=dist/search-index/index.<version>.sbix
 *   wrangler r2 object put singlet-data/search-index/v1/index.json --file=dist/search-index/index.json
 *
 * --samples  wrangler `--json` output ([{results: [...]}]), a JSON array, or JSON lines. One row per sample with
 *            gsm_id, gse_id, n_cells and one column per attribute in functions/_shared/cohort-schema.ts. A cell
 *            may hold several values separated by `|`. Empty and null mean unknown.
 * --facts    optional JSON lines of sample_attr rows ({gsm_id, attr, value_norm, source, confidence}) added on top
 *            (after schema/030_search_facts.sql is applied and filled). `model` rows land in the high or low band
 *            by confidence.
 * --out      output directory (default dist/search-index).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ATTRS } from "../../functions/_shared/cohort-schema.ts";
import { buildBitIndex, type FactValue, type SampleRow } from "../../functions/_shared/bitindex-build.ts";

function readRows(path: string): Record<string, unknown>[] {
  const text = readFileSync(path, "utf8").trim();
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    // wrangler: [{ results: [...], success, meta }]
    if (parsed.length && parsed[0] && Array.isArray(parsed[0].results)) return parsed.flatMap((p: { results: Record<string, unknown>[] }) => p.results);
    return parsed;
  }
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function rowsFromFlat(flat: Record<string, unknown>[]): Map<string, SampleRow> {
  const out = new Map<string, SampleRow>();
  for (const r of flat) {
    const gsm = String(r.gsm_id ?? "");
    const gse = String(r.gse_id ?? "");
    if (!gsm || !gse) continue;
    const facts: SampleRow["facts"] = {};
    for (const a of ATTRS) {
      const v = r[a.key];
      if (v == null || v === "") continue;
      facts[a.key] = a.kind === "cat" && typeof v === "string" && v.includes("|") ? v.split("|").filter(Boolean) : (v as FactValue);
    }
    out.set(gsm, { gsm, gse, cells: Number(r.n_cells) || 0, facts });
  }
  return out;
}

function main() {
  const { values } = parseArgs({ options: { samples: { type: "string" }, facts: { type: "string" }, out: { type: "string", default: "dist/search-index" } } });
  if (!values.samples) {
    console.error("usage: build-index.ts --samples <export.json> [--facts <sample_attr.jsonl>] [--out dir]");
    process.exit(2);
  }
  const rows = rowsFromFlat(readRows(values.samples));
  let extra = 0;
  if (values.facts) {
    const known = new Set(ATTRS.map((a) => a.key));
    for (const f of readRows(values.facts)) {
      const row = rows.get(String(f.gsm_id));
      const attr = String(f.attr);
      if (!row || !known.has(attr) || f.value_norm == null || f.value_norm === "") continue;
      const fact: FactValue = { v: f.value_norm as string | number, s: String(f.source ?? "geo"), c: f.confidence == null ? undefined : Number(f.confidence) };
      const cur = row.facts[attr];
      row.facts[attr] = cur == null ? [fact] : Array.isArray(cur) ? [...cur, fact] : [cur, fact];
      extra++;
    }
  }
  const t0 = performance.now();
  const { bin, dict } = buildBitIndex([...rows.values()], ATTRS);
  const dictText = JSON.stringify(dict);
  mkdirSync(values.out!, { recursive: true });
  writeFileSync(join(values.out!, dict.bin), bin);
  writeFileSync(join(values.out!, "index.json"), dictText);
  console.log(`samples ${dict.n_samples}, studies ${dict.n_studies}, extra facts ${extra}`);
  console.log(`binary ${bin.byteLength} bytes, dictionary ${dictText.length} bytes, built in ${Math.round(performance.now() - t0)} ms`);
  for (const a of dict.attrs) console.log(`  ${a.key.padEnd(18)} ${String(a.values.length).padStart(6)} values`);
  console.log(`version ${dict.index_version} -> ${join(values.out!, dict.bin)}`);
}

main();
