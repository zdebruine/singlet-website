// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildManifestFromIds } from "../../functions/_shared/manifest-core";
import { loadStudy } from "../../functions/_shared/study-core";
import { configureS1 } from "../../functions/_shared/s1-urls";
import { onRequestGet as bundleGet } from "../../functions/api/bundle/[gse]/[action]";
import { onRequestGet as cohortGet } from "../../functions/api/cohort/manifest";
import { onRequestPost as ingestPost } from "../../functions/api/ingest/s1-study";
import { sha256Hex } from "../../functions/_shared/hash";
import { setBitIndex } from "../../functions/_shared/cohort-index";
import { indexOf, sample as bitSample } from "./helpers/bitindex-fixture";
import { createTestD1 } from "./helpers/d1-sqlite";

const TOKEN = "t";
const SAMPLE = JSON.parse(readFileSync("src/test/fixtures/s1/sample/GSM1000001.manifest.json", "utf8"));
const hex = (c: string, n: number) => c.repeat(n);
const SCHEMA = readFileSync("schema/032_v2_catalog.sql", "utf8") + readFileSync("schema/033_v2_sample_rev_key.sql", "utf8") + readFileSync("schema/038_s1_catalog.sql", "utf8") + readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, "") + `
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT, assay_families TEXT,
  tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER, n_cells INTEGER, year INTEGER, n_usable_samples INTEGER, n_lowqc_samples INTEGER,
  reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_cells INTEGER);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_files INTEGER, n_gsms_in_bundle INTEGER, manifest_n_gsms INTEGER, gsm_ids TEXT, manifest_created_at TEXT,
  audited_at TEXT, reference_build TEXT, singlet_version TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, usable INTEGER, qc_tier INTEGER, median_genes REAL, mapping_rate REAL, n_cells_called INTEGER);
ALTER TABLE gse ADD COLUMN r2_bundle_n_gsms INTEGER;
ALTER TABLE gsm ADD COLUMN organism_primary TEXT;
ALTER TABLE gsm ADD COLUMN tissue_group TEXT;
ALTER TABLE gsm ADD COLUMN disease_group TEXT;
ALTER TABLE gsm ADD COLUMN assay_family TEXT;
`;

async function setup() {
  return { DB: createTestD1(SCHEMA), INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function ingest(env: Env, gse: string, gsms: string[], migration: Record<string, unknown> | null, over: Record<string, unknown> = {}, final = true) {
  const manifest = {
    format: "singlet-s1", manifest_version: 1, gse, rev: hex("1", 16), created_at: "2026-10-23T08:00:00Z", reference_build: "GRCh38-2024-A",
    pipeline: { singlet_version: "0.9.1" }, samples: gsms.map((g) => ({ ...SAMPLE, gsm: g, key: `s1/s/${g}/${hex("a", 32)}.s1` })), legacy: { bytes: 5000 }, ...over,
  };
  const request = new Request("https://singlet.bio/api/ingest/s1-study", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: JSON.stringify({ manifest, manifest_bytes: 4321, final, ...(migration ? { migration } : {}) }) });
  const res = await ingestPost({ request, env, params: {}, waitUntil: () => undefined } as never);
  expect(res.status, await res.clone().text()).toBe(200);
}

function seed(env: Env, gse: string, bytes: number) {
  env.DB.raw.prepare(`INSERT INTO gse (id, title, n_gsm_total, n_gsm_done, n_cells, r2_bundle_key, r2_bundle_bytes) VALUES (?, ?, 1, 1, 100, ?, ?)`).run(gse, `Study ${gse}`, `data/${gse}/${gse}.singlet`, bytes);
  env.DB.raw.prepare(`INSERT INTO gse_meta (gse_id, has_bundle, organism_primary, tissue_groups, disease_groups, assay_families, n_cells, n_usable_samples) VALUES (?, 1, 'Homo sapiens', '["Blood"]', '[]', '[]', 100, 1)`).run(gse);
  env.DB.raw.prepare(`INSERT INTO bundle_manifest (gse_id, bytes, n_gsms_in_bundle, reference_build) VALUES (?, ?, 1, 'GRCh38-2024-A')`).run(gse, bytes);
}

beforeEach(() => {
  configureS1(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function bundle(env: Env, gse: string, action: string, query = "") {
  const request = new Request(`https://singlet.bio/api/bundle/${gse}/${action}${query}`);
  return bundleGet({ request, env, params: { gse, action }, waitUntil: () => undefined } as never);
}

describe("/api/bundle/:gse/index and /entry for an s1 study", () => {
  it("lists the samples and their members in the shape the page already reads", async () => {
    const env = await setup();
    await ingest(env, "GSE1", ["GSM1000001", "GSM1000002"], { status: "verified", verify_ok: true });
    const res = await bundle(env, "GSE1", "index");
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j).toMatchObject({ gse_id: "GSE1", format: "singlet-s1", rev: hex("1", 16), manifest_url: "https://data.singlet.bio/s1/m/GSE1.json", n_samples: 2, reference_build: "GRCh38-2024-A", singlet_version: "0.9.1", bytes: 2 * SAMPLE.bytes, files_truncated: false });
    expect(j.samples.map((s: any) => s.gsm_id)).toEqual(["GSM1000001", "GSM1000002"]);
    const paths = j.samples[0].files.map((f: any) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["samples/GSM1000001/exon_counts.1pz", "samples/GSM1000001/cells", "samples/GSM1000001/summary.json"]));
    const summary = j.samples[0].files.find((f: any) => f.path.endsWith("summary.json"));
    expect(summary).toMatchObject({ bytes_compressed: 173, bytes_uncompressed: 237 });
    expect(j.samples[0].total_bytes).toBe(SAMPLE.bytes);
    expect(j.study_files).toEqual([{ path: "s1/m/GSE1.json", bytes_compressed: 4321, bytes_uncompressed: 4321 }]);
  });

  it("lists the files of the first 100 samples only, and says so", async () => {
    const env = await setup();
    const gsms = Array.from({ length: 120 }, (_, i) => `GSM2${String(i).padStart(5, "0")}`);
    for (let i = 0; i < gsms.length; i += 60) {
      const last = i + 60 >= gsms.length;
      await ingest(env, "GSE1", gsms.slice(i, i + 60), last ? { status: "verified", verify_ok: true } : null, { n_samples: 120, bytes: 120 * SAMPLE.bytes, rev: hex("1", 16) }, last);
    }
    const j = (await (await bundle(env, "GSE1", "index")).json()) as any;
    expect(j.n_samples).toBe(120);
    expect(j.samples).toHaveLength(120);
    expect(j.samples.filter((s: any) => s.files.length).length).toBe(100);
    expect(j.files_truncated).toBe(true);
  });

  it("answers an entry with where its bytes are, and never inflates anything", async () => {
    const env = await setup();
    await ingest(env, "GSE1", ["GSM1000001"], { status: "verified", verify_ok: true });
    const get = async (path: string) => bundle(env, "GSE1", "entry", `?path=${encodeURIComponent(path)}`);
    const mat = (await (await get("samples/GSM1000001/exon_counts.1pz")).json()) as any;
    expect(mat).toMatchObject({ format: "singlet-s1", method: "pz2", url: `https://data.singlet.bio/s1/s/GSM1000001/${hex("a", 32)}.s1`, bytes_compressed: SAMPLE.members["exon_counts.1pz"].len });
    expect(mat.range).toBe(`bytes=${SAMPLE.members["exon_counts.1pz"].off}-${SAMPLE.members["exon_counts.1pz"].off + SAMPLE.members["exon_counts.1pz"].len - 1}`);
    const stored = (await (await get("samples/GSM1000001/summary.json")).json()) as any;
    expect(stored).toMatchObject({ method: "zstd", bytes_uncompressed: 237 });
    const derived = (await (await get("samples/GSM1000001/cell_qc_metrics.tsv")).json()) as any;
    expect(derived).toMatchObject({ method: "derived", range: null });
    expect(derived.note).toMatch(/regenerated/);
    expect((await get("samples/GSM1000001/nope.tsv")).status).toBe(404);
    expect((await get("samples/GSM9/exon_counts.1pz")).status).toBe(404);
    const study = await get("manifest.json");
    expect(study.status).toBe(404);
    expect(((await study.json()) as any).error).toMatch(/inside the s1 manifest/);
    expect((await get("samples/GSM1000001/donor/snp_ad.tsv")).status).toBe(404);
  });

  it("leaves a legacy study to the legacy code (no s1 row, so the bundle is read)", async () => {
    const env = await setup();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 404 }));
    const res = await bundle(env, "GSE5", "index");
    expect(res.status).toBe(502); // the legacy path ran and could not reach the bundle
    vi.unstubAllGlobals();
  });
});

describe("study detail and download manifests", () => {
  it("carry the s1 block, and drop the legacy URL once the legacy file is retired", async () => {
    const env = await setup();
    seed(env, "GSE1", 5000);
    seed(env, "GSE2", 7000);
    seed(env, "GSE3", 9000);
    await ingest(env, "GSE1", ["GSM1000001"], { status: "verified", verify_ok: true });
    await ingest(env, "GSE2", ["GSM1000002"], { status: "retired", verify_ok: true });

    const s1 = await loadStudy(env.DB, "GSE1");
    expect(s1!.series.v2).toBe(s1!.series.s1); // DUAL: the old key is the same object
    expect(s1!.series.s1).toMatchObject({ format: "singlet-s1", rev: hex("1", 16), manifest_url: "https://data.singlet.bio/s1/m/GSE1.json", n_samples: 1, legacy_available: true });
    expect(s1!.series.bundle_url).toBe("https://data.singlet.bio/data/GSE1/GSE1.singlet");
    const s2 = await loadStudy(env.DB, "GSE2");
    expect(s2!.series.s1).toMatchObject({ legacy_available: false });
    expect(s2!.series.bundle_url).toBeNull();
    const s3 = await loadStudy(env.DB, "GSE3");
    expect(s3!.series.s1).toBeNull();
    expect(s3!.series.bundle_url).toBe("https://data.singlet.bio/data/GSE3/GSE3.singlet");

    const m = await buildManifestFromIds(env.DB, ["GSE1", "GSE2", "GSE3"], "json");
    const byId = new Map(m.rows.map((r) => [r.gse_id, r]));
    expect(byId.get("GSE1")).toMatchObject({ format: "singlet-s1", s1_rev: hex("1", 16), s1_manifest_url: "https://data.singlet.bio/s1/m/GSE1.json", s1_bytes: SAMPLE.bytes, download_url: "https://data.singlet.bio/data/GSE1/GSE1.singlet", bytes: 5000 });
    expect(byId.get("GSE2")).toMatchObject({ format: "singlet-s1", download_url: "https://data.singlet.bio/s1/m/GSE2.json", bytes: SAMPLE.bytes });
    expect(byId.get("GSE3")).toMatchObject({ format: "singlet-v1", s1_manifest_url: null, s1_rev: null, download_url: "https://data.singlet.bio/data/GSE3/GSE3.singlet", bytes: 9000 });
    expect(m.total_bytes).toBe(5000 + SAMPLE.bytes + 9000);

    const curl = (await buildManifestFromIds(env.DB, ["GSE1", "GSE2", "GSE3"], "curl")).body;
    expect(curl).toContain('-o "GSE1.singlet" "https://data.singlet.bio/data/GSE1/GSE1.singlet"');
    expect(curl).toContain('-o "GSE2.manifest.json" "https://data.singlet.bio/s1/m/GSE2.json"  # one object per sample, listed in this manifest');
    expect(curl).toContain('-o "GSE3.singlet"');
    const tsv = (await buildManifestFromIds(env.DB, ["GSE1", "GSE3"], "tsv")).body.split("\n");
    expect(tsv[0].split("\t").slice(-5)).toEqual(["format", "s1_manifest_url", "s1_rev", "v2_manifest_url", "v2_rev"]);
    expect(tsv[1].split("\t").slice(-5)).toEqual(["singlet-s1", "https://data.singlet.bio/s1/m/GSE1.json", hex("1", 16), "https://data.singlet.bio/s1/m/GSE1.json", hex("1", 16)]);
    expect(tsv[2].split("\t").slice(-5)).toEqual(["singlet-v1", "", "", "", ""]);
  });

  it("uses the configured origin everywhere a URL is built", async () => {
    const env = await setup();
    seed(env, "GSE1", 5000);
    await ingest(env, "GSE1", ["GSM1000001"], { status: "retired", verify_ok: true });
    configureS1({ S1_ORIGIN: "https://dv2.singlet.bio" });
    const s = await loadStudy(env.DB, "GSE1");
    expect(s!.series.s1!.manifest_url).toBe("https://dv2.singlet.bio/s1/m/GSE1.json");
    const m = await buildManifestFromIds(env.DB, ["GSE1"], "json");
    expect(m.rows[0].download_url).toBe("https://dv2.singlet.bio/s1/m/GSE1.json");
  });
});

describe("/api/cohort/manifest for per-sample studies", () => {
  const { index } = indexOf([
    bitSample("GSE1", 1000001, { tissue_group: "Brain" }, 300),
    bitSample("GSE1", 1000002, { tissue_group: "Brain" }, 300),
    bitSample("GSE2", 7, { tissue_group: "Brain" }, 500),
  ]);
  beforeEach(() => setBitIndex(index));
  afterEach(() => setBitIndex(null));

  async function call(env: Env, path: string) {
    return cohortGet({ request: new Request(`https://singlet.bio${path}`), env, waitUntil: () => undefined } as never);
  }

  it("plans a migrated study from the catalog and an un-migrated one from the legacy index", async () => {
    const env = await setup();
    env.DB.raw.exec("CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT)");
    env.DB.raw.prepare("INSERT INTO bundle_index VALUES ('GSE2', 1, ?, '')").run(JSON.stringify([{ p: "samples/GSM7/exon_counts.1pz", n: 0, c: 100, u: 100, o: 50 }]));
    await ingest(env, "GSE1", ["GSM1000001", "GSM1000002"], { status: "verified", verify_ok: true });
    const res = await call(env, "/api/cohort/manifest?tissue_group=Brain");
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    const g1 = j.studies.find((s: any) => s.gse_id === "GSE1");
    expect(g1).toMatchObject({ format: "singlet-s1", rev: hex("1", 16), url: "https://data.singlet.bio/s1/m/GSE1.json", indexed: true });
    expect(g1.samples).toHaveLength(2);
    const s = g1.samples[0];
    expect(s.object).toEqual({ url: `https://data.singlet.bio/s1/s/GSM1000001/${hex("a", 32)}.s1`, bytes: SAMPLE.bytes });
    expect(s.files.map((f: any) => f.name)).toEqual(["exon_counts.1pz", "intron_counts.1pz"]);
    const exon = s.files[0];
    expect(exon).toMatchObject({ format: "singlet-s1", kind: 1, chunk_cols: 64, n_chunks: 5, columns: 300 });
    expect(exon.range).toBe(`bytes=${SAMPLE.members["exon_counts.1pz"].off}-${SAMPLE.members["exon_counts.1pz"].off + SAMPLE.members["exon_counts.1pz"].len - 1}`);
    expect(exon.chunk_index).toEqual({ range: `bytes=${SAMPLE.members["exon_counts.1pz"].chunk_index[0]}-${SAMPLE.members["exon_counts.1pz"].chunk_index[0] + 143}`, bytes: 144 });
    // the legacy study is untouched
    const g2 = j.studies.find((s: any) => s.gse_id === "GSE2");
    expect(g2.format).toBeUndefined();
    expect(g2.samples[0].files[0]).toMatchObject({ path: "samples/GSM7/exon_counts.1pz", method: "stored", local_header_offset: 50 });
    expect(j.notes.join(" ")).toMatch(/singlet-s1/);
  });

  it("downsamples sample with the same deterministic column lists", async () => {
    const env = await setup();
    await ingest(env, "GSE1", ["GSM1000001", "GSM1000002"], { status: "verified", verify_ok: true });
    const a = (await (await call(env, "/api/cohort/manifest?tissue_group=Brain&max_cells=300&seed=5&min_cells_per_sample=10")).json()) as any;
    const b = (await (await call(env, "/api/cohort/manifest?tissue_group=Brain&max_cells=300&seed=5&min_cells_per_sample=10")).json()) as any;
    expect(a.studies).toEqual(b.studies);
    const s = a.studies.find((x: any) => x.gse_id === "GSE1").samples[0];
    expect(s.keep_cells).toBeLessThan(300);
    expect(s.keep_runs.reduce((n: number, v: number, i: number) => (i % 2 ? n + v : n), 0)).toBe(s.keep_cells);
  });

  it("does not use an s1 study that is still being migrated", async () => {
    const env = await setup();
    env.DB.raw.exec("CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT)");
    await ingest(env, "GSE1", ["GSM1000001", "GSM1000002"], { status: "running" });
    const j = (await (await call(env, "/api/cohort/manifest?tissue_group=Brain")).json()) as any;
    expect(j.studies.find((s: any) => s.gse_id === "GSE1").format).toBeUndefined();
  });
});
