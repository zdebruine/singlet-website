// Runs a read-only SQL file against production D1 and writes the rows as JSON ([{results}], the shape
// build-index.ts reads). `wrangler d1 execute --file` does not return rows, so the statement goes through --command.
//
//   node scripts/search-index/d1-export.mjs scripts/search-index/export-samples.sql samples.json
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const [sqlFile, out] = process.argv.slice(2);
if (!sqlFile || !out) {
  console.error("usage: d1-export.mjs <file.sql> <out.json>");
  process.exit(2);
}
const sql = readFileSync(sqlFile, "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join(" ");
const wrangler = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const stdout = execFileSync(process.execPath, [wrangler, "d1", "execute", "singlet-catalog", "--remote", "--json", "--command", sql], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 1024,
});
const start = stdout.indexOf("[");
const parsed = JSON.parse(stdout.slice(start));
if (!parsed[0]?.results) throw new Error("D1 returned no rows array");
writeFileSync(out, JSON.stringify(parsed));
console.log(`${parsed[0].results.length} rows -> ${out}`);
