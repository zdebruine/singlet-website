#!/usr/bin/env node
// Claude Code PreToolUse hook: a write to production D1 always stops and asks the owner, with a cost estimate.
//
// Wired in .claude/settings.json for Bash, PowerShell and the Cloudflare D1 MCP tools. It reads the tool call as JSON on stdin and,
// when the call would write to production D1 (or run something that does), answers permissionDecision "ask": Claude shows the
// owner the reason below and waits for a yes or no. Reads (SELECT, wrangler d1 time-travel info, GETs) pass silently.
// "allow" is never returned, so a standing allow rule cannot be created by this hook; and a call the hook cannot classify is not blocked.
import { existsSync, readFileSync } from "node:fs";
import { costOf, estimateSql, fmtRows, fmtUsd } from "../../functions/_shared/write-cost.ts";

const WRITE_SQL = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA\s+\w+\s*=)\b/i;
// Commands that write production D1 directly or through a script that does.
const WRITE_CMD = [
  [/\bwrangler\b[^\n|;&]*\bd1\s+(execute|import|migrations\s+apply|time-travel\s+restore|delete|create)\b/i, "wrangler d1 write"],
  [/\bapi\.cloudflare\.com\/[^\s'"]*\/d1\/database\/[^\s'"]*\/(query|raw|import)\b/i, "Cloudflare D1 HTTP API"],
  [/\/api\/ingest\/(?!hpc)[^\s'"]*/i, "singlet.bio ingest endpoint"],
  [/\b(cf_publish_anvil\w*|publish_study_v3|publish_v3|reconcile_publish|controller_v3|v3_controller|esc_oom_v2|catalog-post|sync-catalog|upload-bundles)\b/i, "publisher / campaign that writes the catalog"],
  [/\bs1_campaign\.py\b[^\n]*\b(apply|catalog-post|retire)\b/i, "s1 campaign catalog write"],
  [/\bnpm\s+run\s+(alpha:sql|s1:labels-sql)\b[^\n]*\b(--apply|\|\s*wrangler)/i, "catalog loader piped to D1"],
];
const READ_ONLY_CMD = /(--local\b|\bd1\s+(list|info|time-travel\s+info)\b|d1:estimate|--dry-run|PUBLISH_DRY=1|--help\b)/i;

function allow() {
  process.exit(0);
}

function ask(what, detail, estimateText) {
  const reason = [
    `THIS WRITES TO PRODUCTION D1 AND COSTS MONEY (${what}).`,
    estimateText,
    "D1 bills $1.00 per million rows written beyond the 50M a month included. One unguarded loop cost $370 in a month (Oct 2026).",
    detail ? `Call: ${detail}` : "",
    "Approve only if you have seen the plan and this estimate. To decline, answer No and the agent must revise the plan.",
  ].filter(Boolean).join("\n");
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } })
  );
  process.exit(0);
}

function estimateFrom(sqlText) {
  try {
    const e = estimateSql(sqlText);
    if (!e.statements) return "";
    const c = costOf(e.written);
    const tables = Object.entries(e.byTable).map(([t, w]) => `${t} ${fmtRows(w)}`).join(", ");
    return `Estimate: ~${fmtRows(e.written)} D1 rows written (${tables}); up to ${fmtUsd(c.worstUsd)} if the month's free rows are used up.${e.guessed ? " UPDATE/DELETE counted as 1 row each." : ""}`;
  } catch {
    return "";
  }
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
let call;
try {
  call = JSON.parse(input);
} catch {
  allow();
}
const name = String(call.tool_name ?? "");
const ti = call.tool_input ?? {};

if (/^mcp__.*d1_database_(query|create|delete)$/.test(name) || /^mcp__.*d1_database_(create|delete)/.test(name)) {
  if (/_(create|delete)$/.test(name)) ask(`MCP ${name}`, JSON.stringify(ti).slice(0, 200), "Estimate: DDL / database-level change (a handful of rows, but irreversible for delete).");
  const sql = String(ti.sql ?? "");
  if (!WRITE_SQL.test(sql)) allow(); // SELECT only
  ask("MCP d1_database_query", sql.slice(0, 240).replace(/\s+/g, " "), estimateFrom(sql) || "Estimate unavailable: run `npm run d1:estimate` with the SQL.");
}

if (name === "Bash" || name === "PowerShell") {
  const cmd = String(ti.command ?? "");
  if (READ_ONLY_CMD.test(cmd)) allow();
  // Reading or searching a file that merely names a script is not a write.
  if (/^\s*(grep|rg|cat|head|tail|ls|git\s+(log|show|diff|status|grep)|Select-String|Get-Content|Get-ChildItem|echo)\b/i.test(cmd) && !/[|;&]\s*(bash|sh|node|python3?|curl|wrangler|npx)\b/i.test(cmd)) allow();
  const hit = WRITE_CMD.find(([re]) => re.test(cmd));
  if (!hit) allow();
  // A --file=x.sql argument can be read and estimated.
  let est = "";
  const f = /--file[= ]\s*["']?([^\s"']+\.sql)\b/i.exec(cmd);
  if (f && existsSync(f[1])) est = estimateFrom(readFileSync(f[1], "utf8"));
  ask(hit[1], cmd.replace(/\s+/g, " ").slice(0, 240), est || "Estimate unavailable for this command: ask the agent for `npm run d1:estimate` numbers (rows per table x passes) before approving.");
}
allow();
