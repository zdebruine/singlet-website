// @vitest-environment node
/**
 * With the response diet on (MCP_DIET=1) the text of a list-shaped answer must still carry the answer: search results, per-sample QC, a
 * manifest, an assessment. These run the real tools (search_datasets with only the search backend replaced) and check the shortened text.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nlSearch = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/nl-search-core", async (orig) => ({ ...(await orig<object>()), nlSearch }));

import { onRequestPost } from "../../functions/mcp";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { resetStoreToolsGate } from "../../functions/_shared/store-gate";
import { onRequestPost as ingestPost } from "../../functions/api/ingest/store-study";
import { createTestD1 } from "./helpers/d1-sqlite";

const KEY = "sk_live_" + "a".repeat(32);
const TOKEN = "t";
const SAMPLE = JSON.parse(readFileSync("src/test/fixtures/store/sample/GSM1000001.manifest.json", "utf8"));
const hex = (c: string, n: number) => c.repeat(n);

const SCHEMA =
  ["010_accounts.sql", "012_ai_budget.sql", "032_v2_catalog.sql", "033_v2_sample_rev_key.sql", "036_store_rename.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n") +
  readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, "") +
  `
ALTER TABLE gse ADD COLUMN r2_bundle_n_gsms INTEGER;
ALTER TABLE gsm ADD COLUMN organism_primary TEXT;
ALTER TABLE gsm ADD COLUMN tissue_group TEXT;
ALTER TABLE gsm ADD COLUMN disease_group TEXT;
ALTER TABLE gsm ADD COLUMN assay_family TEXT;
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT, assay_families TEXT,
  tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER, n_cells INTEGER, year INTEGER, n_usable_samples INTEGER, n_lowqc_samples INTEGER,
  reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_cells INTEGER);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_files INTEGER, n_gsms_in_bundle INTEGER, manifest_n_gsms INTEGER, gsm_ids TEXT, manifest_created_at TEXT,
  audited_at TEXT, reference_build TEXT, singlet_version TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT, n_input_reads INTEGER, uniquely_mapped_pct REAL,
  n_cells_called INTEGER, median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL, intronic_fraction REAL, sequencing_saturation REAL,
  median_mito_fraction REAL, fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT, updated_at TEXT,
  matrix_bytes INTEGER, usable INTEGER, qc_tier INTEGER);
`;

async function setup(diet: boolean) {
  const db = createTestD1(SCHEMA);
  await db.exec(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).catch(async () => db.exec(`INSERT INTO users (id) VALUES ('u1')`));
  await db.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_aaaa', ?1)`).bind(await sha256Hex(KEY)).run();
  return { DB: db, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), MCP_RATE_PER_MIN: "1000", ...(diet ? { MCP_DIET: "1" } : {}) };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function call(env: Env, name: string, args: Record<string, unknown> = {}) {
  const request = new Request("https://singlet.bio/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await onRequestPost({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
  return ((await res.json()) as { result: { content: { text: string }[]; structuredContent: any; isError?: boolean } }).result;
}

beforeEach(() => {
  forgetKeyMemo();
  resetStoreToolsGate();
  nlSearch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

/** The text of an answer with the diet on, next to the same answer with it off. */
async function both(name: string, args: Record<string, unknown>, prep: (env: Env) => Promise<void> | void) {
  const off = await setup(false);
  const on = await setup(true);
  await prep(off);
  await prep(on);
  const full = await call(off, name, args);
  const slim = await call(on, name, args);
  expect(slim.isError, slim.content[0].text).toBeUndefined();
  expect(slim.structuredContent).toBeDefined();
  expect(full.content[0].text.length).toBeGreaterThan(0);
  return { full: full.content[0].text, slim: slim.content[0].text, structured: slim.structuredContent };
}

function seedStudies(env: Env, n: number, gsmPer = 1) {
  for (let i = 1; i <= n; i++) {
    const gse = `GSE${100 + i}`;
    env.DB.raw.prepare(`INSERT INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, r2_bundle_key, r2_bundle_bytes, last_updated) VALUES (?, ?, ?, ?, 1000, ?, ?, '2026-10-01T00:00:00Z')`).run(gse, `Study number ${i} of the atlas`, gsmPer, gsmPer, `data/${gse}/${gse}.singlet`, 1_000_000 * i);
    env.DB.raw.prepare(`INSERT INTO gse_meta (gse_id, has_bundle, organism_primary, tissue_groups, disease_groups, assay_families, n_cells, year, n_usable_samples) VALUES (?, 1, 'Homo sapiens', '["Blood"]', '["Healthy / control"]', '["10x 3"]', 1000, 2024, ?)`).run(gse, gsmPer);
    env.DB.raw.prepare(`INSERT INTO bundle_manifest (gse_id, bytes, n_gsms_in_bundle, reference_build) VALUES (?, ?, ?, 'GRCh38-2024-A')`).run(gse, 1_000_000 * i, gsmPer);
    for (let j = 0; j < gsmPer; j++) {
      const gsm = `GSM${i}${String(j).padStart(3, "0")}`;
      env.DB.raw.prepare(`INSERT INTO gsm (gsm_id, gse_id, organism_primary, tissue_group, disease_group, assay_family, status, n_cells) VALUES (?, ?, 'Homo sapiens', 'Blood', 'Healthy / control', '10x 3', 'DONE', 500)`).run(gsm, gse);
      env.DB.raw
        .prepare(
          `INSERT INTO sample_qc (gsm_id, gse_id, protocol, reference_build, n_input_reads, uniquely_mapped_pct, n_cells_called, median_umi, median_genes, mapping_rate, singlet_version, updated_at, usable, qc_tier)
           VALUES (?, ?, '10x 3 v3', 'GRCh38-2024-A', 30000000, 85.5, ?, 1800, 950, 0.9, '0.9.1', '2026-10-01T00:00:00Z', 1, 0)`
        )
        .run(gsm, gse, 400 + i * 10 + j);
    }
  }
}

describe("with the diet on, the text of a list-shaped answer still carries the answer", () => {
  it("search_datasets: every result's accession, title and reason are in the text", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      gse_id: `GSE${5000 + i}`, title: `Microglia in the aging mouse brain, dataset ${i}`, organism_label: "Mouse", organisms: ["Mus musculus"], tissue_groups: ["Brain"], disease_groups: ["Healthy / control"],
      assay_families: ["10x 3"], cell_types_raw: ["microglia", "astrocyte", "oligodendrocyte"], conditions_label: "age: 3 months; age: 24 months", bundle_n_samples: 8, n_done: 8, n_total: 8, n_cells: 45_000 + i,
      suspect_cells: false, year: 2023, has_bundle: true, bundle_bytes: 900_000_000, file_cells: 44_000, reference_build: "GRCm39-2024-A", usable_samples: 8, low_qc_samples: 0, reference_mismatch: false,
      match: "full", why: `matches organism Mus musculus, tissue Brain and cell type microglia (study ${i})`,
    }));
    nlSearch.mockResolvedValue({
      ok: true,
      body: { level: "gse", data: rows, total: 10, page: 1, limit: 10, applied: { organism: ["Mus musculus"], tissue_group: ["Brain"], disease_group: [], assay_family: [], cell_type: ["microglia"], min_cells: null, year_min: null, year_max: null, q: "" },
        dropped: [], note: null, quota_exceeded: false, groups: { full: 10, partial: 0 }, suggestions: [], interpreted: {}, totals: { studies: 10 }, why: {}, hard_applied: undefined, model: null },
    });
    const { full, slim, structured } = await both("search_datasets", { query: "microglia in the aging mouse brain", limit: 10 }, () => undefined);
    expect(structured.results).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(slim, `result ${i}`).toContain(`GSE${5000 + i}`);
      expect(slim).toContain(`Microglia in the aging mouse brain, dataset ${i}`);
      expect(slim).toContain(`study ${i})`); // the end of the reason
    }
    expect(slim).toContain("10 matching studies");
    expect(slim).toContain("Read as: ");
    // the shortened text is the full one with long lines clipped, never reordered or rewritten
    for (const line of slim.split("\n").filter((l) => l && !l.startsWith("("))) expect(full.startsWith(line.replace(/…$/, "").trimEnd()) || full.includes(line.replace(/…$/, "").trimEnd())).toBe(true);
  });

  it("get_sample_qc: the totals and a line for each sample", async () => {
    const { slim, structured } = await both("get_sample_qc", { gse_id: "GSE101" }, (env) => seedStudies(env, 1, 30));
    expect(structured.samples).toHaveLength(30);
    expect(slim).toMatch(/^GSE101 — per-sample QC for 30 samples/);
    expect(slim).toContain("Totals: ");
    expect(slim).toContain("cells called");
    for (let j = 0; j < 30; j++) expect(slim, `sample ${j}`).toContain(`GSM1${String(j).padStart(3, "0")}:`);
    expect(slim).toContain("uniquely mapped");
  });

  it("export_manifest: the headline, the table header and the first rows are in the text, with a count of the rest", async () => {
    const { full, slim, structured } = await both("export_manifest", { gse_ids: Array.from({ length: 150 }, (_, i) => `GSE${101 + i}`), format: "tsv" }, (env) => seedStudies(env, 150));
    expect(structured.count).toBe(150);
    expect(structured.manifest.split("\n").length).toBeGreaterThan(150); // the whole manifest is in the data
    expect(slim).toMatch(/^Manifest \(tsv\) — 150 studies of 150 matching/);
    expect(slim).toContain("gse_id\ttitle\torganism");
    expect(slim).toContain("GSE101\t");
    expect(slim).toContain("GSE102\t");
    expect(slim).toMatch(/… \d+ more lines\./);
    expect(slim.length).toBeLessThan(full.length / 2);
    expect(slim).toContain("store_rev"); // the header row is whole
    expect(slim.length).toBeLessThan(10_000);
  });

  it("export_manifest: a short manifest is left whole", async () => {
    const { full, slim } = await both("export_manifest", { gse_ids: ["GSE101", "GSE102", "GSE103"], format: "tsv" }, (env) => seedStudies(env, 3));
    expect(slim).toBe(full);
  });

  it("assess_study: the title, the file, the samples, the QC and the fit checks", async () => {
    const prep = async (env: Env) => {
      seedStudies(env, 1, 1);
      env.DB.raw.prepare(`UPDATE gse SET abstract = 'An abstract.' WHERE id = 'GSE101'`).run();
      const manifest = {
        format: "singlet-store", manifest_version: 1, gse: "GSE101", rev: hex("1", 16), created_at: "2026-10-23T08:00:00Z", reference_build: "GRCh38-2024-A",
        samples: [{ ...SAMPLE, gsm: "GSM1000", key: `store/s/GSM1000/${hex("a", 32)}.s1` }], legacy: { bytes: 5000 },
      };
      const request = new Request("https://singlet.bio/api/ingest/store-study", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: JSON.stringify({ manifest, migration: { status: "verified", verify_ok: true } }) });
      expect((await ingestPost({ request, env, params: {}, waitUntil: () => undefined } as never)).status).toBe(200);
    };
    const { slim, structured } = await both("assess_study", { gse_id: "GSE101", purpose: "RNA velocity in the aging brain" }, prep);
    expect(structured.fit.length).toBeGreaterThan(0);
    expect(slim).toContain("GSE101 — Study number 1 of the atlas");
    expect(slim).toMatch(/File: .* 1 samples/);
    expect(slim).toContain("Per sample:");
    expect(slim).toMatch(/Samples: 1 processed/);
    expect(slim).toMatch(/QC: .* cells called/);
    expect(slim).toContain('Fit for "RNA velocity in the aging brain":');
    expect(slim).toMatch(/spliced \/ unspliced layers/);
  });
});

describe("with the diet off (the default), nothing is shortened and verbose does nothing", () => {
  it("get_sample_qc and export_manifest keep their full text", async () => {
    const env = await setup(false);
    seedStudies(env, 40, 1);
    const qc = await call(env, "get_sample_qc", { gse_id: "GSE101" });
    expect(qc.content[0].text).not.toMatch(/Shortened/);
    const manifest = await call(env, "export_manifest", { gse_ids: Array.from({ length: 40 }, (_, i) => `GSE${101 + i}`), format: "tsv" });
    expect(manifest.content[0].text.split("\n").length).toBeGreaterThan(40);
    expect(manifest.content[0].text).not.toMatch(/Shortened/);
    const quiet = await call(env, "export_manifest", { gse_ids: ["GSE101"], format: "tsv", verbose: false });
    expect(quiet.content[0].text).toContain("GSE101\t");
  });
});
