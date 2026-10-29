// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "../../functions/mcp";
import { diet, SUMMARY_MAX_LINES, summarize } from "../../functions/_shared/mcp-core";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { clearPackIndexMemo, findCells } from "../../functions/_shared/mcp-s1";
import { resetS1ToolsGate } from "../../functions/_shared/s1-gate";
import { clearPackCache } from "../../functions/_shared/s1-packs";
import { configureS1 } from "../../functions/_shared/s1-urls";
import { onRequestPost as ingestPost } from "../../functions/api/ingest/s1-study";
import { createTestD1 } from "./helpers/d1-sqlite";
import { FakeHost, buildZip } from "./helpers/zip";

const KEY = "sk_live_" + "a".repeat(32);
const TOKEN = "ingest-token";
const S2 = new Uint8Array(readFileSync("src/test/fixtures/s1/sample/GSM1000001.s1"));
const SAMPLE = JSON.parse(readFileSync("src/test/fixtures/s1/sample/GSM1000001.manifest.json", "utf8"));
const EXPECTED = JSON.parse(readFileSync("src/test/fixtures/s1/sample/GSM1000001.expected.json", "utf8"));
const PACKS_DIR = "src/test/fixtures/s1/packs";
const PACK_INDEX = JSON.parse(readFileSync(`${PACKS_DIR}/index.json`, "utf8"));
const PACK_EXPECTED = JSON.parse(readFileSync(`${PACKS_DIR}/expected.json`, "utf8"));

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
const SCHEMA = ["010_accounts.sql", "012_ai_budget.sql", "032_v2_catalog.sql", "033_v2_sample_rev_key.sql", "038_s1_catalog.sql", "030_search_facts.sql", "039_s1_labels.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n") + CATALOG;

async function setup() {
  const db = createTestD1(SCHEMA);
  await db.exec(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).catch(async () => db.exec(`INSERT INTO users (id) VALUES ('u1')`));
  await db.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_aaaa', ?1)`).bind(await sha256Hex(KEY)).run();
  return { DB: db, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), MCP_RATE_PER_MIN: "1000" };
}
type Env = Awaited<ReturnType<typeof setup>>;

const hex = (c: string, n: number) => c.repeat(n);
const sampleKey = (gsm: string, c = "a") => `s1/s/${gsm}/${hex(c, 32)}.s1`;
const sampleEntry = (gsm: string, over: Record<string, unknown> = {}) => ({ ...SAMPLE, gsm, key: sampleKey(gsm), ...over });

async function ingest(env: Env, gse: string, gsms: string[], over: Record<string, unknown> = {}, migration: Record<string, unknown> | null = { status: "verified", verify_ok: true }, entry: (g: string) => unknown = (g) => sampleEntry(g)) {
  const manifest = { format: "singlet-s1", manifest_version: 1, gse, rev: hex("1", 16), created_at: "2026-10-23T08:00:00Z", reference_build: "GRCh38-2024-A", packs: { exon: hex("e", 32), intron: hex("f", 32) }, samples: gsms.map(entry), legacy: { key: `data/${gse}/${gse}.singlet`, etag: '"abc-3"', bytes: 5000 }, ...over };
  const request = new Request("https://singlet.bio/api/ingest/s1-study", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: JSON.stringify({ manifest, ...(migration ? { migration } : {}) }) });
  const res = await ingestPost({ request, env, params: {}, waitUntil: () => undefined } as never);
  expect(res.status, await res.clone().text()).toBe(200);
}

function seedCatalog(env: Env, gse: string, gsms: string[], opts: { organism?: string; hasBundle?: number } = {}) {
  env.DB.raw.prepare(`INSERT OR REPLACE INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, r2_bundle_bytes, last_updated) VALUES (?, ?, ?, ?, 1000, 5000, '2026-10-01T00:00:00Z')`).run(gse, `Study ${gse}`, gsms.length, gsms.length);
  env.DB.raw.prepare(`INSERT OR REPLACE INTO gse_meta (gse_id, has_bundle) VALUES (?, ?)`).run(gse, opts.hasBundle ?? 1);
  for (const g of gsms) {
    env.DB.raw.prepare(`INSERT OR REPLACE INTO gsm (gsm_id, gse_id, organism_primary, tissue_group, disease_group, assay_family) VALUES (?, ?, ?, 'Blood', 'Healthy / control', '10x 3')`).run(g, gse, opts.organism ?? "Homo sapiens");
    env.DB.raw.prepare(`INSERT OR REPLACE INTO sample_qc (gsm_id, gse_id, n_cells_called, usable, qc_tier, updated_at) VALUES (?, ?, 120, 1, 0, '2026-10-01T00:00:00Z')`).run(g, gse);
  }
}

function rpc(env: Env, name: string, args: Record<string, unknown> = {}, id = 1) {
  const request = new Request("https://singlet.bio/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
  return (async () => {
    const r = await onRequestPost({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
    const body = (await r.json()) as { result: { content: { text: string }[]; structuredContent?: any; isError?: boolean; _meta?: any } };
    return body.result;
  })();
}

// ── a fake data host: the sample object under several keys, the pack files, and the legacy bundle ──────────────────────────────

let host: FakeHost;
let log: string[];
function serveObjects(gsms: string[]) {
  for (const g of gsms) host.put(`https://data.singlet.bio/${sampleKey(g)}`, { bytes: S2, etag: '"s2"' });
}
beforeEach(() => {
  forgetKeyMemo();
  configureS1(undefined);
  clearPackCache();
  clearPackIndexMemo();
  resetS1ToolsGate();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  host = new FakeHost();
  log = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    log.push(url);
    if (url.endsWith("/s1/ref/index.json")) return new Response(JSON.stringify(PACK_INDEX), { status: 200 });
    const pack = /\/s1\/ref\/([0-9a-f]{32})\.pack$/.exec(url);
    if (pack) {
      try {
        return new Response(readFileSync(`${PACKS_DIR}/${pack[1]}.pack`), { status: 200 });
      } catch {
        return new Response("no", { status: 404 });
      }
    }
    return host.fetch(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const S1_TOOL_NAMES = ["find_cells", "slice_cells", "resolve_features"];

describe("tools/list and the instructions", () => {
  type Tool = { name: string; inputSchema: { properties: Record<string, unknown> } };
  async function rpcRaw(env: unknown, method: string, params: unknown = {}) {
    const request = new Request("https://singlet.bio/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const res = await onRequestPost({ request, env, waitUntil: () => undefined, params: {} } as never);
    return ((await res.json()) as { result: any }).result;
  }
  const list = async (env: unknown) => ((await rpcRaw(env, "tools/list")) as { tools: Tool[] }).tools;

  it("lists the original 14 tools until some study is served from s1, with known_rev where it applies and no verbose", async () => {
    const env = await setup();
    const tools = await list(env);
    expect(tools).toHaveLength(14);
    for (const n of S1_TOOL_NAMES) expect(tools.map((t) => t.name)).not.toContain(n);
    for (const n of ["get_study", "get_sample_qc", "list_bundle_files", "get_modalities", "get_partial_download"]) {
      expect(tools.find((t) => t.name === n)!.inputSchema.properties.known_rev, n).toBeDefined();
    }
    // the s1-only inputs are not advertised either, and nothing mentions verbose
    expect(tools.find((t) => t.name === "list_bundle_files")!.inputSchema.properties.detail).toBeUndefined();
    expect(tools.find((t) => t.name === "get_download_url")!.inputSchema.properties.include_samples).toBeUndefined();
    for (const t of tools) expect(t.inputSchema.properties.verbose, t.name).toBeUndefined();
    const instructions = (await rpcRaw(env, "initialize", { protocolVersion: "2025-06-18" })).instructions as string;
    expect(instructions).not.toMatch(/find_cells|singlet-s1/);
    expect(instructions).toMatch(/known_rev/);
    expect(instructions).not.toMatch(/structuredContent/);
  });

  it("adds the five s1 tools and the s1-only inputs once a study is served from s1", async () => {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"]);
    const tools = await list(env);
    expect(tools).toHaveLength(21);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(S1_TOOL_NAMES));
    expect(tools.find((t) => t.name === "list_bundle_files")!.inputSchema.properties.detail).toBeDefined();
    expect(tools.find((t) => t.name === "get_download_url")!.inputSchema.properties.include_samples).toBeDefined();
    const instructions = (await rpcRaw(env, "initialize", { protocolVersion: "2025-06-18" })).instructions as string;
    expect(instructions).toMatch(/find_cells/);
    expect(instructions).toMatch(/singlet-s1/);
  });

  it("does not advertise them for a study that is only uploaded, running or failed; a verified one does; and retired still does", async () => {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"], {}, null); // uploaded
    expect(await list(env)).toHaveLength(14);
    resetS1ToolsGate();
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "running" });
    expect(await list(env)).toHaveLength(14);
    resetS1ToolsGate();
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "verified", verify_ok: true });
    expect(await list(env)).toHaveLength(21);
    resetS1ToolsGate();
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "retired", verify_ok: true });
    expect(await list(env)).toHaveLength(21);
  });

  it("S1_TOOLS=1 lists them before any study is served", async () => {
    const env = { ...(await setup()), S1_TOOLS: "1" };
    expect(await list(env)).toHaveLength(21);
    // and the catalog is not even asked
    const sql: string[] = [];
    const orig = env.DB.prepare.bind(env.DB);
    (env.DB as { prepare: unknown }).prepare = (q: string) => (sql.push(q), orig(q));
    await list(env);
    expect(sql).toHaveLength(0);
  });

  it("asks D1 at most once per five minutes per isolate, and answers no before schema 032 exists", async () => {
    vi.useFakeTimers();
    try {
      const env = await setup();
      const sql: string[] = [];
      const orig = env.DB.prepare.bind(env.DB);
      (env.DB as { prepare: unknown }).prepare = (q: string) => (sql.push(q), orig(q));
      await Promise.all([list(env), list(env), list(env)]);
      await list(env);
      expect(sql.filter((q) => /s1_study/.test(q))).toHaveLength(1);
      vi.advanceTimersByTime(4 * 60_000);
      await list(env);
      expect(sql.filter((q) => /s1_study/.test(q))).toHaveLength(1);
      vi.advanceTimersByTime(61_000);
      await list(env);
      expect(sql.filter((q) => /s1_study/.test(q))).toHaveLength(2);
      // a database without the s1 tables
      resetS1ToolsGate();
      const bare = { DB: createTestD1("") };
      expect(await list(bare)).toHaveLength(14);
    } finally {
      vi.useRealTimers();
    }
  });

  it("MCP_DIET=1 adds verbose to every tool, and says so in the instructions", async () => {
    const env = { ...(await setup()), MCP_DIET: "1" };
    const tools = await list(env);
    for (const t of tools) expect(t.inputSchema.properties.verbose, t.name).toBeDefined();
    expect(((await rpcRaw(env, "initialize", { protocolVersion: "2025-06-18" })).instructions as string)).toMatch(/structuredContent/);
  });

  it("the s1 tools still answer when called by name before they are advertised", async () => {
    const env = await setup();
    const r = await rpc(env, "find_cells", { gse_ids: ["GSE1"], cell_filter: {} });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.samples_scanned).toBe(0);
  });

  it("the GET description lists what tools/list lists", async () => {
    const env = await setup();
    const { onRequestGet } = await import("../../functions/mcp");
    const res = await onRequestGet({ env, request: new Request("https://singlet.bio/mcp"), params: {}, waitUntil: () => undefined } as never);
    expect(((await res.json()) as { tools: string[] }).tools).toHaveLength(14);
    resetS1ToolsGate();
    const on = await onRequestGet({ env: { ...env, S1_TOOLS: "1" }, request: new Request("https://singlet.bio/mcp"), params: {}, waitUntil: () => undefined } as never);
    expect(((await on.json()) as { tools: string[] }).tools).toHaveLength(21);
  });

  it("the tools that return byte ranges, and the instructions, say to fetch them concurrently", async () => {
    resetS1ToolsGate();
    const env = { ...(await setup()), S1_TOOLS: "1" };
    const tools = await list(env);
    for (const n of ["list_bundle_files", "get_partial_download", "slice_cells"]) {
      expect((tools.find((t) => t.name === n) as unknown as { description: string }).description, n).toMatch(/concurrently \(about 8 requests in flight\)/);
    }
    const init = await rpcRaw(env, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.instructions).toMatch(/send them concurrently/);
  });
});

describe("response diet (MCP_DIET=1)", () => {
  it("is off by default: the text keeps the full rendering next to the structured data, and verbose is ignored", async () => {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"]);
    const full = await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: "GSM1000001" });
    expect(full.content[0].text).not.toMatch(/Shortened/);
    expect(full.structuredContent.files.length).toBeGreaterThan(3);
    const same = await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: "GSM1000001", verbose: false });
    expect(same.content[0].text).toBe(full.content[0].text);
  });

  it("shortens a long text and keeps the data once; verbose=true brings the full text back; errors are untouched", async () => {
    const env = { ...(await setup()), MCP_DIET: "1" };
    const gsms = Array.from({ length: 25 }, (_, i) => `GSM20000${String(i).padStart(2, "0")}`);
    seedCatalog(env, "GSE1", gsms);
    await ingest(env, "GSE1", gsms);
    const slim = await rpc(env, "get_modalities", { gse_id: "GSE1" });
    const full = await rpc(env, "get_modalities", { gse_id: "GSE1", verbose: true });
    expect(slim.structuredContent).toEqual(full.structuredContent);
    expect(full.content[0].text).not.toMatch(/Shortened/);
    expect(slim.content[0].text.length).toBeLessThanOrEqual(full.content[0].text.length);
    // a text that fits is not touched
    const small = await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: gsms[0] });
    expect(small.content[0].text).toBe((await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: gsms[0], verbose: true })).content[0].text);
    const err = await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: "GSM404" });
    expect(err.isError).toBe(true);
    expect(err.content[0].text).not.toMatch(/Shortened/);
  });

  it("summarize keeps the lines of a list-shaped text, clips them, and counts what it leaves out; a text that fits is returned whole", () => {
    expect(summarize("a\nb\n\nc")).toBe("a\nb\n\nc");
    const rows = Array.from({ length: 200 }, (_, i) => `- GSE${i} — a study with a title`);
    const short = summarize(["200 matching studies.", "", ...rows].join("\n"));
    expect(short).toMatch(/^200 matching studies\.\n\n- GSE0 — a study/);
    expect(short).toMatch(/… \d+ more lines\.\n\(Shortened;/);
    expect(short.split("\n").length).toBeLessThanOrEqual(SUMMARY_MAX_LINES + 2);
    const wide = summarize(["x ".repeat(400)].join("\n"));
    expect(wide).toMatch(/…\n\(Shortened/);
    expect(wide.split("\n")[0].length).toBeLessThanOrEqual(401);
    const plain = { content: [{ type: "text" as const, text: "a\n\nb" }] };
    expect(diet(plain, {}, { MCP_DIET: "1" })).toBe(plain); // no structured data: left alone
    const withData = { ...plain, structuredContent: { a: 1 } };
    expect(diet(withData, {}, { MCP_DIET: "1" })).toBe(withData); // it already fits whole
    expect(diet(withData, {}, {})).toBe(withData); // diet off
    const long = { content: [{ type: "text" as const, text: ["head", ...rows].join("\n") }], structuredContent: { rows: 200 } };
    expect(diet(long, {}, { MCP_DIET: "1" }).content[0].text).toMatch(/Shortened/);
    expect(diet(long, { verbose: true }, { MCP_DIET: "1" })).toBe(long);
    expect(diet(long, { verbose: false }, {})).toBe(long); // without MCP_DIET the argument does nothing
  });
});

describe("get_download_url", () => {
  it("answers a migrated study with the manifest, and lists the sample objects on request", async () => {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001", "GSM1000002", "GSM1000003"]);
    await ingest(env, "GSE1", ["GSM1000001", "GSM1000002", "GSM1000003"]);
    const r = await rpc(env, "get_download_url", { gse_id: "GSE1" });
    expect(r.structuredContent).toMatchObject({
      gse_id: "GSE1", format: "singlet-s1", available: true, rev: hex("1", 16), n_samples: 3, bytes: 3 * SAMPLE.bytes,
      manifest_url: "https://data.singlet.bio/s1/m/GSE1.json", curl: "curl -fLO https://data.singlet.bio/s1/m/GSE1.json",
      legacy: { url: "https://data.singlet.bio/data/GSE1/GSE1.singlet", bytes: 5000 },
    });
    expect(r.structuredContent.samples).toBeUndefined();
    const withSamples = await rpc(env, "get_download_url", { gse_id: "GSE1", include_samples: true, limit: 2 });
    expect(withSamples.structuredContent.samples.map((s: { gsm_id: string }) => s.gsm_id)).toEqual(["GSM1000001", "GSM1000002"]);
    expect(withSamples.structuredContent.samples[0].url).toBe(`https://data.singlet.bio/${sampleKey("GSM1000001")}`);
    expect(withSamples.structuredContent.next_after).toBe("GSM1000002");
    const page2 = await rpc(env, "get_download_url", { gse_id: "GSE1", include_samples: true, limit: 2, after: "GSM1000002" });
    expect(page2.structuredContent.samples.map((s: { gsm_id: string }) => s.gsm_id)).toEqual(["GSM1000003"]);
    expect(page2.structuredContent.next_after).toBeNull();
  });

  it("keeps the legacy answer while the migration has not been verified, and drops the legacy block once retired", async () => {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "running" });
    const legacy = await rpc(env, "get_download_url", { gse_id: "GSE1" });
    expect(legacy.structuredContent).toMatchObject({ available: true, url: "https://data.singlet.bio/data/GSE1/GSE1.singlet", bytes: 5000 });
    expect(legacy.structuredContent.format).toBeUndefined();
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "retired", verify_ok: true });
    const retired = await rpc(env, "get_download_url", { gse_id: "GSE1" });
    expect(retired.structuredContent.format).toBe("singlet-s1");
    expect(retired.structuredContent.legacy).toBeNull();
  });
});

describe("list_bundle_files, get_partial_download, get_modalities on an s1 study", () => {
  async function seeded() {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001", "GSM1000002"]);
    await ingest(env, "GSE1", ["GSM1000001", "GSM1000002"]);
    return env;
  }

  it("list_bundle_files: a grouped summary by default, one sample's files with ranges, detail pages, and unchanged", async () => {
    const env = await seeded();
    const r = (await rpc(env, "list_bundle_files", { gse_id: "GSE1" })).structuredContent;
    expect(r).toMatchObject({ format: "singlet-s1", rev: hex("1", 16), n_samples: 2, next_after: null });
    expect(r.files_in_each_sample.map((f: { name: string }) => f.name)).toEqual(expect.arrayContaining(["exon_counts.1pz", "intron_counts.1pz", "cells", "summary.json"]));
    expect(r.samples).toHaveLength(2);
    expect(r.samples[0]).not.toHaveProperty("files");
    expect(log).toHaveLength(0); // nothing is fetched: the answer comes from D1

    const one = (await rpc(env, "list_bundle_files", { gse_id: "GSE1", gsm_id: "GSM1000002" })).structuredContent;
    const exon = one.files.find((f: { name: string }) => f.name === "exon_counts.1pz");
    expect(exon).toMatchObject({ kind: 1, kind_name: "pz2 matrix", range: `bytes=${SAMPLE.members["exon_counts.1pz"].off}-${SAMPLE.members["exon_counts.1pz"].off + SAMPLE.members["exon_counts.1pz"].len - 1}`, chunk_cols: 64, n_chunks: 5 });
    expect(one.files.find((f: { name: string }) => f.name === "cell_qc_metrics.tsv")).toMatchObject({ kind: 4, range: null, recipe: "cellqc-v1" });
    expect(one.fetch).toMatchObject({ concurrent: true, in_flight: 8 });

    const detail = (await rpc(env, "list_bundle_files", { gse_id: "GSE1", detail: true, limit: 1 })).structuredContent;
    expect(detail.samples).toHaveLength(1);
    expect(detail.samples[0].files.length).toBeGreaterThan(3);
    expect(detail.next_after).toBe("GSM1000001");

    const same = await rpc(env, "list_bundle_files", { gse_id: "GSE1", known_rev: hex("1", 16) });
    expect(same.structuredContent).toEqual({ gse_id: "GSE1", rev: hex("1", 16), unchanged: true });
    const stale = await rpc(env, "list_bundle_files", { gse_id: "GSE1", known_rev: hex("2", 16) });
    expect(stale.structuredContent.unchanged).toBeUndefined();
  });

  it("get_partial_download: the member range inside the immutable object, by kind", async () => {
    const env = await seeded();
    const m = SAMPLE.members;
    const mat = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz" })).structuredContent;
    expect(mat).toMatchObject({
      format: "singlet-s1", rev: hex("1", 16), file: "exon_counts.1pz", url: `https://data.singlet.bio/${sampleKey("GSM1000001")}`,
      range: `bytes=${m["exon_counts.1pz"].off}-${m["exon_counts.1pz"].off + m["exon_counts.1pz"].len - 1}`, bytes: m["exon_counts.1pz"].len,
      member: { kind: 1, codec: { id: 2 }, columns: 300, n_chunks: 5 },
      slice_with: { tool: "slice_cells", gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz" },
    });
    expect(mat.curl).toContain(`-r ${m["exon_counts.1pz"].off}-`);
    expect(mat.curl).not.toMatch(/If-Match/); // objects are immutable
    expect(mat.fetch).toMatchObject({ concurrent: true, in_flight: 8 });
    const stored = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "summary.json" })).structuredContent;
    expect(stored.member).toMatchObject({ kind: 3, legacy_bytes: 237 });
    const derived = (await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "cell_qc_metrics.tsv" })).structuredContent;
    expect(derived).toMatchObject({ range: null, curl: null, member: { kind: 4, recipe: "cellqc-v1" } });
    expect(derived.how).toMatch(/regenerated/);
    const missing = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "nope.tsv" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/Files for this sample: .*exon_counts\.1pz/);
    const noSample = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM9", file: "exon_counts.1pz" });
    expect(noSample.isError).toBe(true);
    const same = await rpc(env, "get_partial_download", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz", known_rev: hex("1", 16) });
    expect(same.structuredContent.unchanged).toBe(true);
  });

  it("get_modalities: from the compact column, without reading any member list", async () => {
    const env = await seeded();
    const r = (await rpc(env, "get_modalities", { gse_id: "GSE1" })).structuredContent;
    expect(r.rev).toBe(hex("1", 16));
    expect(r.modalities.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["exon_counts", "intron_counts"]));
    expect(r.modalities.find((m: { name: string }) => m.name === "exon_counts").n_samples).toBe(2);
    expect(r.per_sample).toHaveLength(2);
    const one = (await rpc(env, "get_modalities", { gse_id: "GSE1", gsm_id: "GSM1000002" })).structuredContent;
    expect(one.n_samples).toBe(1);
    expect((await rpc(env, "get_modalities", { gse_id: "GSE1", gsm_id: "GSM404" })).isError).toBe(true);
    expect((await rpc(env, "get_modalities", { gse_id: "GSE1", known_rev: hex("1", 16) })).structuredContent.unchanged).toBe(true);
  });

  it("get_modalities: per_sample names only the modalities Alpha offers", async () => {
    const env = await seeded();
    // the catalog column can name layers that are not served (the transcode lists mt_variants and splice_events)
    await env.DB.prepare("UPDATE s1_sample SET modalities = ? WHERE gsm_id = ?").bind('["exon_counts","mt_variants","splice_events"]', "GSM1000001").run();
    const r = (await rpc(env, "get_modalities", { gse_id: "GSE1", gsm_id: "GSM1000001" })).structuredContent;
    expect(r.per_sample).toEqual([{ gsm_id: "GSM1000001", modalities: ["exon_counts"] }]);
    expect(JSON.stringify(r)).not.toMatch(/mt_variants|splice_events/);
  });
});

describe("legacy studies keep working, and get rev / known_rev", () => {
  it("list_bundle_files and get_partial_download read the bundle, report rev, and answer unchanged", async () => {
    const env = await setup();
    seedCatalog(env, "GSE9", ["GSM1"]);
    const files = [
      { name: "manifest.json", data: new TextEncoder().encode("{}"), deflate: true },
      { name: "samples/GSM1/exon_counts.1pz", data: new TextEncoder().encode("TP1Z legacy matrix".padEnd(64, ".")) },
    ];
    host.put("https://data.singlet.bio/data/GSE9/GSE9.singlet", { bytes: buildZip(files).bytes, etag: '"legacy-1"' });
    const list = (await rpc(env, "list_bundle_files", { gse_id: "GSE9" })).structuredContent;
    expect(list.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(list.samples[0].gsm_id).toBe("GSM1");
    expect(list.format).toBeUndefined();
    const same = await rpc(env, "list_bundle_files", { gse_id: "GSE9", known_rev: list.rev });
    expect(same.structuredContent).toEqual({ gse_id: "GSE9", rev: list.rev, unchanged: true });
    const part = (await rpc(env, "get_partial_download", { gse_id: "GSE9", gsm_id: "GSM1", file: "exon_counts.1pz" })).structuredContent;
    expect(part.rev).toBe(list.rev); // one rev per study file, across tools
    expect(part.etag).toBe('"legacy-1"');
    expect((await rpc(env, "get_partial_download", { gse_id: "GSE9", gsm_id: "GSM1", file: "exon_counts.1pz", known_rev: list.rev })).structuredContent.unchanged).toBe(true);
    const mod = (await rpc(env, "get_modalities", { gse_id: "GSE9" })).structuredContent;
    expect(mod.rev).toBe(list.rev);
    // the file is replaced: the rev moves
    host.put("https://data.singlet.bio/data/GSE9/GSE9.singlet", { bytes: buildZip(files).bytes, etag: '"legacy-2"' });
    const after = (await rpc(env, "list_bundle_files", { gse_id: "GSE9", known_rev: list.rev })).structuredContent;
    expect(after.unchanged).toBeUndefined();
    expect(after.rev).not.toBe(list.rev);
  });

  it("get_sample_qc reports a rev that moves when QC rows change", async () => {
    const env = await setup();
    seedCatalog(env, "GSE9", ["GSM1"]);
    const a = (await rpc(env, "get_sample_qc", { gse_id: "GSE9" })).structuredContent;
    expect(a.rev).toMatch(/^[0-9a-f]{16}$/);
    expect((await rpc(env, "get_sample_qc", { gse_id: "GSE9", known_rev: a.rev })).structuredContent).toEqual({ gse_id: "GSE9", rev: a.rev, unchanged: true });
    env.DB.raw.prepare(`UPDATE sample_qc SET updated_at = '2026-10-22T00:00:00Z'`).run();
    expect((await rpc(env, "get_sample_qc", { gse_id: "GSE9", known_rev: a.rev })).structuredContent.unchanged).toBeUndefined();
  });
});

describe("find_cells", () => {
  const col = (name: string): number[] => EXPECTED.cells.columns.find((c: { name: string }) => c.name === name).values;
  const exonU = col("n_umi_exon");
  const intronU = col("n_umi_intron");
  const called = col("called");
  const runsOf = (pred: (i: number) => boolean): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < exonU.length; i++) {
      if (!pred(i)) continue;
      const last = out[out.length - 1];
      if (last && last[0] + last[1] === i) last[1]++;
      else out.push([i, 1]);
    }
    return out;
  };

  async function seeded(n = 1) {
    const env = await setup();
    const gsms = Array.from({ length: n }, (_, i) => `GSM100000${i + 1}`);
    seedCatalog(env, "GSE1", gsms);
    await ingest(env, "GSE1", gsms);
    serveObjects(gsms);
    return { env, gsms };
  }

  it("returns the matching cells as column runs, equal to a brute-force pass over the table, with one read per sample", async () => {
    const { env } = await seeded();
    const r = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], cell_filter: { min_umi: 200 } })).structuredContent;
    const want = runsOf((i) => called[i] === 1 && exonU[i] + intronU[i] >= 200);
    expect(r.samples_scanned).toBe(1);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ gse_id: "GSE1", gsm_id: "GSM1000001", rev: hex("1", 16), n_columns: 300, runs_truncated: false });
    expect(r.results[0].runs).toEqual(want);
    expect(r.results[0].n_match).toBe(want.reduce((n, [, l]) => n + l, 0));
    expect(r.requests).toBe(1); // the cells table is small: one ranged read
    expect(r.next_after).toBeNull();
    expect(r.cells_matched).toBe(r.results[0].n_match);

    const all = (await rpc(env, "find_cells", { gsm_ids: ["GSM1000001"], cell_filter: { called_only: false, max_umi: 40 } })).structuredContent;
    expect(all.results[0].runs).toEqual(runsOf((i) => exonU[i] + intronU[i] <= 40));
    const where = (await rpc(env, "find_cells", { gsm_ids: ["GSM1000001"], cell_filter: { where: [{ column: "n_feat_exon", op: ">=", value: 60 }] } })).structuredContent;
    const featE = col("n_feat_exon");
    expect(where.results[0].runs).toEqual(runsOf((i) => called[i] === 1 && featE[i] >= 60));
    const none = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], cell_filter: { min_umi: 1e9 } })).structuredContent;
    expect(none.results).toEqual([]);
    expect(none.samples_scanned).toBe(1);
  });

  it("filters samples by their label facts, and cells by the labels the atlas cell index gives them", async () => {
    const { env } = await seeded(2);
    env.DB.raw.exec(`INSERT INTO sample_attr (gsm_id, gse_id, attr, value_norm, ontology_id, value_num, source, extractor_version)
      VALUES ('GSM1000001', 'GSE1', 'cell_type', 'T cell', 'CL:0000084', 0.7, 'pipeline', 't'), ('GSM1000002', 'GSE1', 'sex_genetic', 'male', 'PATO:0000384', 1, 'pipeline', 't')`);
    const byType = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], sample_filter: { cell_type_label: ["t cell"] }, cell_filter: {} })).structuredContent;
    expect(byType.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000001"]);
    const bySex = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], sample_filter: { sex_genetic: "male" }, cell_filter: {} })).structuredContent;
    expect(bySex.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000002"]);

    // per-cell labels: the cell index names the labelled cells; find_cells ANDs them with the cells-table filter
    const calledIdx = called.map((c, i) => (c === 1 ? i : -1)).filter((i) => i >= 0);
    const uncalled = called.indexOf(0);
    const labelled = [calledIdx[0], calledIdx[1], calledIdx[5], uncalled];
    const prev = globalThis.fetch;
    const bodies: any[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://data.singlet.bio/s1/cidx/query") {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ version: "20261101T0000Z-00000000", n: labelled.length, eligible: labelled.length, cells: { gsm: labelled.map(() => "GSM1000001"), col: labelled } }), { status: 200 });
      }
      return prev(input, init);
    });
    const r = (await rpc(env, "find_cells", { gsm_ids: ["GSM1000001"], cell_labels: { cell_type: ["T cell"], sex: "Female" }, cell_filter: {} })).structuredContent;
    expect(bodies[0]).toMatchObject({ where: { samples: ["GSM1000001"], cell_type: ["T cell"], sex: ["female"] }, return: "cells" });
    expect(r.results[0].runs).toEqual(runsOf((i) => [calledIdx[0], calledIdx[1], calledIdx[5]].includes(i)));
    // the fixture object predates the label columns, so the cell index answers for it
    expect(r.cell_labels).toMatchObject({ samples_from_cells_table: 0, cell_index: { samples: 1, complete: true, cells_labelled: 4, cells_returned: 4, index_version: "20261101T0000Z-00000000" } });

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).endsWith("/s1/cidx/query") ? new Response(JSON.stringify({ error: "over_budget", message: "too big" }), { status: 413 }) : prev(input, init)
    );
    const refused = (await rpc(env, "find_cells", { gsm_ids: ["GSM1000001"], cell_labels: { cell_type: "T cell" } })).structuredContent;
    expect(refused.results).toEqual([]);
    expect(refused.errors[0].error).toMatch(/no label columns, and the atlas cell index refused the query: too big/);
    expect((await rpc(env, "find_cells", { gsm_ids: ["GSM1000001"], cell_labels: { tissue: "lung" } })).content[0].text).toMatch(/unknown key 'tissue'/);
    expect((await rpc(env, "find_cells", { gsm_ids: ["GSM1000001"], cell_labels: { sex: "x" } })).content[0].text).toMatch(/sex takes/);
  });

  it("filters samples in D1 first: depth, organism, called cells, QC", async () => {
    const { env } = await seeded(2);
    env.DB.raw.prepare(`UPDATE gsm SET organism_primary = 'Mus musculus' WHERE gsm_id = 'GSM1000002'`).run();
    const human = (await rpc(env, "find_cells", { sample_filter: { organism: "human" }, cell_filter: {} })).structuredContent;
    expect(human.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000001"]);
    const mouse = (await rpc(env, "find_cells", { sample_filter: { organism: "Mus musculus" }, cell_filter: {} })).structuredContent;
    expect(mouse.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000002"]);
    const deep = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], sample_filter: { min_median_umi: 10_000 } })).structuredContent;
    expect(deep.samples_scanned).toBe(0);
    const some = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], sample_filter: { min_called: 100, max_called: 120, min_median_genes: 50 } })).structuredContent;
    expect(some.samples_scanned).toBe(2);
    env.DB.raw.prepare(`UPDATE sample_qc SET qc_tier = 1 WHERE gsm_id = 'GSM1000002'`).run();
    expect((await rpc(env, "find_cells", { gse_ids: ["GSE1"], cell_filter: {} })).structuredContent.samples_scanned).toBe(1); // low QC left out
    expect((await rpc(env, "find_cells", { gse_ids: ["GSE1"], sample_filter: { include_low_qc: true }, cell_filter: {} })).structuredContent.samples_scanned).toBe(2);
  });

  it("pages through samples with `after` and stays within the request budget", async () => {
    const { env } = await seeded(5);
    const p1 = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], limit_samples: 2, cell_filter: {} })).structuredContent;
    expect(p1.samples_scanned).toBe(2);
    expect(p1.next_after).toBe("GSE1/GSM1000002");
    const p2 = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], limit_samples: 2, after: p1.next_after, cell_filter: {} })).structuredContent;
    expect(p2.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000003", "GSM1000004"]);
    const p3 = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], limit_samples: 2, after: p2.next_after, cell_filter: {} })).structuredContent;
    expect(p3.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000005"]);
    expect(p3.next_after).toBeNull();
    expect(p1.requests + p2.requests + p3.requests).toBe(5);
    const biggest = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], limit_samples: 25, cell_filter: {} })).structuredContent;
    expect(biggest.requests).toBeLessThanOrEqual(biggest.request_limit);
  });

  it("stops at the request budget and says where to continue", async () => {
    const { env } = await seeded(5);
    const r = (await findCells({ db: env.DB, waitUntil: () => undefined }, { gse_ids: ["GSE1"], limit_samples: 5, cell_filter: {} }, { maxRequests: 3 })).structuredContent as {
      samples_scanned: number; requests: number; budget_exhausted: boolean; next_after: string | null; request_limit: number;
    };
    expect(r.samples_scanned).toBe(3);
    expect(r.requests).toBe(3);
    expect(r.budget_exhausted).toBe(true);
    expect(r.request_limit).toBe(3);
    expect(r.next_after).toBe("GSE1/GSM1000003");
    const rest = (await findCells({ db: env.DB, waitUntil: () => undefined }, { gse_ids: ["GSE1"], limit_samples: 5, after: r.next_after, cell_filter: {} }, { maxRequests: 3 })).structuredContent as { samples_scanned: number; next_after: string | null };
    expect(rest.samples_scanned).toBe(2);
    expect(rest.next_after).toBeNull();
  });

  it("refuses unscoped or malformed requests and says why", async () => {
    const { env } = await seeded();
    const bad = async (args: Record<string, unknown>, re: RegExp) => {
      const r = await rpc(env, "find_cells", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.content[0].text).toMatch(re);
    };
    await bad({ cell_filter: { min_umi: 1 } }, /Say which samples/);
    await bad({ gse_ids: ["GSE1"], sample_filter: { colour: "red" } }, /Unknown sample_filter key 'colour'/);
    await bad({ gse_ids: ["GSE1"], cell_filter: { min_umi: "x" } }, /cell_filter/);
    await bad({ gse_ids: ["GSE1"], cell_filter: { bogus: 1 } }, /cell_filter/);
    await bad({ gse_ids: Array.from({ length: 21 }, (_, i) => `GSE${i + 1}`) }, /at most 20/);
    await bad({ gsm_ids: ["GSM1"], sample_filter: { min_called: "many" } }, /min_called must be a number/);
  });

  it("reports a sample whose cells table cannot be read instead of failing the call", async () => {
    const { env } = await seeded(2);
    host.objects.delete(`https://data.singlet.bio/${sampleKey("GSM1000002")}`);
    const r = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], cell_filter: {} })).structuredContent;
    expect(r.results.map((x: { gsm_id: string }) => x.gsm_id)).toEqual(["GSM1000001"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ gsm_id: "GSM1000002" });
  });

  it("only searches studies that are served from s1", async () => {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "running" });
    serveObjects(["GSM1000001"]);
    const r = (await rpc(env, "find_cells", { gse_ids: ["GSE1"], cell_filter: {} })).structuredContent;
    expect(r.samples_scanned).toBe(0);
  });
});

describe("slice_cells", () => {
  async function seeded() {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"]);
    serveObjects(["GSM1000001"]);
    return env;
  }

  it("plans the chunk runs of the named cells for both matrices, from the chunk index", async () => {
    const env = await seeded();
    const r = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", runs: [[70, 10], [250, 5]] })).structuredContent;
    expect(r).toMatchObject({ format: "singlet-s1", rev: hex("1", 16), url: `https://data.singlet.bio/${sampleKey("GSM1000001")}`, immutable: true, n_columns: 300, skipped: [] });
    expect(r.files.map((f: { file: string }) => f.file)).toEqual(["exon_counts.1pz", "intron_counts.1pz"]);
    expect(r.fetch).toMatchObject({ concurrent: true, in_flight: 8 });
    expect(r.how).toMatch(/all of them concurrently/);
    const exon = r.files[0];
    const hdr = EXPECTED.matrices["exon_counts.1pz"];
    const base = hdr.member_off + hdr.header.sections.chunks[0];
    const rec = hdr.chunk_index;
    expect(exon.chunks.map((c: { first_chunk: number; last_chunk: number }) => [c.first_chunk, c.last_chunk])).toEqual([[1, 1], [3, 3]]);
    expect(exon.chunks[0]).toMatchObject({ first_col: 64, end_col: 128, start: base + rec[1].off, end: base + rec[1].off + rec[1].len - 1 });
    // 250..254 is in chunk 3 (192..255)
    expect(exon.chunks[1]).toMatchObject({ first_chunk: 3, last_chunk: 3 });
    expect(exon.columns_wanted).toBe(15);
    expect(exon.prefix[0]).toMatchObject({ start: hdr.member_off });
    expect(exon).toMatchObject({ rows: 400, columns: 300, nnz: 9379, chunk_cols: 64, codec: { id: 2 } });
    expect(r.cells_table).toMatchObject({ kind: 2, columns: 300 });
    expect(r.requests).toBe(2); // one read of header + chunk index per matrix
  });

  it("takes a single file, indices or a range, and no selection means every chunk", async () => {
    const env = await seeded();
    const one = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "intron_counts.1pz", indices: [0, 1, 2, 299] })).structuredContent;
    expect(one.files).toHaveLength(1);
    expect(one.files[0].chunks.map((c: { first_chunk: number }) => c.first_chunk)).toEqual([0, 4]);
    const range = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz", range: [64, 192] })).structuredContent;
    expect(range.files[0].chunks).toHaveLength(1);
    expect(range.files[0].chunks[0]).toMatchObject({ first_chunk: 1, last_chunk: 2 });
    const all = (await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz" })).structuredContent;
    expect(all.files[0].bytes_chunks).toBe(EXPECTED.matrices["exon_counts.1pz"].header.sections.chunks[1]);
  });

  it("explains what it cannot do", async () => {
    const env = await seeded();
    const bad = async (args: Record<string, unknown>, re: RegExp) => {
      const r = await rpc(env, "slice_cells", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.content[0].text).toMatch(re);
    };
    await bad({ gse_id: "GSE1", gsm_id: "GSM1000001", runs: [[290, 20]] }, /outside the matrix/);
    await bad({ gse_id: "GSE1", gsm_id: "GSM1000001", runs: [[0, 1]], indices: [1] }, /one of runs, indices or range/);
    await bad({ gse_id: "GSE1", gsm_id: "GSM1000001", file: "summary.json" }, /no chunks/);
    await bad({ gse_id: "GSE1", gsm_id: "GSM404" }, /not in GSE1/);
    await bad({ gse_id: "GSE404", gsm_id: "GSM1000001" }, /not in the per-sample format/);
    await bad({ gse_id: "nope", gsm_id: "GSM1" }, /gse_id/);
  });

  it("reports a manifest that disagrees with the object", async () => {
    const env = await seeded();
    const row = env.DB.raw.prepare(`SELECT members_json FROM s1_sample`).get() as { members_json: string };
    const m = JSON.parse(row.members_json);
    m["exon_counts.1pz"].len += 5;
    env.DB.raw.prepare(`UPDATE s1_sample SET members_json = ?`).run(JSON.stringify(m));
    const r = await rpc(env, "slice_cells", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz", runs: [[0, 1]] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/disagree/);
  });
});

describe("resolve_features", () => {
  const expected = (k: string) => PACK_EXPECTED[k] as { id: string; names: string[]; n: number };

  async function seeded(rowsRef: unknown) {
    const env = await setup();
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    const entry = (g: string) => {
      const e = sampleEntry(g);
      (e.members["exon_counts.1pz"] as { names: unknown }).names = { rows: rowsRef, cols: "cells" };
      return e;
    };
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "verified", verify_ok: true }, entry);
    return env;
  }

  it("resolves row numbers from a pack id, a prefix, or the sample's own matrix", async () => {
    const env = await seeded({ member: "exon", pack: expected("A.exon").id });
    const a = expected("A.exon");
    const byId = (await rpc(env, "resolve_features", { pack: a.id, indices: [0, 3, 11, 12, 999] })).structuredContent;
    expect(byId.pack).toMatchObject({ id: a.id, kind: "vocab", member: "exon", n: 12 });
    expect(byId.names).toEqual([
      { index: 0, name: a.names[0] }, { index: 3, name: a.names[3] }, { index: 11, name: a.names[11] }, { index: 12, name: null }, { index: 999, name: null },
    ]);
    const byPrefix = (await rpc(env, "resolve_features", { pack: a.id.slice(0, 16), indices: [1] })).structuredContent;
    expect(byPrefix.names[0].name).toBe(a.names[1]);
    const fromMatrix = (await rpc(env, "resolve_features", { gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz", indices: [2] })).structuredContent;
    expect(fromMatrix.names[0].name).toBe(a.names[2]);
    expect(fromMatrix.from).toMatchObject({ gse_id: "GSE1", gsm_id: "GSM1000001", file: "exon_counts.1pz", axis: "rows" });
    // intron and composite packs (the intron pack names its exon pack and fetches it)
    const intron = expected("A.intron");
    const i = (await rpc(env, "resolve_features", { pack: intron.id, indices: [0, 6] })).structuredContent;
    expect(i.names.map((n: { name: string }) => n.name)).toEqual([intron.names[0], intron.names[6]]);
    const comp = expected("AB.exon");
    const c = (await rpc(env, "resolve_features", { pack: comp.id, indices: [0, 12, 14] })).structuredContent;
    expect(c.names.map((n: { name: string }) => n.name)).toEqual([comp.names[0], comp.names[12], comp.names[14]]);
  });

  it("resolves whitelist indices to barcodes", async () => {
    const env = await seeded({ member: "exon", pack: expected("A.exon").id });
    const w = PACK_EXPECTED.W16 as { id: string; names: string[] };
    const r = (await rpc(env, "resolve_features", { pack: w.id, indices: [0, 149] })).structuredContent;
    expect(r.pack).toMatchObject({ kind: "whitelist", k: 16 });
    expect(r.names.map((n: { name: string }) => n.name)).toEqual([w.names[0], w.names[149]]);
  });

  it("refuses bad requests and explains inline names", async () => {
    const env = await seeded("inline");
    const bad = async (args: Record<string, unknown>, re: RegExp) => {
      const r = await rpc(env, "resolve_features", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.content[0].text).toMatch(re);
    };
    await bad({ pack: "abc", indices: [0] }, /16 to 32 hex/);
    await bad({ pack: expected("A.exon").id, indices: [] }, /1 to 500/);
    await bad({ pack: expected("A.exon").id, indices: [-1] }, /non-negative/);
    await bad({ pack: expected("A.exon").id, indices: new Array(501).fill(1) }, /1 to 500/);
    await bad({ indices: [0] }, /Give `pack`/);
    await bad({ gse_id: "GSE1", gsm_id: "GSM1000001", indices: [0] }, /inside the file/);
    await bad({ gse_id: "GSE1", gsm_id: "GSM1000001", axis: "cols", indices: [0] }, /cells table/);
    await bad({ pack: "0".repeat(32), indices: [0] }, /Could not resolve/);
  });
});

describe("get_study rev", () => {
  it("reports a rev, answers unchanged for it, and moves when the study changes or gets an s1 manifest", async () => {
    const env = await setup();
    // the local schema has the full gse/gsm tables loadStudy reads
    for (const t of ["gse", "gsm"]) env.DB.raw.exec(`DROP TABLE ${t}`);
    env.DB.raw.exec(readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, ""));
    env.DB.raw.exec("ALTER TABLE gse ADD COLUMN r2_bundle_n_gsms INTEGER");
    for (const c of ["organism_primary", "tissue_group", "disease_group", "assay_family"]) env.DB.raw.exec(`ALTER TABLE gsm ADD COLUMN ${c} TEXT`);
    seedCatalog(env, "GSE1", ["GSM1"]);
    const a = (await rpc(env, "get_study", { gse_id: "GSE1" })).structuredContent;
    expect(a.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(a.s1).toBeNull();
    expect((await rpc(env, "get_study", { gse_id: "GSE1", known_rev: a.rev })).structuredContent).toEqual({ gse_id: "GSE1", rev: a.rev, unchanged: true });
    env.DB.raw.prepare(`UPDATE gse SET last_updated = '2026-10-22T00:00:00Z' WHERE id = 'GSE1'`).run();
    const b = (await rpc(env, "get_study", { gse_id: "GSE1", known_rev: a.rev })).structuredContent;
    expect(b.unchanged).toBeUndefined();
    expect(b.rev).not.toBe(a.rev);
    await ingest(env, "GSE1", ["GSM1000001"]);
    const c = (await rpc(env, "get_study", { gse_id: "GSE1" })).structuredContent;
    expect(c.s1).toMatchObject({ format: "singlet-s1", rev: hex("1", 16), manifest_url: "https://data.singlet.bio/s1/m/GSE1.json", n_samples: 1 });
    expect(c.rev).not.toBe(b.rev);
  });
});

describe("assess_study and get_study when the legacy file is retired", () => {
  it("describe the s1 files instead of reporting a missing file", async () => {
    const env = await setup();
    for (const t of ["gse", "gsm"]) env.DB.raw.exec(`DROP TABLE ${t}`);
    env.DB.raw.exec(readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, ""));
    env.DB.raw.exec("ALTER TABLE gse ADD COLUMN r2_bundle_n_gsms INTEGER");
    for (const c of ["organism_primary", "tissue_group", "disease_group", "assay_family"]) env.DB.raw.exec(`ALTER TABLE gsm ADD COLUMN ${c} TEXT`);
    seedCatalog(env, "GSE1", ["GSM1000001"]);
    await ingest(env, "GSE1", ["GSM1000001"], {}, { status: "retired", verify_ok: true });
    const a = (await rpc(env, "assess_study", { gse_id: "GSE1" })).structuredContent;
    expect(a.file).toMatchObject({ available: true, url: "https://data.singlet.bio/s1/m/GSE1.json", format: "singlet-s1", n_samples_in_file: 1 });
    expect(a.file.per_sample_files).toEqual(expect.arrayContaining(["exon_counts.1pz", "intron_counts.1pz"]));
    const g = await rpc(env, "get_study", { gse_id: "GSE1", verbose: true });
    expect(g.structuredContent).toMatchObject({ has_bundle: true, bundle_url: null, s1: { format: "singlet-s1" } });
    expect(g.content[0].text).toContain("Files: https://data.singlet.bio/s1/m/GSE1.json (1 sample objects");
  });
});
