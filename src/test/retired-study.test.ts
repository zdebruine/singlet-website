// @vitest-environment node
/**
 * A study whose legacy `.singlet` file is retired (s1_migration.status = 'retired', the object deleted) must answer from s1 everywhere and
 * name no legacy URL. This is the smoke check for retirement, run on fixtures: a D1 stand-in with the catalog rows a retirement leaves behind
 * (gse.r2_bundle_key, bundle_manifest, sample_qc, gse_meta.has_bundle = 1), one retired study, one verified study whose legacy file is still
 * there, one that was never moved, and a data host that has the sample objects and 404s the legacy file. Every response about the
 * retired study is searched for its legacy URL, and every request the code makes is checked against the legacy path.
 *
 * scripts/smoke.sh runs the same check against a deployed site for the studies named in SMOKE_RETIRED.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const nlSearch = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/nl-search-core", async (orig) => ({ ...(await orig<object>()), nlSearch }));

import { onRequestPost as mcpPost } from "../../functions/mcp";
import { normalizeFilters, parseSearchParams, runStudySearch } from "../../functions/_shared/search-core";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { setBitIndex } from "../../functions/_shared/cohort-index";
import { configureS1 } from "../../functions/_shared/s1-urls";
import { resetS1ToolsGate } from "../../functions/_shared/s1-gate";
import { onRequestGet as bundleGet } from "../../functions/api/bundle/[gse]/[action]";
import { onRequestGet as cohortGet } from "../../functions/api/cohort/manifest";
import { onRequestGet as gseGet } from "../../functions/api/gse/[id]";
import { onRequestGet as gseList } from "../../functions/api/gse/index";
import { onRequestGet as ingestGet, onRequestPost as ingestTablePost } from "../../functions/api/ingest/[table]";
import { onRequestPost as ingestS1 } from "../../functions/api/ingest/s1-study";
import { onRequestGet as manifestGet } from "../../functions/api/manifest";
import { onRequestGet as searchGet } from "../../functions/api/search";
import { onRequestGet as sitemapGet } from "../../functions/sitemap.xml";
import { getCohort } from "../../functions/_shared/product";
import { recomputeMeta, refreshNext } from "../../functions/_shared/catalog-refresh";
import { indexOf, sample as bitSample } from "./helpers/bitindex-fixture";
import { createTestD1 } from "./helpers/d1-sqlite";
import { FakeHost } from "./helpers/zip";

const KEY = "sk_live_" + "b".repeat(32);
const TOKEN = "ingest-token";
const S2 = new Uint8Array(readFileSync("src/test/fixtures/s1/sample/GSM1000001.s1"));
const SAMPLE = JSON.parse(readFileSync("src/test/fixtures/s1/sample/GSM1000001.manifest.json", "utf8"));
const hex = (c: string, n: number) => c.repeat(n);
const sampleKey = (gsm: string) => `s1/s/${gsm}/${hex("a", 32)}.s1`;

const S1_TABLES = ["032_v2_catalog.sql", "033_v2_sample_rev_key.sql", "038_s1_catalog.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n");
const BASE =
  ["010_accounts.sql", "011_product.sql", "012_ai_budget.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n") +
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

const SCHEMA = S1_TABLES + BASE;

async function setup(schema = SCHEMA) {
  const db = createTestD1(schema);
  db.raw.prepare(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).run();
  db.raw.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_bbbb', ?1)`).run(await sha256Hex(KEY));
  return { DB: db, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), MCP_RATE_PER_MIN: "1000" };
}
type Env = Awaited<ReturnType<typeof setup>>;

/** The catalog rows of a study as the legacy pipeline left them (all of them stay after a retirement). */
function seedStudy(env: Env, gse: string, gsms: string[], opts: { legacyKey?: boolean; hasBundle?: number; qc?: boolean; manifest?: boolean } = {}) {
  const key = opts.legacyKey === false ? null : `data/${gse}/${gse}.singlet`;
  env.DB.raw
    .prepare(`INSERT INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, r2_bundle_key, r2_bundle_bytes, r2_bundle_n_gsms, last_updated) VALUES (?, ?, ?, ?, 600, ?, 5000, ?, '2026-10-01T00:00:00Z')`)
    .run(gse, `Blood atlas ${gse}`, gsms.length, gsms.length, key, gsms.length);
  env.DB.raw
    .prepare(
      `INSERT INTO gse_meta (gse_id, has_bundle, organism_primary, organisms, tissue_groups, disease_groups, assay_families, tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, year, n_usable_samples, n_lowqc_samples, reference_mismatch, n_usable_cells, n_lowqc_cells, updated_at)
       VALUES (?, ?, 'Homo sapiens', '["Homo sapiens"]', '["Blood"]', '["Healthy / control"]', '["10x 3"]', '[]', '[]', 0, ?, ?, 600, 2024, ?, 0, 0, 240, 0, '2026-10-01T00:00:00Z')`
    )
    .run(gse, opts.hasBundle ?? (key ? 1 : 0), gsms.length, gsms.length, gsms.length);
  if (opts.manifest !== false) {
    env.DB.raw
      .prepare(`INSERT INTO bundle_manifest (gse_id, bytes, n_gsms_in_bundle, reference_build, singlet_version, manifest_created_at) VALUES (?, 5000, ?, 'GRCh38-2024-A', '0.9.1', '2026-10-01T00:00:00Z')`)
      .run(gse, gsms.length);
  }
  for (const g of gsms) {
    env.DB.raw
      .prepare(`INSERT INTO gsm (gsm_id, gse_id, status, n_cells, organism, organism_primary, tissue_group, disease_group, assay_family) VALUES (?, ?, 'DONE', 300, 'Homo sapiens', 'Homo sapiens', 'Blood', 'Healthy / control', '10x 3')`)
      .run(g, gse);
    if (opts.qc !== false) {
      env.DB.raw
        .prepare(`INSERT INTO sample_qc (gsm_id, gse_id, n_cells_called, median_umi, median_genes, mapping_rate, usable, qc_tier, updated_at) VALUES (?, ?, 120, 290, 72, 0.9, 1, 0, '2026-10-01T00:00:00Z')`)
        .run(g, gse);
    }
  }
}

async function postS1(env: Env, gse: string, gsms: string[], migration: Record<string, unknown> | null) {
  const manifest = {
    format: "singlet-s1", manifest_version: 1, gse, rev: hex("1", 16), created_at: "2026-10-23T08:00:00Z", reference_build: "GRCh38-2024-A",
    pipeline: { singlet_version: "0.9.1" }, samples: gsms.map((g) => ({ ...SAMPLE, gsm: g, key: sampleKey(g) })), legacy: { key: `data/${gse}/${gse}.singlet`, etag: '"abc-3"', bytes: 5000 },
  };
  const request = new Request("https://singlet.bio/api/ingest/s1-study", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: JSON.stringify({ manifest, ...(migration ? { migration } : {}) }) });
  const res = await ingestS1({ request, env, params: {}, waitUntil: () => undefined } as never);
  expect(res.status, await res.clone().text()).toBe(200);
}

const RETIRED = "GSE1";
const RETIRED_GSMS = ["GSM1000001", "GSM1000002"];
const ALIVE = "GSE3"; // verified, legacy file still there
const LEGACY_ONLY = "GSE2";

async function world(): Promise<Env> {
  const env = await setup();
  seedStudy(env, RETIRED, RETIRED_GSMS);
  seedStudy(env, LEGACY_ONLY, ["GSM2000001"]);
  seedStudy(env, ALIVE, ["GSM3000001"]);
  await postS1(env, RETIRED, RETIRED_GSMS, { status: "retired", verify_ok: true });
  await postS1(env, ALIVE, ["GSM3000001"], { status: "verified", verify_ok: true });
  env.DB.raw.prepare("INSERT INTO bundle_index VALUES ('GSE2', 1, ?, '')").run(JSON.stringify([{ p: "samples/GSM2000001/exon_counts.1pz", n: 0, c: 100, u: 100, o: 50 }]));
  return env;
}

// ── a data host that has the sample objects and no legacy file ─────────────────────────────────────────────────────────────────────

let host: FakeHost;
let requested: string[];
beforeEach(() => {
  forgetKeyMemo();
  configureS1(undefined);
  resetS1ToolsGate();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  host = new FakeHost();
  requested = [];
  for (const g of [...RETIRED_GSMS, "GSM3000001"]) host.put(`https://data.singlet.bio/${sampleKey(g)}`, { bytes: S2, etag: '"s2"' });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requested.push(String(input instanceof Request ? input.url : input));
    return host.fetch(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setBitIndex(null);
});

const legacyRequests = (gse: string) => requested.filter((u) => u.includes(`/data/${gse}/`));

/** The text of a response must never name the retired study's legacy file. */
function expectNoLegacy(label: string, value: unknown, gse = RETIRED) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text, `${label} names the legacy file of ${gse}`).not.toMatch(new RegExp(`data/${gse}/${gse}\\.singlet|/data/${gse}/`));
  expect(text, `${label} names ${gse}.singlet`).not.toContain(`${gse}.singlet`);
}

const get = (handler: (c: never) => Promise<Response> | Response, env: Env, path: string, params: Record<string, string> = {}) =>
  handler({ request: new Request(`https://singlet.bio${path}`), env, params, waitUntil: () => undefined } as never);

function rpc(env: Env, name: string, args: Record<string, unknown> = {}) {
  const request = new Request("https://singlet.bio/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (async () => {
    const r = await mcpPost({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
    return ((await r.json()) as { result: { content: { text: string }[]; structuredContent?: any; isError?: boolean } }).result;
  })();
}

const MANIFEST = `https://data.singlet.bio/s1/m/${RETIRED}.json`;

describe("the legacy retirement switch (s1_flags.legacy_bundles, schema/038)", () => {
  const flip = (env: Env, value: "served" | "retired") => env.DB.raw.prepare(`UPDATE s1_flags SET value = ? WHERE name = 'legacy_bundles'`).run(value);
  const ALIVE_MANIFEST = `https://data.singlet.bio/s1/m/${ALIVE}.json`;

  it("'retired': every verified study stops naming its legacy file in the API and MCP; 'served' brings it back; an unmoved study is untouched", async () => {
    const env = await world();
    flip(env, "retired");
    const alive = (await (await get(gseGet, env, `/api/gse/${ALIVE}`, { id: ALIVE })).json()) as any;
    expectNoLegacy("gse detail", alive, ALIVE);
    expect(alive.series).toMatchObject({ bundle_url: null, bundle_key: null });
    expect(alive.series.s1).toMatchObject({ manifest_url: ALIVE_MANIFEST, legacy_available: false });
    const dl = await rpc(env, "get_download_url", { gse_id: ALIVE });
    expectNoLegacy("get_download_url", dl, ALIVE);
    expect(JSON.stringify(dl)).toContain(ALIVE_MANIFEST);
    const files = await rpc(env, "list_bundle_files", { gse_id: ALIVE });
    expectNoLegacy("list_bundle_files", files, ALIVE);
    // a study that was never moved keeps its file
    const old = (await (await get(gseGet, env, `/api/gse/${LEGACY_ONLY}`, { id: LEGACY_ONLY })).json()) as any;
    expect(old.series.bundle_url).toBe(`https://data.singlet.bio/data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`);
    // rollback: one UPDATE
    flip(env, "served");
    const back = (await (await get(gseGet, env, `/api/gse/${ALIVE}`, { id: ALIVE })).json()) as any;
    expect(back.series.bundle_url).toBe(`https://data.singlet.bio/data/${ALIVE}/${ALIVE}.singlet`);
    expect(legacyRequests(ALIVE)).toEqual([]); // nothing read the legacy file
  });

  it("the stored migration status is never changed by the switch", async () => {
    const env = await world();
    flip(env, "retired");
    await get(gseGet, env, `/api/gse/${ALIVE}`, { id: ALIVE });
    expect(env.DB.raw.prepare(`SELECT status FROM s1_migration WHERE gse_id = ?`).get(ALIVE)).toEqual({ status: "verified" });
  });
});

describe("REST: a retired study answers from s1", () => {
  it("/api/gse/:id has no legacy URL or key, the s1 block and the s1 size", async () => {
    const env = await world();
    const res = await get(gseGet, env, `/api/gse/${RETIRED}`, { id: RETIRED });
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expectNoLegacy("gse detail", j);
    expect(j.series).toMatchObject({ bundle_url: null, bundle_key: null, r2_bundle_key: null, bundle_bytes: 2 * SAMPLE.bytes, bundle_n_samples: 2 });
    expect(j.series.s1).toMatchObject({ format: "singlet-s1", manifest_url: MANIFEST, legacy_available: false, n_samples: 2 });
    expect(j.completeness).toBeDefined();
    // the study that is verified but not retired still has its single file; one never moved keeps the old shape
    const alive = (await (await get(gseGet, env, `/api/gse/${ALIVE}`, { id: ALIVE })).json()) as any;
    expect(alive.series.bundle_url).toBe(`https://data.singlet.bio/data/${ALIVE}/${ALIVE}.singlet`);
    expect(alive.series.s1.legacy_available).toBe(true);
    const old = (await (await get(gseGet, env, `/api/gse/${LEGACY_ONLY}`, { id: LEGACY_ONLY })).json()) as any;
    expect(old.series.bundle_url).toBe(`https://data.singlet.bio/data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`);
    expect(old.series.s1).toBeNull();
  });

  it("/api/search rows (studies and samples) carry the s1 block and no legacy key; the others keep theirs", async () => {
    const env = await world();
    const studies = (await (await get(searchGet, env, "/api/search?level=gse&limit=20")).json()) as any;
    const byId = new Map<string, any>(studies.data.map((r: any) => [r.gse_id, r]));
    expect(byId.get(RETIRED)).toMatchObject({ has_bundle: true, bundle_key: null, bundle_bytes: 2 * SAMPLE.bytes });
    expect(byId.get(RETIRED).s1).toMatchObject({ manifest_url: MANIFEST, legacy_available: false });
    expectNoLegacy("study search row", byId.get(RETIRED));
    expect(byId.get(ALIVE)).toMatchObject({ bundle_key: `data/${ALIVE}/${ALIVE}.singlet` });
    expect(byId.get(ALIVE).s1.legacy_available).toBe(true);
    expect(byId.get(LEGACY_ONLY)).toMatchObject({ bundle_key: `data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`, s1: null });

    const samples = (await (await get(searchGet, env, "/api/search?level=gsm&limit=50")).json()) as any;
    const mine = samples.data.filter((r: any) => r.gse_id === RETIRED);
    expect(mine).toHaveLength(2);
    for (const r of mine) {
      expect(r.has_bundle).toBe(true);
      expect(r.s1).toMatchObject({ manifest_url: MANIFEST, legacy_available: false });
    }
  });

  it("/api/gse lists it as having a file, without the legacy key", async () => {
    const env = await world();
    const j = (await (await get(gseList, env, "/api/gse?has_bundle=true&page_size=50")).json()) as any;
    const row = j.data.find((r: any) => r.id === RETIRED);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ r2_bundle_key: null, r2_bundle_bytes: 2 * SAMPLE.bytes });
    expect(row.s1).toMatchObject({ manifest_url: MANIFEST, legacy_available: false });
    expectNoLegacy("gse list row", row);
    expect(j.data.find((r: any) => r.id === LEGACY_ONLY).r2_bundle_key).toBe(`data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`);
  });

  it("/api/manifest points at the s1 manifest and its size", async () => {
    const env = await world();
    const q = "organism=Homo%20sapiens";
    const j = (await (await get(manifestGet, env, `/api/manifest?${q}&format=json`)).json()) as any;
    const rows = (Array.isArray(j) ? j : (j.studies ?? j.rows ?? j.data)) as any[];
    const row = rows.find((r) => r.gse_id === RETIRED);
    expect(row).toMatchObject({ gse_id: RETIRED, download_url: MANIFEST, format: "singlet-s1", bytes: 2 * SAMPLE.bytes, s1_manifest_url: MANIFEST });
    expectNoLegacy("manifest", j);
    const tsv = await (await get(manifestGet, env, `/api/manifest?${q}&format=tsv`)).text();
    expectNoLegacy("manifest tsv", tsv);
    const curl = await (await get(manifestGet, env, `/api/manifest?${q}&format=curl`)).text();
    expectNoLegacy("manifest curl", curl);
  });

  it("/api/bundle index and entry answer from the catalog, with no read of the legacy file", async () => {
    const env = await world();
    const idx = (await (await get(bundleGet, env, `/api/bundle/${RETIRED}/index`, { gse: RETIRED, action: "index" })).json()) as any;
    expect(idx).toMatchObject({ format: "singlet-s1", manifest_url: MANIFEST, n_samples: 2 });
    expectNoLegacy("bundle index", idx);
    const entry = (await (await get(bundleGet, env, `/api/bundle/${RETIRED}/entry?path=samples/GSM1000001/exon_counts.1pz`, { gse: RETIRED, action: "entry" })).json()) as any;
    expect(entry).toMatchObject({ format: "singlet-s1", method: "pz2" });
    expectNoLegacy("bundle entry", entry);
    // a forced refresh (the reindex workflow) does not go looking for the deleted file either
    const refreshed = await bundleGet({ request: new Request(`https://singlet.bio/api/bundle/${RETIRED}/index?refresh=1`, { headers: { "x-ingest-token": TOKEN } }), env, params: { gse: RETIRED, action: "index" }, waitUntil: () => undefined } as never);
    expect(refreshed.status).toBe(200);
    expect(legacyRequests(RETIRED)).toEqual([]);
  });

  it("/api/cohort/manifest plans from the catalog and names the manifest", async () => {
    const env = await world();
    setBitIndex(indexOf([bitSample(RETIRED, 1000001, { tissue_group: "Brain" }, 300), bitSample(RETIRED, 1000002, { tissue_group: "Brain" }, 300)]).index);
    const j = (await (await get(cohortGet, env, "/api/cohort/manifest?tissue_group=Brain")).json()) as any;
    const s = j.studies.find((x: any) => x.gse_id === RETIRED);
    expect(s).toMatchObject({ format: "singlet-s1", url: MANIFEST });
    expectNoLegacy("cohort manifest", j);
  });

  it("/sitemap.xml still lists the study page (a retired study keeps has_bundle)", async () => {
    const env = await world();
    const xml = await (await get(sitemapGet, env, "/sitemap.xml")).text();
    expect(xml).toContain(`/study/${RETIRED}`);
    expectNoLegacy("sitemap", xml);
  });

  it("a saved cohort's items carry the file URL that exists", async () => {
    const env = await world();
    const now = "2026-10-22T00:00:00Z";
    env.DB.raw.prepare(`INSERT INTO cohorts (id, owner_id, name, catalog_version, visibility, created_at, updated_at) VALUES ('c0000000-0000-4000-8000-000000000001', 'u1', 'x', 'v1', 'link', ?, ?)`).run(now, now);
    for (const [i, g] of [RETIRED, ALIVE, LEGACY_ONLY].entries()) {
      env.DB.raw.prepare(`INSERT INTO cohort_items (id, cohort_id, public_gse_id, position, created_at) VALUES (?, 'c0000000-0000-4000-8000-000000000001', ?, ?, ?)`).run(`i${i}`, g, i, now);
    }
    const out = (await getCohort({ db: env.DB, origin: "https://singlet.bio" } as never, "u1", { id: "c0000000-0000-4000-8000-000000000001" })) as any;
    const url = (g: string) => out.items.find((i: any) => i.public_gse_id === g).file_url;
    expect(url(RETIRED)).toBe(MANIFEST);
    expect(url(ALIVE)).toBe(`https://data.singlet.bio/data/${ALIVE}/${ALIVE}.singlet`);
    expect(url(LEGACY_ONLY)).toBe(`https://data.singlet.bio/data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`);
  });
});

describe("MCP: a retired study answers from s1", () => {
  it("get_study, get_download_url, list_bundle_files, get_modalities, get_sample_qc, assess_study, compare_studies", async () => {
    const env = await world();
    for (const [tool, args] of [
      ["get_study", { gse_id: RETIRED }],
      ["get_download_url", { gse_id: RETIRED }],
      ["list_bundle_files", { gse_id: RETIRED }],
      ["list_bundle_files", { gse_id: RETIRED, gsm_id: "GSM1000001" }],
      ["get_modalities", { gse_id: RETIRED }],
      ["get_sample_qc", { gse_id: RETIRED }],
      ["assess_study", { gse_id: RETIRED }],
      ["compare_studies", { gse_ids: [RETIRED, ALIVE] }],
    ] as [string, Record<string, unknown>][]) {
      const r = await rpc(env, tool, args);
      expect(r.isError, `${tool}: ${r.content[0].text}`).toBeUndefined();
      expectNoLegacy(`${tool} text`, r.content[0].text);
      expectNoLegacy(`${tool} data`, r.structuredContent);
    }
    const dl = (await rpc(env, "get_download_url", { gse_id: RETIRED })).structuredContent;
    expect(dl).toMatchObject({ format: "singlet-s1", manifest_url: MANIFEST, legacy: null });
    const study = (await rpc(env, "get_study", { gse_id: RETIRED })).structuredContent;
    expect(study).toMatchObject({ has_bundle: true, bundle_url: null, bundle_bytes: 2 * SAMPLE.bytes });
    expect(study.s1).toMatchObject({ legacy_available: false });
    expect(legacyRequests(RETIRED)).toEqual([]);
  });

  it("get_partial_download takes the member's range from the catalog", async () => {
    const env = await world();
    const r = await rpc(env, "get_partial_download", { gse_id: RETIRED, gsm_id: "GSM1000001", file: "summary.json" });
    expect(r.isError, r.content[0].text).toBeUndefined();
    expectNoLegacy("partial", r.structuredContent);
    expect(r.structuredContent.url).toBe(`https://data.singlet.bio/${sampleKey("GSM1000001")}`);
    expect(legacyRequests(RETIRED)).toEqual([]);
  });

  it("search_datasets names the manifest, not the legacy file", async () => {
    const env = await world();
    // the language reading needs the full vocabulary; the study search behind it is the real one
    nlSearch.mockImplementation(async () => {
      const { filters } = normalizeFilters(parseSearchParams(new URL("https://singlet.bio/api/search?level=gse&organism=Homo%20sapiens")), []);
      const res = await runStudySearch({ db: env.DB, rules: [], waitUntil: () => undefined } as never, filters);
      const applied = { organism: ["Homo sapiens"], tissue_group: [], disease_group: [], assay_family: [], cell_type: [], min_cells: null, year_min: null, year_max: null, q: "" };
      return { ok: true, body: { level: "gse", data: res.data, total: res.total, page: 1, limit: 10, applied, dropped: [], note: null, quota_exceeded: false, groups: undefined, suggestions: [], interpreted: {}, totals: res.totals, why: {} } };
    });
    const r = await rpc(env, "search_datasets", { query: "human blood studies" });
    expect(r.isError, r.content[0].text).toBeUndefined();
    const row = r.structuredContent.results.find((x: any) => x.gse_id === RETIRED);
    expect(row).toMatchObject({ has_bundle: true, bundle_url: null, format: "singlet-s1", manifest_url: MANIFEST });
    expectNoLegacy("search data", row);
    const alive = r.structuredContent.results.find((x: any) => x.gse_id === ALIVE);
    expect(alive).toMatchObject({ bundle_url: `https://data.singlet.bio/data/${ALIVE}/${ALIVE}.singlet`, format: "singlet-s1", manifest_url: `https://data.singlet.bio/s1/m/${ALIVE}.json` });
    const old = r.structuredContent.results.find((x: any) => x.gse_id === LEGACY_ONLY);
    expect(old).toMatchObject({ bundle_url: `https://data.singlet.bio/data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`, format: "singlet-v1", manifest_url: null });
  });

  it("find_matched_controls offers a retired study through its manifest and a live one through its file", async () => {
    const env = await world();
    seedStudy(env, "GSE9", ["GSM9000001"]); // the study to find controls for: same organism and tissue
    const r = await rpc(env, "find_matched_controls", { gse_id: "GSE9" });
    expect(r.isError, r.content[0].text).toBeUndefined();
    const byId = new Map<string, any>(r.structuredContent.candidates.map((c: any) => [c.gse_id, c]));
    expect(byId.get(RETIRED)).toMatchObject({ download_url: MANIFEST, format: "singlet-s1", bytes: 2 * SAMPLE.bytes });
    expect(byId.get(ALIVE).download_url).toBe(`https://data.singlet.bio/data/${ALIVE}/${ALIVE}.singlet`);
    expect(byId.get(LEGACY_ONLY)).toMatchObject({ download_url: `https://data.singlet.bio/data/${LEGACY_ONLY}/${LEGACY_ONLY}.singlet`, format: "singlet-v1" });
    expectNoLegacy("controls", byId.get(RETIRED));
  });

  it("export_manifest: json, tsv, curl, wget, python and R name no legacy file", async () => {
    const env = await world();
    for (const format of ["json", "tsv", "curl", "wget", "python", "r"]) {
      const r = await rpc(env, "export_manifest", { gse_ids: [RETIRED], format });
      expect(r.isError, `${format}: ${r.content[0].text}`).toBeUndefined();
      expectNoLegacy(`export ${format} text`, r.content[0].text);
      expectNoLegacy(`export ${format} data`, r.structuredContent);
    }
  });
});

describe("a study whose legacy file is gone keeps its summaries, usable flags and has_bundle", () => {
  it("get_sample_qc with no QC rows reads summary.json from the sample objects and stores the rows", async () => {
    const env = await setup();
    seedStudy(env, RETIRED, RETIRED_GSMS, { qc: false });
    await postS1(env, RETIRED, RETIRED_GSMS, { status: "retired", verify_ok: true });
    const r = await rpc(env, "get_sample_qc", { gse_id: RETIRED });
    expect(r.isError, r.content[0].text).toBeUndefined();
    const rows = r.structuredContent.samples as any[];
    expect(rows.map((s) => s.gsm_id)).toEqual(RETIRED_GSMS);
    expect(rows[0]).toMatchObject({ n_cells_called: 120, median_umi: 290.5, median_genes: 72, protocol: "10x 3' v3", reference_build: "FIXTURE-1" });
    expect(legacyRequests(RETIRED)).toEqual([]);
    // stored for next time, with the usable flag measured from the s1 matrices (exon + intron bytes > 400, cells called > 0)
    const stored = env.DB.raw.prepare("SELECT gsm_id, n_cells_called, matrix_bytes, usable FROM sample_qc WHERE gse_id = ? ORDER BY gsm_id").all(RETIRED) as any[];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ n_cells_called: 120, usable: 1, matrix_bytes: SAMPLE.members["exon_counts.1pz"].len + SAMPLE.members["intron_counts.1pz"].len });
  });

  it("index-next reads an s1-only study's summaries, parks nothing, and leaves a retired study's legacy rows alone", async () => {
    const env = await setup();
    // GSE5 never had a legacy file: no gse.r2_bundle_key, no bundle_manifest, no sample_qc
    seedStudy(env, "GSE5", ["GSM5000001"], { legacyKey: false, qc: false, manifest: false });
    await postS1(env, "GSE5", ["GSM5000001"], { status: "verified", verify_ok: true });
    // GSE1 is retired, has a bundle_manifest but its bundle_index and QC rows were never written: the legacy crank must not go for the deleted file
    seedStudy(env, RETIRED, RETIRED_GSMS, { qc: false });
    await postS1(env, RETIRED, RETIRED_GSMS, { status: "retired", verify_ok: true });
    host.put(`https://data.singlet.bio/${sampleKey("GSM5000001")}`, { bytes: S2, etag: '"s2"' });
    const call = (path: string) => ingestGet({ request: new Request(`https://singlet.bio/api/ingest/${path}`, { headers: { "x-ingest-token": TOKEN } }), env, params: { table: path.split("?")[0] }, waitUntil: () => undefined } as never);
    const res = await call("index-next?n=10");
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.failed).toEqual([]);
    expect([...j.indexed].sort()).toEqual(["GSE1", "GSE5"]);
    expect(j.remaining).toBe(0);
    expect(legacyRequests(RETIRED)).toEqual([]);
    expect(requested.filter((u) => /\/data\//.test(u))).toEqual([]);
    const qc = env.DB.raw.prepare("SELECT gse_id, COUNT(*) AS n, SUM(usable) AS u FROM sample_qc GROUP BY gse_id ORDER BY gse_id").all() as any[];
    expect(qc).toEqual([{ gse_id: "GSE1", n: 2, u: 2 }, { gse_id: "GSE5", n: 1, u: 1 }]);
  });

  it("the catalog crank never resolves an s1-only study to usable = 0, measures it from the catalog, and sets has_bundle", async () => {
    const env = await setup();
    seedStudy(env, "GSE5", ["GSM5000001", "GSM5000002"], { legacyKey: false, manifest: false, hasBundle: 0 });
    // QC rows posted by the pipeline without usable flags (what the HPC job writes)
    env.DB.raw.prepare("UPDATE sample_qc SET usable = NULL, qc_tier = NULL WHERE gse_id = 'GSE5'").run();
    env.DB.raw.prepare("UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = 'GSE5'").run();
    await postS1(env, "GSE5", ["GSM5000001", "GSM5000002"], { status: "verified", verify_ok: true });
    // the post of a served study with no legacy file queued its gse_meta row for a recompute (n_usable_samples back to NULL); now crank
    expect((env.DB.raw.prepare("SELECT n_usable_samples AS n FROM gse_meta WHERE gse_id = 'GSE5'").get() as any).n).toBeNull();
    for (let i = 0; i < 3; i++) await refreshNext(env.DB, 50);
    const qc = env.DB.raw.prepare("SELECT usable, qc_tier, matrix_bytes FROM sample_qc WHERE gse_id = 'GSE5'").all() as any[];
    expect(qc.every((r) => r.usable === 1 && r.matrix_bytes > 400)).toBe(true);
    const meta = env.DB.raw.prepare("SELECT has_bundle, n_usable_samples FROM gse_meta WHERE gse_id = 'GSE5'").get() as any;
    expect(meta).toMatchObject({ has_bundle: 1, n_usable_samples: 2 });
    expect(requested.filter((u) => /\/data\//.test(u))).toEqual([]);
  });

  it("recomputeMeta keeps has_bundle = 1 for a retired study and takes the reference mismatch from the s1 build when there is no bundle_manifest", async () => {
    const env = await setup();
    seedStudy(env, RETIRED, RETIRED_GSMS, { manifest: false });
    await postS1(env, RETIRED, RETIRED_GSMS, { status: "retired", verify_ok: true });
    env.DB.raw.prepare("UPDATE gse_meta SET has_bundle = 0 WHERE gse_id = ?").run(RETIRED);
    await recomputeMeta(env.DB, RETIRED, "2026-10-22T00:00:00Z");
    expect(env.DB.raw.prepare("SELECT has_bundle, reference_mismatch FROM gse_meta WHERE gse_id = ?").get(RETIRED)).toMatchObject({ has_bundle: 1, reference_mismatch: 0 });
    // a human study whose s1 manifest names a mouse reference is a mismatch even with no bundle_manifest row
    const mis = await setup();
    seedStudy(mis, RETIRED, RETIRED_GSMS, { manifest: false });
    await postS1(mis, RETIRED, RETIRED_GSMS, { status: "retired", verify_ok: true });
    mis.DB.raw.prepare("UPDATE s1_study SET reference_build = 'GRCm39-2024-A' WHERE gse_id = ?").run(RETIRED);
    await recomputeMeta(mis.DB, RETIRED, "2026-10-22T00:00:00Z");
    expect((mis.DB.raw.prepare("SELECT reference_mismatch FROM gse_meta WHERE gse_id = ?").get(RETIRED) as any).reference_mismatch).toBe(1);
  });

  it("a database without the s1 tables (before schema 032) is crank-able and computes has_bundle from the legacy key as before", async () => {
    const env = await setup(BASE);
    seedStudy(env, LEGACY_ONLY, ["GSM2000001"]);
    env.DB.raw.prepare("UPDATE gse_meta SET has_bundle = 0, n_usable_samples = NULL WHERE gse_id = ?").run(LEGACY_ONLY);
    await recomputeMeta(env.DB, LEGACY_ONLY, "2026-10-22T00:00:00Z");
    expect((env.DB.raw.prepare("SELECT has_bundle FROM gse_meta WHERE gse_id = ?").get(LEGACY_ONLY) as any).has_bundle).toBe(1);
    const out = await refreshNext(env.DB, 10);
    expect(out.errors).toEqual([]);
  });

  it("an s1-only study (no legacy key, no bundle_manifest) reports its build, pipeline, date and size from the s1 study, in the detail and in the manifest export", async () => {
    const env = await setup();
    seedStudy(env, "GSE5", ["GSM5000001"], { legacyKey: false, manifest: false });
    await postS1(env, "GSE5", ["GSM5000001"], { status: "retired", verify_ok: true });
    await recomputeMeta(env.DB, "GSE5", "2026-10-22T00:00:00Z");
    const detail = (await (await get(gseGet, env, "/api/gse/GSE5", { id: "GSE5" })).json()) as any;
    expect(detail.series).toMatchObject({ bundle_url: null, bundle_key: null, reference_build: "GRCh38-2024-A", singlet_version: "0.9.1", packed_at: "2026-10-23T08:00:00Z", bundle_n_samples: 1 });
    expect(detail.series.s1.legacy_available).toBe(false);
    const rows = (await (await get(manifestGet, env, "/api/manifest?organism=Homo%20sapiens&format=json")).json()) as any;
    const row = (Array.isArray(rows) ? rows : (rows.studies ?? rows.rows ?? rows.data)).find((r: any) => r.gse_id === "GSE5");
    expect(row).toMatchObject({ download_url: "https://data.singlet.bio/s1/m/GSE5.json", n_samples_in_file: 1, reference_build: "GRCh38-2024-A", bytes: SAMPLE.bytes });
    expectNoLegacy("s1-only detail", detail, "GSE5");
  });

  it("/api/gse?has_bundle=true includes an s1-only study and has_bundle=false leaves it out", async () => {
    const env = await setup();
    seedStudy(env, "GSE5", ["GSM5000001"], { legacyKey: false, manifest: false });
    await postS1(env, "GSE5", ["GSM5000001"], { status: "verified", verify_ok: true });
    const ids = async (q: string) => (((await (await get(gseList, env, `/api/gse?${q}&page_size=50`)).json()) as any).data as any[]).map((r) => r.id);
    expect(await ids("has_bundle=true")).toContain("GSE5");
    expect(await ids("has_bundle=false")).not.toContain("GSE5");
  });

  it("a retired study's rows and an s1-only study's rows are counted in the layer statistics", async () => {
    const env = await setup();
    seedStudy(env, "GSE5", ["GSM5000001"], { legacyKey: false, manifest: false });
    await postS1(env, "GSE5", ["GSM5000001"], { status: "verified", verify_ok: true });
    await recomputeMeta(env.DB, "GSE5", "2026-10-22T00:00:00Z"); // what the crank does for it: has_bundle from the s1 tables
    const { computeLayerStats } = await import("../../functions/_shared/layers-core");
    const stats = await computeLayerStats(env.DB);
    expect(stats.studies).toBe(1);
    expect(stats.layers.find((l) => l.key === "gene_counts")).toMatchObject({ studies: 1, of: 1 });
    expect(stats.layers.find((l) => l.key === "splicing")).toMatchObject({ studies: 1 });
    expect(stats.layers.find((l) => l.key === "vdj")).toMatchObject({ studies: 0 });
  });

  it("index-bundle on a retired study reads the sample objects, not the deleted file", async () => {
    const env = await setup();
    seedStudy(env, RETIRED, RETIRED_GSMS, { qc: false });
    await postS1(env, RETIRED, RETIRED_GSMS, { status: "retired", verify_ok: true });
    const res = await ingestTablePost({
      request: new Request(`https://singlet.bio/api/ingest/index-bundle?gse=${RETIRED}`, { method: "POST", headers: { "x-ingest-token": TOKEN } }),
      env,
      params: { table: "index-bundle" },
      waitUntil: () => undefined,
    } as never);
    const j = (await res.json()) as any;
    expect(j.results[0]).toMatchObject({ gse_id: RETIRED, ok: true, source: "s1", samples_qc: 2 });
    expect(legacyRequests(RETIRED)).toEqual([]);
  });
});
