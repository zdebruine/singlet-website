// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../scripts/hooks/d1-write-approval.mjs", import.meta.url));

function run(tool_name: string, tool_input: Record<string, unknown>) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8" });
  expect(r.status).toBe(0);
  return r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput as { permissionDecision: string; permissionDecisionReason: string }) : null;
}

describe("D1 write approval hook", () => {
  it("asks, with the cost, before an MCP D1 write", () => {
    const d = run("mcp__abc__d1_database_query", {
      sql: "INSERT INTO gsm (gsm_id, gse_id) VALUES ('GSM1','GSE1'),('GSM2','GSE1')",
    });
    expect(d?.permissionDecision).toBe("ask");
    expect(d?.permissionDecisionReason).toMatch(/WRITES TO PRODUCTION D1 AND COSTS MONEY/);
    expect(d?.permissionDecisionReason).toMatch(/60 D1 rows written/);
    expect(d?.permissionDecisionReason).toMatch(/\$1\.00 per million/);
  });

  it("lets SELECTs through without a prompt", () => {
    expect(run("mcp__abc__d1_database_query", { sql: "SELECT COUNT(*) FROM gsm" })).toBeNull();
  });

  it("always asks before a D1 database is created or deleted", () => {
    expect(run("mcp__abc__d1_database_delete", { database_id: "x" })?.permissionDecision).toBe("ask");
  });

  it.each([
    ["wrangler d1 execute singlet-catalog --remote --file=schema/040_fts_trigger_scope.sql", "wrangler d1 write"],
    ["curl -X POST -H 'X-Ingest-Token: t' https://singlet.bio/api/ingest/sample_attr -d @rows.json", "ingest endpoint"],
    ["python3 cf_publish_anvil_v2.py sync-catalog --all", "publisher"],
    ["sbatch reconcile_publish.sbatch", "publisher"],
  ])("asks before: %s", (command, what) => {
    const d = run("Bash", { command });
    expect(d?.permissionDecision).toBe("ask");
    expect(d?.permissionDecisionReason).toContain(what);
  });

  it("estimates a --file SQL write from the file", () => {
    const d = run("Bash", { command: "wrangler d1 execute singlet-catalog --remote --file=schema/040_fts_trigger_scope.sql" });
    expect(d?.permissionDecisionReason).toMatch(/Estimate: ~4\.0 D1 rows written|Estimate: ~\d/);
  });

  it.each([
    "wrangler d1 execute singlet-catalog --local --file=schema/001_init_local.sql",
    "wrangler d1 time-travel info singlet-catalog",
    "npm run d1:estimate -- --rows gsm=118000",
    "PUBLISH_DRY=1 python3 publish_study_v3.py --targets t.tsv GSE1",
    "grep -rn sync-catalog docs/",
    "git log --oneline -3",
    "ls scripts",
  ])("does not prompt for: %s", (command) => {
    expect(run("Bash", { command })).toBeNull();
  });

  it("never returns allow, and ignores tools it does not know", () => {
    expect(run("Read", { file_path: "x" })).toBeNull();
    expect(run("Edit", { file_path: "x" })).toBeNull();
  });
});
