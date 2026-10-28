#!/usr/bin/env node
// Estimate what a D1 write will cost BEFORE running it.
//
//   npm run d1:estimate -- path/to/file.sql           SQL file (a wrangler d1 execute --file, a campaign catalog file)
//   npm run d1:estimate -- --rows gsm=118000          N rows upserted into a table (repeat the flag for several tables)
//   npm run d1:estimate -- --rows gsm=118000 --passes 5   the same write repeated (a loop, a re-publish)
//   cat file.sql | npm run d1:estimate
//
// Prints estimated D1 rows written and the cost in dollars. D1 Workers Paid: first 50M rows a month included, $1.00 per
// million after. The figure is an estimate (functions/_shared/write-cost.ts); the dashboard and `meta.rows_written` are exact.
// Used by the Claude Code hook scripts/hooks/d1-write-approval.mjs, which shows this to the owner before any production write.
import { readFileSync } from "node:fs";
import { amplification, costOf, estimateRows, estimateSql, fmtRows, fmtUsd } from "../../functions/_shared/write-cost.ts";

const args = process.argv.slice(2);
let passes = 1;
const rows = [];
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--rows") {
    const [t, n] = String(args[++i] ?? "").split("=");
    rows.push([t, Number(n)]);
  } else if (args[i] === "--passes") passes = Math.max(1, Number(args[++i]) || 1);
  else files.push(args[i]);
}

let byTable = {};
let written = 0;
let guessed = false;
if (rows.length) {
  for (const [t, n] of rows) {
    const w = estimateRows(t, n);
    byTable[t] = (byTable[t] ?? 0) + w;
    written += w;
  }
} else {
  const text = files.length ? files.map((f) => readFileSync(f, "utf8")).join("\n;\n") : readFileSync(0, "utf8");
  const e = estimateSql(text);
  byTable = e.byTable;
  written = e.written;
  guessed = e.guessed;
}
written *= passes;
const c = costOf(written);
const lines = [
  `Estimated D1 rows written: ${fmtRows(written)}${passes > 1 ? ` (${passes} passes)` : ""}`,
  `Cost if the monthly 50M included rows are used up: ${fmtUsd(c.worstUsd)}   (free if it fits in what is left of them)`,
  ...Object.entries(byTable).map(([t, w]) => `  ${t}: ${fmtRows(w * passes)} rows  (x${amplification(t)} per row written: row + indexes + full-text index)`),
];
if (guessed) lines.push("Note: UPDATE / DELETE statements are counted as 1 row each; the real figure depends on how many rows they match.");
console.log(lines.join("\n"));
