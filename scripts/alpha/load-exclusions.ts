/**
 * Writes the Research Alpha exclusion lists as SQL batch files for D1 (see ./exclusion-sql.ts for what each file does).
 * It never talks to D1 itself: the files are applied with wrangler, in name order, by whoever runs the release.
 *
 * The data.singlet.bio guard's policy JSON is the authority (same lists, same version, so the catalog and the guard hide
 * the same things); the census TSVs give each sample's study and reasons:
 *
 *   npm run alpha:sql -- --policy workers/data-guard/policy/alpha-policy.json \
 *       --samples samples_excluded.tsv,samples_excluded_nonhuman_strand.tsv --out /tmp/alpha-sql
 *   for f in /tmp/alpha-sql/*.sql; do npx wrangler d1 execute singlet-catalog --remote --file="$f" || break; done
 *
 * Census-only form (no JSON): --samples samples_excluded.tsv --studies studies_action.tsv [--version alpha-…].
 * Schema 035 must be applied first. Stops (exit 1) when any input line is rejected.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSqlFiles, parseLists, parsePolicy } from "./exclusion-sql";

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

const samples = arg("samples").split(",").filter(Boolean).map((f) => readFileSync(f, "utf8"));
const lists = has("policy")
  ? parsePolicy(readFileSync(arg("policy"), "utf8"), samples)
  : { ...parseLists(samples[0] ?? "", readFileSync(arg("studies"), "utf8")), version: has("version") ? arg("version") : undefined, unresolved: [], ignored: 0 };
if (lists.rejected.length) {
  console.error(`${lists.rejected.length} input lines rejected:`);
  for (const r of lists.rejected.slice(0, 50)) console.error(`  ${r}`);
  process.exit(1);
}
const out = arg("out");
mkdirSync(out, { recursive: true });
const files = buildSqlFiles(lists, { policy: lists.version });
for (const f of files) writeFileSync(join(out, f.name), f.sql + "\n");
const studies = new Set(lists.exclusions.map((r) => r.gse));
console.log(
  `policy ${lists.version ?? "(default)"}: ${lists.exclusions.length + lists.unresolved.length} excluded samples ` +
    `(${lists.unresolved.length} placed from the catalog) in ${studies.size}+ studies, ${lists.withheld.length} withheld studies, ` +
    `${lists.ignored} TSV rows not in the policy ignored → ${files.length} files in ${out} (largest ${Math.max(...files.map((f) => f.sql.length))} bytes)`
);
