// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { onRequestPost } from "../../functions/mcp";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { resetS1ToolsGate } from "../../functions/_shared/s1-gate";
import { resetDesignGate } from "../../functions/_shared/mcp-design";
import { createTestD1 } from "./helpers/d1-sqlite";

const KEY = "sk_live_" + "b".repeat(32);
const S1_TABLES = ["032_v2_catalog.sql", "033_v2_sample_rev_key.sql", "038_s1_catalog.sql", "030_search_facts.sql", "039_s1_labels.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join(";\n");
const BASE =
  ["010_accounts.sql", "011_product.sql", "012_ai_budget.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join(";\n") +
  readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, "") +
  `
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT, assay_families TEXT,
  tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER, n_cells INTEGER, year INTEGER, n_usable_samples INTEGER, n_lowqc_samples INTEGER,
  reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_cells INTEGER, updated_at TEXT);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_files INTEGER, n_gsms_in_bundle INTEGER, manifest_n_gsms INTEGER, gsm_ids TEXT, manifest_created_at TEXT,
  audited_at TEXT, reference_build TEXT, singlet_version TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT, n_input_reads INTEGER, uniquely_mapped_pct REAL,
  n_cells_called INTEGER, median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL, intronic_fraction REAL, sequencing_saturation REAL,
  median_mito_fraction REAL, fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT, updated_at TEXT,
  matrix_bytes INTEGER, usable INTEGER, qc_tier INTEGER);
CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT);
CREATE TABLE vocab_rules (field TEXT, priority INTEGER, grp TEXT, match_type TEXT, pattern TEXT);
CREATE TABLE bundle_index_failure (gse_id TEXT PRIMARY KEY, error TEXT, updated_at TEXT);
CREATE TABLE summaries_indexed (gse_id TEXT PRIMARY KEY, n_samples INTEGER, indexed_at TEXT);
ALTER TABLE gse ADD COLUMN r2_bundle_n_gsms INTEGER;
ALTER TABLE gsm ADD COLUMN organism_primary TEXT;
ALTER TABLE gsm ADD COLUMN tissue_group TEXT;
ALTER TABLE gsm ADD COLUMN disease_group TEXT;
ALTER TABLE gsm ADD COLUMN assay_family TEXT;
`;
const DESIGN = readFileSync("schema/042_design_catalog.sql", "utf8");

async function setup(withDesign = true) {
  const db = createTestD1(S1_TABLES + BASE + (withDesign ? DESIGN : ""));
  await db.exec(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).catch(async () => db.exec(`INSERT INTO users (id) VALUES ('u1')`));
  await db.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_bbbb', ?1)`).bind(await sha256Hex(KEY)).run();
  return { DB: db, MCP_RATE_PER_MIN: "1000" };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function call(env: Env, method: string, params: unknown = {}) {
  const request = new Request("https://singlet.bio/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const res = await onRequestPost({ request, env, waitUntil: () => undefined, params: {} } as never);
  return ((await res.json()) as { result: any }).result;
}
const tool = (env: Env, name: string, args: Record<string, unknown> = {}) => call(env, "tools/call", { name, arguments: args });

function seedStudy(env: Env, id: string, tier: string, opts: { grade?: string; test?: string; tissue?: string } = {}) {
  const r = env.DB.raw;
  r.prepare(`INSERT INTO design_study(gse_id,tier,design_class,summary,prompt_version,model,n_units,n_contrasts,paper_used,rev) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, tier, "case_control", `${id} case control`, "0.2-x", "haiku", 2, 1, 0, "r1");
  r.prepare(`INSERT INTO design_factor(gse_id,factor_id,name,type,unit,source,confidence) VALUES (?,?,?,?,?,?,?)`).run(id, "F1", "disease", "disease", "donor", "characteristics:disease", "high");
  r.prepare(`INSERT INTO design_level(gse_id,factor_id,level_id,label,standard,role,ontology_ids) VALUES (?,?,?,?,?,?,?)`).run(id, "F1", "F1.a", "healthy", "healthy", "reference", "PATO:0000461");
  r.prepare(`INSERT INTO design_level(gse_id,factor_id,level_id,label,standard,role,ontology_ids) VALUES (?,?,?,?,?,?,?)`).run(id, "F1", "F1.b", opts.test ?? "COVID", opts.test ?? "COVID-19", "test", "MONDO:0100096");
  for (const [u, l] of [["GSM1", "F1.a"], ["GSM2", "F1.b"]]) {
    r.prepare(`INSERT INTO design_unit(gse_id,unit_id,gsm_id,donor,status) VALUES (?,?,?,?,?)`).run(id, u, u, `D${u}`, "scheduled");
    r.prepare(`INSERT INTO design_unit_level(gse_id,unit_id,factor_id,level_id,pooled) VALUES (?,?,?,?,0)`).run(id, u, "F1", l);
  }
  r.prepare(`INSERT INTO design_contrast(gse_id,contrast_id,factor_id,factor_type,test,reference,symmetric,kind,grade,status,replication_unit,n_test,n_reference,pairing,confounds) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`).run(id, `${id}.c1`, "F1", "disease", opts.test ?? "COVID-19", "healthy", "author_stated", opts.grade ?? "B", "candidate", "donor", 2, 2, "unpaired", "batch");
  r.prepare(`INSERT INTO design_contrast_attr(gse_id,contrast_id,attribute,relation,value,aligned) VALUES (?,?,?,?,?,0)`).run(id, `${id}.c1`, "tissue", "shared", opts.tissue ?? "blood");
  r.prepare(`INSERT INTO design_contrast_attr(gse_id,contrast_id,attribute,relation,value,aligned) VALUES (?,?,?,?,?,1)`).run(id, `${id}.c1`, "sex", "differs", JSON.stringify([["F"], ["M"]]));
  r.prepare(`INSERT INTO sample_status(sample_id,gse_id,status) VALUES (?,?,?)`).run(id === "GSE1" ? "GSM1" : "GSM19", id, "held");
  r.prepare(`INSERT INTO sample_status(sample_id,gse_id,status,object_url) VALUES (?,?,?,?)`).run(id === "GSE1" ? "GSM2" : "GSM29", id, "counts_available", "https://beta-data.singlet.bio/s1/s/GSM2/abc.s1");
}

beforeEach(() => {
  forgetKeyMemo();
  resetS1ToolsGate();
  resetDesignGate();
});

describe("design catalog MCP tools", () => {
  it("are advertised only once the design tables hold a study", async () => {
    const env = await setup();
    expect(((await call(env, "tools/list")).tools as { name: string }[]).map((t) => t.name)).not.toContain("get_design");
    seedStudy(env, "GSE1", "candidate");
    resetDesignGate();
    const names = ((await call(env, "tools/list")).tools as { name: string }[]).map((t) => t.name);
    for (const n of ["get_design", "find_contrasts", "get_contrast", "get_sample_status"]) expect(names).toContain(n);
  });

  it("get_design returns the design with tier, caveat and prompt version", async () => {
    const env = await setup();
    seedStudy(env, "GSE1", "candidate");
    const r = await tool(env, "get_design", { study: "gse1" });
    const s = r.structuredContent;
    expect(s).toMatchObject({ study: "GSE1", tier: "candidate", prompt_version: "0.2-x", design_class: "case_control" });
    expect(s.caveat).toMatch(/model-curated and unverified/);
    expect(s.factors[0].levels.map((l: any) => l.level_id)).toEqual(["F1.a", "F1.b"]);
    expect(s.factors[0].levels[1].ontology_ids).toEqual(["MONDO:0100096"]);
    expect(s.units).toHaveLength(2);
    expect(s.contrasts[0].id).toBe("GSE1:GSE1.c1");
    expect(s.status_counts).toEqual({ held: 1, counts_available: 1 });
    expect((await tool(env, "get_design", { study: "GSE9" })).isError).toBe(true);
    expect((await tool(env, "get_design", { study: "nope" })).isError).toBe(true);
  });

  it("find_contrasts defaults to confirmed only and says nothing is confirmed", async () => {
    const env = await setup();
    seedStudy(env, "GSE1", "candidate");
    const r = await tool(env, "find_contrasts", {});
    expect(r.structuredContent.n).toBe(0);
    expect(r.content[0].text).toMatch(/No design is confirmed yet/);
    const all = await tool(env, "find_contrasts", { include_candidate: true });
    expect(all.structuredContent).toMatchObject({ n: 1, tiers_returned: ["candidate"], prompt_versions: ["0.2-x"] });
    expect(all.structuredContent.caveat).toMatch(/unverified/);
    expect(all.structuredContent.contrasts[0]).toMatchObject({ id: "GSE1:GSE1.c1", grade: "B", tier: "candidate", confounds: ["batch"] });
  });

  it("find_contrasts filters by type, term, ontology id, tissue, grade and status; confirmed designs show by default", async () => {
    const env = await setup();
    seedStudy(env, "GSE1", "candidate", { grade: "C" });
    seedStudy(env, "GSE2", "confirmed", { grade: "A", test: "influenza", tissue: "lung" });
    const f = async (a: Record<string, unknown>) => ((await tool(env, "find_contrasts", { include_candidate: true, ...a })).structuredContent.contrasts as { study: string }[]).map((c) => c.study).sort();
    expect(await f({})).toEqual(["GSE1", "GSE2"]);
    expect(await f({ factor_type: "Disease" })).toEqual(["GSE1", "GSE2"]);
    expect(await f({ factor_type: "treatment" })).toEqual([]);
    expect(await f({ term: "covid" })).toEqual(["GSE1"]);
    expect(await f({ term: "influenza" })).toEqual(["GSE2"]);
    expect(await f({ term: "MONDO:0100096" })).toEqual(["GSE1", "GSE2"]);
    expect(await f({ tissue: "lung" })).toEqual(["GSE2"]);
    expect(await f({ min_grade: "B" })).toEqual(["GSE2"]);
    expect(await f({ status: "nothing" })).toEqual([]);
    const def = await tool(env, "find_contrasts", {});
    expect(def.structuredContent.contrasts.map((c: any) => c.study)).toEqual(["GSE2"]);
    expect((await tool(env, "find_contrasts", { min_grade: "Z" })).isError).toBe(true);
  });

  it("get_contrast returns arms, shared and differing attributes and the units on each arm", async () => {
    const env = await setup();
    seedStudy(env, "GSE1", "candidate");
    const r = (await tool(env, "get_contrast", { id: "GSE1:GSE1.c1" })).structuredContent;
    expect(r).toMatchObject({ tier: "candidate", prompt_version: "0.2-x", grade: "B", test: "COVID-19", reference: "healthy", shared: { tissue: "blood" } });
    expect(r.differs[0]).toMatchObject({ attribute: "sex", test_values: ["F"], reference_values: ["M"], aligned_with_arms: true });
    expect(r.test_units.map((u: any) => u.unit_id)).toEqual(["GSM2"]);
    expect(r.reference_units.map((u: any) => u.unit_id)).toEqual(["GSM1"]);
    expect((await tool(env, "get_contrast", { id: "GSE1:missing" })).isError).toBe(true);
    expect((await tool(env, "get_contrast", { id: "bad" })).isError).toBe(true);
  });

  it("get_sample_status answers by study and by sample", async () => {
    const env = await setup();
    seedStudy(env, "GSE1", "candidate");
    const st = (await tool(env, "get_sample_status", { study: "GSE1" })).structuredContent;
    expect(st).toMatchObject({ tier: "candidate", prompt_version: "0.2-x", n_samples: 2, status_counts: { held: 1, counts_available: 1 } });
    expect(st.samples).toHaveLength(2);
    const one = (await tool(env, "get_sample_status", { sample: "gsm2" })).structuredContent;
    expect(one).toMatchObject({ status: "counts_available", object_url: "https://beta-data.singlet.bio/s1/s/GSM2/abc.s1", tier: "candidate" });
    expect((await tool(env, "get_sample_status", {})).isError).toBe(true);
    expect((await tool(env, "get_sample_status", { sample: "GSM404" })).isError).toBe(true);
  });

  it("answers plainly when the tables are absent, and get_study is unchanged", async () => {
    const env = await setup(false);
    for (const [n, a] of [["get_design", { study: "GSE1" }], ["find_contrasts", {}], ["get_contrast", { id: "GSE1:x" }], ["get_sample_status", { study: "GSE1" }]] as const) {
      const r = await tool(env, n, a as Record<string, unknown>);
      expect(r.isError, n).toBe(true);
    }
    env.DB.raw.prepare(`INSERT INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, last_updated) VALUES ('GSE1', 'Study', 1, 1, 100, '2026-10-01T00:00:00Z')`).run();
    env.DB.raw.prepare(`INSERT INTO gse_meta (gse_id, has_bundle) VALUES ('GSE1', 1)`).run();
    const s = await tool(env, "get_study", { gse_id: "GSE1" });
    expect(s.isError, s.content[0].text).toBeFalsy();
    expect(s.structuredContent.design).toBeUndefined();
    expect(s.structuredContent.status_counts).toBeUndefined();
  });

  it("get_study gains the design summary and status counts when the tables exist", async () => {
    const env = await setup();
    seedStudy(env, "GSE1", "candidate");
    env.DB.raw.prepare(`INSERT INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, last_updated) VALUES ('GSE1', 'Study', 2, 2, 100, '2026-10-01T00:00:00Z')`).run();
    env.DB.raw.prepare(`INSERT INTO gse_meta (gse_id, has_bundle) VALUES ('GSE1', 1)`).run();
    const s = await tool(env, "get_study", { gse_id: "GSE1" });
    expect(s.structuredContent.design).toMatchObject({ tier: "candidate", prompt_version: "0.2-x", n_factors: 1, n_contrasts: 1 });
    expect(s.structuredContent.design.caveat).toMatch(/unverified/);
    expect(s.structuredContent.status_counts).toEqual({ held: 1, counts_available: 1 });
    expect(s.content[0].text).toMatch(/Design \(candidate/);
  });
});
