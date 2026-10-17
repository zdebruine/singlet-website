// Data audit: runs every check in checks.mjs (read-only SELECTs) against the production catalog and writes
// a ranked report. Usage:  node scripts/data-audit/audit.mjs [--db singlet-catalog] [--examples 8]
// Needs a wrangler login with D1 access. Output: scripts/data-audit/out/audit.json and audit.md (git-ignored).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CHECKS } from "./checks.mjs";
import { runStats } from "./stats.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const DB = arg("db", "singlet-catalog");
const N_EX = Number(arg("examples", 8));
const WRANGLER = path.join(root, "node_modules/wrangler/bin/wrangler.js");

const REACH = {
  usable: "COALESCE(q.usable, 0) = 1",
  downloadable: "m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0",
};

async function query(sql) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await run(process.execPath, [WRANGLER, "d1", "execute", DB, "--remote", "--json", "--command", sql], { cwd: root, maxBuffer: 1 << 28 });
      return JSON.parse(stdout.slice(stdout.indexOf("[")))[0].results;
    } catch (e) {
      const out = String(e.stdout || "");
      const msg = out.includes("[") ? (JSON.parse(out.slice(out.indexOf("[")))?.error?.notes?.[0]?.text ?? "") : String(e.message).slice(0, 200);
      if (attempt === 2 || /no such (column|table)|syntax error/i.test(msg)) throw new Error(msg || String(e.message).slice(0, 200));
    }
  }
}

async function runCheck(c) {
  const reach = c.reach ? REACH[c.reach] : null;
  const base = `FROM ${c.from} WHERE (${c.where})`;
  const out = { id: c.id, sev: c.sev, scope: c.scope, why: c.why, reach: c.reach ?? null };
  try {
    const counts = await query(`SELECT COUNT(*) AS n${reach ? `, SUM(CASE WHEN ${reach} THEN 1 ELSE 0 END) AS n_reach` : ""} ${base}`);
    out.n = Number(counts[0].n);
    out.n_reach = reach ? Number(counts[0].n_reach ?? 0) : null;
    let ranked = reach ? out.n_reach : out.n;
    if (c.scope === "column") ranked = Number((await query(`SELECT t.n AS n ${base}`))[0]?.n ?? ranked); // a dead column affects every row
    out.score = Number((c.sev * Math.log10(ranked + 1)).toFixed(2));
    if (out.n > 0) out.examples = await query(`SELECT ${c.cols} ${base}${reach ? ` ORDER BY CASE WHEN ${reach} THEN 0 ELSE 1 END` : ""} LIMIT ${N_EX}`);
    else out.examples = [];
  } catch (e) {
    out.error = String(e.message);
    out.score = 0;
  }
  return out;
}

const results = [];
let next = 0;
async function worker() {
  while (next < CHECKS.length) {
    const c = CHECKS[next++];
    const r = await runCheck(c);
    results.push(r);
    console.error(`${r.error ? "ERR " : "ok  "} ${c.id}${r.error ? ` - ${r.error}` : ` (${r.n}${r.n_reach != null ? `, ${r.n_reach} downloadable` : ""})`}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
for (const r of await runStats(query, N_EX)) { results.push(r); console.error(`ok   ${r.id} (${r.n})`); }

results.sort((a, b) => b.score - a.score || b.sev - a.sev);
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "audit.json"), JSON.stringify({ generated: new Date().toISOString(), db: DB, results }, null, 1));

const md = [`# Data audit (${DB}) ${new Date().toISOString().slice(0, 10)}`, "", "Ranked by severity x log10(hits). Severity 5 means the values cannot be true; hits \"in downloadable data\" count only samples or studies a visitor can download.", "",
  "| Rank | Check | Sev | Hits | In downloadable data | Score |", "|---|---|---|---|---|---|"];
results.forEach((r, i) => md.push(`| ${i + 1} | \`${r.id}\` | ${r.sev} | ${r.error ? "error" : r.n.toLocaleString()} | ${r.n_reach != null ? r.n_reach.toLocaleString() : "-"} | ${r.score} |`));
md.push("");
for (const r of results) {
  md.push(`## \`${r.id}\` (severity ${r.sev}, ${r.scope})`, "", r.why, "");
  if (r.error) { md.push(`Check failed: ${r.error}`, ""); continue; }
  md.push(`${r.n.toLocaleString()} hits${r.n_reach != null ? `, ${r.n_reach.toLocaleString()} in downloadable data` : ""}.`, "");
  if (r.examples.length) {
    const cols = Object.keys(r.examples[0]);
    md.push(`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`);
    for (const row of r.examples) md.push(`| ${cols.map((c) => String(row[c] ?? "").replace(/\|/g, "/").slice(0, 70)).join(" | ")} |`);
    md.push("");
  }
}
fs.writeFileSync(path.join(outDir, "audit.md"), md.join("\n"));
console.log(`wrote ${path.join(outDir, "audit.md")}`);
