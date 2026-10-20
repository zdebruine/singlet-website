// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBitIndex } from "../../functions/_shared/bitindex-build";
import { ATTRS } from "../../functions/_shared/cohort-schema";
import { sha256Hex } from "../../functions/_shared/hash";
import { onRequestGet as exportGet } from "../../functions/api/ingest/export";
import { onRequestPost as publishPost } from "../../functions/api/ingest/search-index";
import { createTestD1 } from "./helpers/d1-sqlite";
import { sample } from "./helpers/bitindex-fixture";

const TOKEN = "test-ingest-token";
const SCHEMA = `
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, status TEXT, organism_primary TEXT, tissue_group TEXT, tissue TEXT,
  disease_group TEXT, disease TEXT, sex TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, n_cells_called INTEGER, protocol TEXT, singlet_version TEXT, qc_tier INTEGER, usable INTEGER);
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, n_usable_samples INTEGER, reference_mismatch INTEGER, year INTEGER);
CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, entries TEXT);
${readFileSync("schema/030_search_facts.sql", "utf8")}`;

async function seed() {
  const DB = createTestD1(SCHEMA);
  const raw = DB.raw;
  raw.exec(`
    INSERT INTO gse_meta VALUES ('GSE1', 1, 2, 0, 2021), ('GSE2', 0, 0, 0, 2022);
    INSERT INTO bundle_index VALUES ('GSE1', 'a/exon_counts.1pz a/intron_counts.1pz a/sex_call.json'), ('GSE2', 'x');
    INSERT INTO gsm VALUES
      ('GSM1', 'GSE1', 'DONE', 'Homo sapiens', 'Brain', 'cortex', NULL, NULL, 'Female'),
      ('GSM2', 'GSE1', 'DONE', 'Homo sapiens', 'Brain', NULL, NULL, NULL, 'unknown'),
      ('GSM3', 'GSE2', 'DONE', 'Mus musculus', NULL, NULL, NULL, NULL, NULL),
      ('GSM4', 'GSE2', 'FAILED', 'Mus musculus', NULL, NULL, NULL, NULL, NULL);
    INSERT INTO sample_qc VALUES ('GSM1', 900, '10x 3 v3', 'v2', 0, 1), ('GSM2', 50, '10x 3 v3', 'v2', 1, 0);`);
  const attr = raw.prepare(
    "INSERT INTO sample_attr (gsm_id, gse_id, attr, value_norm, value_num, unit, source, confidence, extractor_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'v1')"
  );
  attr.run("GSM1", "GSE1", "age", "30 years", 30, "years", "geo", null);
  attr.run("GSM1", "GSE1", "tissue", "cortex", null, null, "model", 0.9);
  attr.run("GSM2", "GSE1", "sex", "male", null, null, "geo", null);
  attr.run("GSM2", "GSE1", "cell_type", "neuron", null, null, "model", 0.9); // not an indexed attribute
  attr.run("GSM3", "GSE2", "sex", "female", null, null, "geo", null);
  attr.run("GSM4", "GSE2", "sex", "female", null, null, "geo", null); // sample not DONE
  return { DB, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) };
}

async function get(env: Awaited<ReturnType<typeof seed>>, qs: string, token: string | null = TOKEN) {
  const request = new Request(`https://singlet.bio/api/ingest/export?${qs}`, { headers: token ? { "x-ingest-token": token } : {} });
  return exportGet({ request, env, params: {} } as never);
}

describe("GET /api/ingest/export", () => {
  it("needs the token", async () => {
    const env = await seed();
    expect((await get(env, "table=samples", null)).status).toBe(401);
    expect((await get(env, "table=samples", "wrong")).status).toBe(401);
  });

  it("rejects an unknown table, a bad limit and a bad cursor", async () => {
    const env = await seed();
    expect((await get(env, "table=gsm")).status).toBe(400);
    expect((await get(env, "table=samples&limit=0")).status).toBe(400);
    expect((await get(env, "table=samples&limit=5001")).status).toBe(400);
    expect((await get(env, "table=samples&limit=x")).status).toBe(400);
    expect((await get(env, "table=samples&after=GSM1'%20OR%201=1")).status).toBe(400);
  });

  it("pages samples with the flat columns the builder reads", async () => {
    const env = await seed();
    const p1 = await (await get(env, "table=samples&limit=2")).json<{ columns: string[]; rows: unknown[][]; next: string | null }>();
    expect(p1.next).toBe("GSM2");
    const row = (r: unknown[]) => Object.fromEntries(p1.columns.map((c, i) => [c, r[i]]));
    expect(row(p1.rows[0])).toMatchObject({ gsm_id: "GSM1", gse_id: "GSE1", n_cells: 900, organism: "Homo sapiens", sex: "female", qc_tier: "0", usable: "1", downloadable: "1", year: 2021 });
    expect(row(p1.rows[1])).toMatchObject({ gsm_id: "GSM2", sex: null, qc_tier: "1", usable: null, downloadable: "1" });
    const p2 = await (await get(env, `table=samples&limit=2&after=${p1.next}`)).json<{ rows: unknown[][]; next: string | null }>();
    expect(p2.rows.map((r) => r[0])).toEqual(["GSM3"]); // GSM4 is not DONE
    expect(p2.next).toBeNull();
    expect(row(p2.rows[0])).toMatchObject({ n_cells: 0, usable: null, downloadable: null, qc_tier: null });
  });

  it("gives each study's file layers", async () => {
    const env = await seed();
    const p = await (await get(env, "table=studies")).json<{ rows: unknown[][]; next: string | null }>();
    expect(p.rows).toEqual([["GSE1", "gene_counts|splicing|sex"], ["GSE2", ""]]);
    expect(p.next).toBeNull();
  });

  it("pages sample_attr on sample boundaries and leaves out unindexed attributes and samples not done", async () => {
    const env = await seed();
    // Four indexed rows in all; with limit 3 the first page ends inside GSM2, so it stops after GSM1.
    const p1 = await (await get(env, "table=sample_attr&limit=3")).json<{ rows: unknown[][]; next: string | null }>();
    expect(p1.rows.map((r) => `${r[0]}:${r[1]}`)).toEqual(["GSM1:age", "GSM1:tissue"]);
    expect(p1.next).toBe("GSM1");
    const p2 = await (await get(env, `table=sample_attr&limit=3&after=${p1.next}`)).json<{ rows: unknown[][]; next: string | null }>();
    expect(p2.rows.map((r) => `${r[0]}:${r[1]}`)).toEqual(["GSM2:sex", "GSM3:sex"]);
    expect(p2.next).toBeNull();
  });

  it("builds the same index from the export as from rows directly", async () => {
    const env = await seed();
    const p = await (await get(env, "table=samples")).json<{ columns: string[]; rows: unknown[][] }>();
    const rows = p.rows.map((r) => {
      const o = Object.fromEntries(p.columns.map((c, i) => [c, r[i]]));
      const facts: Record<string, string | number> = {};
      for (const a of ATTRS) if (o[a.key] != null && o[a.key] !== "") facts[a.key] = o[a.key] as string | number;
      return { gsm: String(o.gsm_id), gse: String(o.gse_id), cells: Number(o.n_cells), facts };
    });
    expect(buildBitIndex(rows, ATTRS, { builtAt: "2026-10-20T00:00:00Z" }).dict.n_samples).toBe(3);
  });
});

// ── POST /api/ingest/search-index ────────────────────────────────────────────

class FakeR2 {
  objects = new Map<string, { body: Uint8Array; meta?: Record<string, string> }>();
  async put(key: string, value: ArrayBuffer | string, opts?: { customMetadata?: Record<string, string> }) {
    const body = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value.slice(0));
    this.objects.set(key, { body, meta: opts?.customMetadata });
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.byteLength, customMetadata: o.meta } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { text: async () => new TextDecoder().decode(o.body) } : null;
  }
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
}

function built(n: number, day: string) {
  const rows = Array.from({ length: n }, (_, i) => sample(`GSE${1 + Math.floor(i / 3)}`, i + 1, { tissue_group: i % 2 ? "Brain" : "Blood" }));
  const { bin, dict } = buildBitIndex(rows, ATTRS, { builtAt: `${day}T00:00:00Z` });
  return { bin, dict, text: JSON.stringify(dict) };
}

async function publish(bucket: FakeR2, query: string, body: BodyInit | null, token: string | null = TOKEN) {
  const env = { SINGLET_DATA: bucket as unknown as R2Bucket, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) };
  const request = new Request(`https://singlet.bio/api/ingest/search-index?${query}`, {
    method: "POST",
    headers: token ? { "x-ingest-token": token } : {},
    body,
  });
  return publishPost({ request, env, params: {} } as never);
}

const put = (b: FakeR2, x: ReturnType<typeof built>) => publish(b, `part=bin&name=${x.dict.bin}`, x.bin);

describe("POST /api/ingest/search-index", () => {
  it("needs the token and a bound bucket", async () => {
    const b = new FakeR2();
    const x = built(6, "2026-10-01");
    expect((await publish(b, `part=bin&name=${x.dict.bin}`, x.bin, null)).status).toBe(401);
    expect((await publish(b, "part=dict", x.text, "wrong")).status).toBe(401);
    const request = new Request("https://singlet.bio/api/ingest/search-index?part=dict", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: x.text });
    expect((await publishPost({ request, env: { INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) }, params: {} } as never)).status).toBe(503);
    expect(b.objects.size).toBe(0);
  });

  it("stores a binary and then the dictionary under search-index/v1/", async () => {
    const b = new FakeR2();
    const x = built(6, "2026-10-01");
    expect((await put(b, x)).status).toBe(200);
    const res = await publish(b, "part=dict", x.text);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, index_version: x.dict.index_version, n_samples: 6, previous: null, deleted: 0 });
    expect([...b.objects.keys()].sort()).toEqual([`search-index/v1/${x.dict.bin}`, "search-index/v1/index.json"]);
  });

  it("refuses a binary that is not an index, is corrupt or is misnamed", async () => {
    const b = new FakeR2();
    const x = built(6, "2026-10-01");
    expect((await publish(b, "part=bin&name=../index.json", x.bin)).status).toBe(400);
    expect((await publish(b, `part=bin&name=${x.dict.bin}`, new Uint8Array(100))).status).toBe(400);
    expect((await publish(b, `part=bin&name=${x.dict.bin}`, x.bin.slice(0, x.bin.length - 4))).status).toBe(400);
    const flipped = x.bin.slice();
    flipped[flipped.length - 1] ^= 0xff;
    expect((await publish(b, `part=bin&name=${x.dict.bin}`, flipped)).status).toBe(400);
    expect((await publish(b, `part=bin&name=index.20261001-00000000.sbix`, x.bin)).status).toBe(400);
    expect(b.objects.size).toBe(0);
  });

  it("refuses a dictionary whose binary is missing, mismatched or whose JSON is wrong", async () => {
    const b = new FakeR2();
    const x = built(6, "2026-10-01");
    expect((await publish(b, "part=dict", x.text)).status).toBe(409);
    await put(b, x);
    expect((await publish(b, "part=dict", JSON.stringify({ ...x.dict, n_samples: 7 }))).status).toBe(409);
    expect((await publish(b, "part=dict", JSON.stringify({ ...x.dict, index_version: "20261001-deadbeef" }))).status).toBe(400);
    expect((await publish(b, "part=dict", "not json")).status).toBe(400);
    expect((await publish(b, "part=dict", JSON.stringify({ ...x.dict, format: 2 }))).status).toBe(400);
    expect((await publish(b, "part=other", "")).status).toBe(400);
    expect(b.objects.has("search-index/v1/index.json")).toBe(false);
  });

  it("keeps the previous dictionary and binary and deletes older binaries", async () => {
    const b = new FakeR2();
    const v1 = built(6, "2026-10-01");
    const v2 = built(9, "2026-10-02");
    const v3 = built(12, "2026-10-03");
    for (const v of [v1, v2]) {
      await put(b, v);
      expect((await publish(b, "part=dict", v.text)).status).toBe(200);
    }
    expect(await (await b.get("search-index/v1/previous.index.json"))!.text()).toBe(v1.text);
    expect(b.objects.has(`search-index/v1/${v1.dict.bin}`)).toBe(true);
    await put(b, v3);
    const res = await publish(b, "part=dict", v3.text);
    expect(await res.json()).toMatchObject({ previous: v2.dict.bin, deleted: 1 });
    expect(await (await b.get("search-index/v1/previous.index.json"))!.text()).toBe(v2.text);
    expect([...b.objects.keys()].filter((k) => k.endsWith(".sbix")).sort()).toEqual([`search-index/v1/${v2.dict.bin}`, `search-index/v1/${v3.dict.bin}`].sort());
  });

  it("republishing the same index does not move the previous pointer", async () => {
    const b = new FakeR2();
    const v1 = built(6, "2026-10-01");
    const v2 = built(9, "2026-10-02");
    for (const v of [v1, v2]) {
      await put(b, v);
      await publish(b, "part=dict", v.text);
    }
    await put(b, v2);
    expect(await (await publish(b, "part=dict", v2.text)).json()).toMatchObject({ previous: v1.dict.bin, deleted: 0 });
    expect(await (await b.get("search-index/v1/previous.index.json"))!.text()).toBe(v1.text);
  });

  it("refuses a dictionary with under half the samples unless forced", async () => {
    const b = new FakeR2();
    const big = built(30, "2026-10-01");
    const small = built(6, "2026-10-02");
    await put(b, big);
    await publish(b, "part=dict", big.text);
    await put(b, small);
    expect((await publish(b, "part=dict", small.text)).status).toBe(409);
    expect(await (await b.get("search-index/v1/index.json"))!.text()).toBe(big.text);
    expect((await publish(b, "part=dict&force=1", small.text)).status).toBe(200);
  });
});
