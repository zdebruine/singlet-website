// @vitest-environment node
// The `modalities` argument of get_download_url, list_bundle_files, get_modalities, get_partial_download and slice_cells: the same
// names singlet.load(modalities=...) takes, answered with the byte ranges of only the members those modalities need.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "../../functions/mcp";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { clearPackIndexMemo } from "../../functions/_shared/mcp-s1";
import { parseLoadModalities, selectMembers } from "../../functions/_shared/s1-load-modalities";
import { resetS1ToolsGate } from "../../functions/_shared/s1-gate";
import { clearPackCache } from "../../functions/_shared/s1-packs";
import { configureS1 } from "../../functions/_shared/s1-urls";
import { onRequestPost as ingestPost } from "../../functions/api/ingest/s1-study";
import { createTestD1 } from "./helpers/d1-sqlite";
import { FakeHost } from "./helpers/zip";

const KEY = "sk_live_" + "b".repeat(32);
const TOKEN = "ingest-token";
const S2 = new Uint8Array(readFileSync("src/test/fixtures/s1/sample/GSM1000001.s1"));
const SAMPLE = JSON.parse(readFileSync("src/test/fixtures/s1/sample/GSM1000001.manifest.json", "utf8"));
const M = SAMPLE.members;
// The fixture object has exon and intron matrices. A junction matrix is listed over the intron matrix's bytes (a real pz2 member, so
// slice_cells can read it). mt_heteroplasmy (a stub recipe in the GSE145370 pilot) is a restricted member in Research Alpha: the v2
// ingest refuses it, so no sample object here has one.
const MEMBERS = {
  ...M,
  "sj_counts.1pz": { ...M["intron_counts.1pz"] },
};

const CATALOG = `
CREATE TABLE gse (id TEXT PRIMARY KEY, title TEXT, abstract TEXT, organism TEXT, n_gsm_total INTEGER, n_gsm_done INTEGER, n_gsm_failed INTEGER, n_cells INTEGER,
  pubmed_ids TEXT, r2_bundle_key TEXT, r2_bundle_bytes INTEGER, r2_bundle_n_gsms INTEGER, submitted_date TEXT, last_updated TEXT);
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, organism_primary TEXT, n_usable_samples INTEGER, reference_mismatch INTEGER,
  n_usable_cells INTEGER, n_lowqc_samples INTEGER, n_lowqc_cells INTEGER, year INTEGER);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_gsms_in_bundle INTEGER, gsm_ids TEXT, reference_build TEXT, singlet_version TEXT, manifest_created_at TEXT);
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, organism_primary TEXT, tissue_group TEXT, disease_group TEXT, assay_family TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT, n_input_reads INTEGER, uniquely_mapped_pct REAL,
  n_cells_called INTEGER, median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL, intronic_fraction REAL, sequencing_saturation REAL,
  median_mito_fraction REAL, fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT, updated_at TEXT,
  matrix_bytes INTEGER, usable INTEGER, qc_tier INTEGER);
`;
const SCHEMA = ["010_accounts.sql", "012_ai_budget.sql", "032_v2_catalog.sql", "033_v2_sample_rev_key.sql", "038_s1_catalog.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n") + CATALOG;
const hex = (c: string, n: number) => c.repeat(n);
const sampleKey = (gsm: string) => `s1/s/${gsm}/${hex("a", 32)}.s1`;
const url = (gsm: string) => `https://data.singlet.bio/${sampleKey(gsm)}`;
const range = (name: string) => `bytes=${M[name].off}-${M[name].off + M[name].len - 1}`;

async function seeded() {
  const db = createTestD1(SCHEMA);
  await db.exec(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).catch(async () => db.exec(`INSERT INTO users (id) VALUES ('u1')`));
  await db.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_bbbb', ?1)`).bind(await sha256Hex(KEY)).run();
  const env = { DB: db, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), MCP_RATE_PER_MIN: "1000" };
  const gse = "GSE1";
  const gsms = ["GSM1000001", "GSM1000002"];
  db.raw.prepare(`INSERT INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, r2_bundle_bytes, last_updated) VALUES (?, 'Study', 2, 2, 1000, 5000, '2026-10-01T00:00:00Z')`).run(gse);
  db.raw.prepare(`INSERT INTO gse_meta (gse_id, has_bundle) VALUES (?, 1)`).run(gse);
  // GSM1000002 is an older sample: no junction matrix
  const entry = (g: string) => ({ ...SAMPLE, gsm: g, key: sampleKey(g), members: g === "GSM1000001" ? MEMBERS : M });
  const manifest = { format: "singlet-s1", manifest_version: 1, gse, rev: hex("1", 16), created_at: "2026-10-23T08:00:00Z", reference_build: "GRCh38-2024-A", packs: { exon: hex("e", 32), intron: hex("f", 32) }, samples: gsms.map(entry), legacy: { key: `data/${gse}/${gse}.singlet`, etag: '"abc-3"', bytes: 5000 } };
  const request = new Request("https://singlet.bio/api/ingest/s1-study", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: JSON.stringify({ manifest, migration: { status: "verified", verify_ok: true } }) });
  const res = await ingestPost({ request, env, params: {}, waitUntil: () => undefined } as never);
  expect(res.status, await res.clone().text()).toBe(200);
  return env;
}
type Env = Awaited<ReturnType<typeof seeded>>;

async function rpc(env: Env | Record<string, unknown>, name: string, args: Record<string, unknown> = {}) {
  const request = new Request("https://singlet.bio/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const r = await onRequestPost({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
  return ((await r.json()) as { result: { content: { text: string }[]; structuredContent?: any; isError?: boolean } }).result;
}

let log: string[];
beforeEach(() => {
  forgetKeyMemo();
  configureS1(undefined);
  clearPackCache();
  clearPackIndexMemo();
  resetS1ToolsGate();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const host = new FakeHost();
  for (const g of ["GSM1000001", "GSM1000002"]) host.put(url(g), { bytes: S2, etag: '"s2"' });
  log = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    log.push(String(input instanceof Request ? input.url : input));
    return host.fetch(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const files = (sel: { files: { file?: string; name?: string }[] }) => sel.files.map((f) => f.file ?? f.name);

describe("the vocabulary", () => {
  it("normalises aliases, keeps vocabulary order, and names the vocabulary on a bad name", () => {
    expect(parseLoadModalities(undefined)).toBeNull();
    expect(parseLoadModalities(["sj", "Spliced", "junctions"])).toEqual({ names: ["spliced", "splice_junctions"] });
    expect(parseLoadModalities("splice_psi")).toEqual({ names: ["psi"] });
    expect(parseLoadModalities(["atac"])).toEqual({ error: expect.stringMatching(/Unknown modality 'atac'.*counts, spliced, unspliced/) });
    expect(parseLoadModalities([])).toEqual({ error: expect.stringMatching(/non-empty/) });
  });

  it("selects the cells table plus exactly the members each modality needs", () => {
    const pick = (m: string[]) => selectMembers(MEMBERS, m);
    expect(pick(["counts"]).files.map((f) => f.name)).toEqual(["cells", "exon_counts.1pz", "intron_counts.1pz"]);
    expect(pick(["spliced"]).files.map((f) => f.name)).toEqual(["cells", "exon_counts.1pz"]);
    expect(pick(["unspliced"]).files.map((f) => f.name)).toEqual(["cells", "intron_counts.1pz"]);
    expect(pick(["splice_junctions", "psi"]).files.map((f) => f.name)).toEqual(["cells", "sj_counts.1pz"]);
    expect(pick(["spliced"]).bytes).toBe(M.cells.len + M["exon_counts.1pz"].len);
    // a stub (nothing stored) is not a modality the sample has
    expect(pick(["mt", "spliced"])).toMatchObject({ missing: ["mt"] });
  });
});

describe("get_partial_download", () => {
  it("returns one range per selected member, never another member's", async () => {
    const env = await seeded();
    const sp = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["spliced"] })).structuredContent;
    expect(files(sp)).toEqual(["cells", "exon_counts.1pz"]);
    expect(sp.files.map((f: { range: string }) => f.range)).toEqual([range("cells"), range("exon_counts.1pz")]);
    expect(sp).toMatchObject({ bytes: M.cells.len + M["exon_counts.1pz"].len, object_bytes: SAMPLE.bytes, url: url("GSM1000001"), missing: [] });
    expect(sp.curl).toHaveLength(2);
    expect(sp.load.python).toBe('singlet.load("GSE1", samples=["GSM1000001"], modalities=["spliced"])');
    const sj = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["splice_junctions"] })).structuredContent;
    expect(files(sj)).toEqual(["cells", "sj_counts.1pz"]);
    const counts = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["counts"] })).structuredContent;
    expect(files(counts)).toEqual(["cells", "exon_counts.1pz", "intron_counts.1pz"]);
    expect(log).toHaveLength(0); // answered from D1
  });

  it("says what the sample has when it has none of them, and refuses file + modalities", async () => {
    const env = await seeded();
    const none = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000002", modalities: ["splice_junctions", "mt"] });
    expect(none.isError).toBe(true);
    expect(none.content[0].text).toMatch(/has none of splice_junctions, mt\. It has: counts, spliced, unspliced/);
    const some = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000002", modalities: ["spliced", "psi"] })).structuredContent;
    expect(some).toMatchObject({ missing: ["psi"] });
    const both = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz", modalities: ["spliced"] });
    expect(both.isError).toBe(true);
    const bad = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["atac"] });
    expect(bad.content[0].text).toMatch(/Unknown modality/);
    const neither = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001" });
    expect(neither.content[0].text).toMatch(/`file` is required/);
  });
});

describe("list_bundle_files, get_download_url, get_modalities", () => {
  it("list_bundle_files lists only the selected files, per sample and for a page of samples", async () => {
    const env = await seeded();
    const one = (await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["unspliced"] })).structuredContent;
    expect(files(one)).toEqual(["cells", "intron_counts.1pz"]);
    expect(one.selection.bytes).toBe(M.cells.len + M["intron_counts.1pz"].len);
    const page = (await rpc(env, "list_bundle_files", { gse_id: "GSE1", modalities: ["splice_junctions"] })).structuredContent;
    expect(page.samples.map((s: { gsm_id: string }) => s.gsm_id)).toEqual(["GSM1000001", "GSM1000002"]);
    expect(files(page.samples[0])).toEqual(["cells", "sj_counts.1pz"]);
    expect(page.samples[1]).toMatchObject({ missing: ["splice_junctions"] });
    expect(page.selected.bytes).toBe(2 * M.cells.len + M["intron_counts.1pz"].len);
  });

  it("get_download_url lists each sample object with only the selected ranges", async () => {
    const env = await seeded();
    const r = (await rpc(env, "get_download_url", { gse_id: "GSE1", modalities: ["spliced"] })).structuredContent;
    expect(r.samples).toHaveLength(2);
    for (const s of r.samples) expect(s.selection.files.map((f: { file: string }) => f.file)).toEqual(["cells", "exon_counts.1pz"]);
    expect(r.selected).toMatchObject({ modalities: ["spliced"], bytes: 2 * (M.cells.len + M["exon_counts.1pz"].len), object_bytes: 2 * SAMPLE.bytes, samples: 2 });
    expect(r.load.r).toBe('load("GSE1", modalities = c("spliced"))');
    const plain = (await rpc(env, "get_download_url", { gse_id: "GSE1" })).structuredContent;
    expect(plain.samples).toBeUndefined();
  });

  it("get_modalities tells which samples have them, the load call, and one sample's ranges", async () => {
    const env = await seeded();
    const r = (await rpc(env, "get_modalities", { gse_id: "GSE1", modalities: ["splice_junctions", "spliced"] })).structuredContent;
    expect(r.load_modalities.map((m: { name: string; n_samples: number }) => [m.name, m.n_samples])).toEqual([["spliced", 2], ["splice_junctions", 1]]);
    expect(r.load.python).toBe('singlet.load("GSE1", modalities=["spliced", "splice_junctions"])');
    expect(r.selection).toBeUndefined();
    const one = (await rpc(env, "get_modalities", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["psi"] })).structuredContent;
    expect(files(one.selection)).toEqual(["cells", "sj_counts.1pz"]);
    const all = (await rpc(env, "get_modalities", { gse_id: "GSE1" })).structuredContent;
    expect(all.load_modalities.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["counts", "spliced", "unspliced", "splice_junctions", "psi"]));
  });
});

describe("slice_cells", () => {
  it("plans only the matrices of the selected modalities", async () => {
    const env = await seeded();
    const r = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["spliced"], runs: [[70, 10]] })).structuredContent;
    expect(r.files.map((f: { file: string }) => f.file)).toEqual(["exon_counts.1pz"]);
    expect(r.requests).toBe(1);
    const sj = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", modalities: ["splice_junctions"], runs: [[70, 10]] })).structuredContent;
    expect(sj.files.map((f: { file: string }) => f.file)).toEqual(["sj_counts.1pz"]);
    expect(sj.modalities).toEqual(["splice_junctions"]);
    const mixed = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000002", modalities: ["counts", "psi"], runs: [[0, 4]] })).structuredContent;
    expect(mixed.files.map((f: { file: string }) => f.file)).toEqual(["exon_counts.1pz", "intron_counts.1pz"]);
    expect(mixed.skipped).toEqual([{ file: "psi", reason: "this sample does not have it" }]);
    const none = await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000002", modalities: ["mt"] });
    expect(none.isError).toBe(true);
    expect(none.content[0].text).toMatch(/has none of mt/);
  });
});

describe("tools/list", () => {
  it("advertises modalities on the five tools once a study is served from s1", async () => {
    const env = await seeded();
    const request = new Request("https://singlet.bio/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const res = await onRequestPost({ request, env, waitUntil: () => undefined, params: {} } as never);
    const tools = ((await res.json()) as { result: { tools: { name: string; inputSchema: { properties: Record<string, any>; required?: string[] } }[] } }).result.tools;
    for (const n of ["get_download_url", "list_bundle_files", "get_modalities", "get_partial_download", "slice_cells"]) {
      expect(tools.find((t) => t.name === n)!.inputSchema.properties.modalities?.type, n).toBe("array");
    }
    expect(tools.find((t) => t.name === "get_partial_download")!.inputSchema.required).toEqual(["gse_id", "gsm_id"]);
  });
});
