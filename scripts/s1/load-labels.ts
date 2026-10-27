/**
 * Writes the .s1 label aggregates as SQL batch files for D1 (see ./labels-sql.ts). It never talks to D1 itself.
 *
 *   npm run s1:labels-sql -- --summary out/d1/sample_cell_summary.csv --directory out/cidx/s1/cidx/v/<version>.json --out /tmp/labels-sql
 *   for f in /tmp/labels-sql/*.sql; do npx wrangler d1 execute singlet-catalog --remote --file="$f" || break; done
 *
 * Schema 039 must be applied first. Stops (exit 1) when any input line is rejected.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLabelSqlFiles, parseSummaryCsv } from "./labels-sql";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
  return v;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const parsed = parseSummaryCsv(readFileSync(arg("summary"), "utf8"));
if (parsed.rejected.length) {
  console.error(`${parsed.rejected.length} input lines rejected:`);
  for (const r of parsed.rejected.slice(0, 50)) console.error(`  ${r}`);
  process.exit(1);
}
const dir = has("directory") ? JSON.parse(readFileSync(arg("directory"), "utf8")) : null;
const plan = buildLabelSqlFiles(parsed.rows, dir, { studiesPerFile: Number(arg("studies-per-file", "50")) });
const out = arg("out");
mkdirSync(out, { recursive: true });
for (const f of plan.files) writeFileSync(join(out, f.name), f.sql);
const db = arg("database", "singlet-catalog");
writeFileSync(join(out, "APPLY.txt"), plan.files.map((f) => `npx wrangler d1 execute ${db} --remote --file=${f.name}`).join("\n") + "\n");
console.log(
  `${plan.studies} studies, ${plan.samples} samples, ${plan.rows} summary rows (${parsed.skipped} feature rows skipped): ${plan.files.length} files, about ${plan.estWrites} D1 row writes. ${dir ? "" : "No --directory: label_term is not loaded, so cell types are not rolled up to their ancestors."}`
);
