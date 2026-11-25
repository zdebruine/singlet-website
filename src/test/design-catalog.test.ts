// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyObjectKey } from "../../functions/_shared/channel";
import { sha256Hex } from "../../functions/_shared/hash";
import { onRequestGet as designGet, onRequestPost as designPost } from "../../functions/api/ingest/s1-design";
import { onRequestGet as statusGet, onRequestPost as statusPost } from "../../functions/api/ingest/s1-status";
import { createTestD1 } from "./helpers/d1-sqlite";

const TOKEN = "design-token";
const SCHEMA = readFileSync("schema/042_design_catalog.sql", "utf8");

function record(over: Record<string, unknown> = {}) {
  return {
    schema: "singlet-design-catalog-0.1",
    study: "GSE1",
    tier: "candidate",
    design_class: "case_control",
    summary: "case control",
    factors: [{ id: "F1", name: "disease", type: "disease", unit: "donor", source: "characteristics:disease", confidence: "high",
      levels: [{ id: "F1.a", label: "healthy", standard: "healthy", role: "reference", ontology: [{ id: "PATO:0000461" }] }, { id: "F1.b", label: "COVID", standard: "COVID-19", role: "test", ontology: [] }] }],
    units: [
      { unit_id: "GSM1", gsm: "GSM1", library: "gex", biosample_key: "GSM1", donor: "P1", pool: { type: "none", mapping: "na" }, levels: { F1: "F1.a" }, status: "held" },
      { unit_id: "GSM2", gsm: "GSM2", library: "gex", biosample_key: "GSM2", donor: "P2", pool: { type: "hashtag_or_cmo", mapping: "absent" }, levels: { F1: ["F1.a", "F1.b"] }, status: "scheduled" },
    ],
    contrasts: [{ id: "GSE1.c1", factor_id: "F1", factor_type: "disease", test: "COVID-19", reference: "healthy", symmetric: false, kind: "author_stated", grade: "B", status: "candidate",
      replication_unit: "donor", n: { test_units: 2, reference_units: 2 }, pairing: "unpaired", confounds: [], shared: { tissue: "blood" }, differs: [{ attribute: "sex", test_values: ["F"], reference_values: ["M"], aligned_with_arms: true }] }],
    provenance: { prompt_version: "0.2-x", model: "haiku", bundle_hash: "h", paper_used: false },
    ...over,
  };
}

async function env(beta = true) {
  const puts: Record<string, string> = {};
  const bucket = { put: async (k: string, v: string) => { puts[k] = v; return {}; } };
  return { DB: createTestD1(SCHEMA), SINGLET_DATA: bucket as never, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), CHANNEL: beta ? "beta" : undefined, puts };
}
type E = Awaited<ReturnType<typeof env>>;
const ctx = (request: Request, e: E) => ({ request, env: e, params: {}, waitUntil: () => undefined }) as never;
const post = (fn: typeof designPost, url: string, e: E, body: unknown, token: string | null = TOKEN) =>
  fn(ctx(new Request(url, { method: "POST", headers: token ? { "x-ingest-token": token } : {}, body: JSON.stringify(body) }), e));
const rows = (e: E, sql: string) => e.DB.raw.prepare(sql).all() as Record<string, unknown>[];

describe("s1-design", () => {
  it("is beta only and needs the token", async () => {
    expect((await post(designPost, "https://x/api/ingest/s1-design", await env(false), { study: "GSE1", record: record() })).status).toBe(403);
    expect((await post(designPost, "https://x/api/ingest/s1-design", await env(), { study: "GSE1", record: record() }, null)).status).toBe(401);
  });

  it("writes the sidecar and all rows, and a repost of the same record writes nothing", async () => {
    const e = await env();
    const r = await post(designPost, "https://x/api/ingest/s1-design", e, { study: "gse1", record: record() });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { tier: string; unchanged: boolean };
    expect(body).toMatchObject({ tier: "candidate", unchanged: false });
    expect(JSON.parse(e.puts["s1/d/GSE1.design.json"]).study).toBe("GSE1");
    expect(rows(e, "SELECT COUNT(*) AS n FROM design_unit_level")[0].n).toBe(3); // GSM1: one, GSM2: two pooled
    expect(rows(e, "SELECT pooled FROM design_unit_level WHERE unit_id='GSM2'").every((x) => x.pooled === 1)).toBe(true);
    expect(rows(e, "SELECT relation, aligned FROM design_contrast_attr ORDER BY relation")).toEqual([{ relation: "differs", aligned: 1 }, { relation: "shared", aligned: 0 }]);
    const again = (await (await post(designPost, "https://x/api/ingest/s1-design", e, { study: "GSE1", record: record() })).json()) as { unchanged: boolean; rows_written: number };
    expect(again).toMatchObject({ unchanged: true, rows_written: 0 });
    const g = (await (await designGet(ctx(new Request("https://x/api/ingest/s1-design?gse=GSE1", { headers: { "x-ingest-token": TOKEN } }), e))).json()) as { counts: { units: number } };
    expect(g.counts.units).toBe(2);
  });

  it("replaces a study's rows when the record changes", async () => {
    const e = await env();
    await post(designPost, "https://x/api/ingest/s1-design", e, { study: "GSE1", record: record() });
    await post(designPost, "https://x/api/ingest/s1-design", e, { study: "GSE1", record: record({ tier: "unresolved", contrasts: [] }) });
    expect(rows(e, "SELECT tier, n_contrasts FROM design_study")).toEqual([{ tier: "unresolved", n_contrasts: 0 }]);
    expect(rows(e, "SELECT COUNT(*) AS n FROM design_contrast")[0].n).toBe(0);
  });

  it("rejects a bad schema, tier, grade or study", async () => {
    const e = await env();
    const bad = async (rec: unknown, study = "GSE1") => (await post(designPost, "https://x/api/ingest/s1-design", e, { study, record: rec })).status;
    expect(await bad(record({ schema: "x" }))).toBe(400);
    expect(await bad(record({ tier: "gold" }))).toBe(400);
    expect(await bad(record({ study: "GSE2" }))).toBe(400);
    expect(await bad(record({ contrasts: [{ id: "c", grade: "E", n: { test_units: 1, reference_units: 1 } }] }))).toBe(400);
    expect(await bad(record(), "bogus")).toBe(400);
  });
});

describe("s1-status", () => {
  const seed = (e: E) => e.DB.raw.exec("INSERT INTO sample_status(sample_id,gse_id,status,reason) VALUES ('GSM1','GSE1','held','hashtag'),('GSM2','GSE1','scheduled','')");
  const upd = (e: E, updates: unknown[]) => post(statusPost, "https://x/api/ingest/s1-status", e, { updates });

  it("moves scheduled samples through running to counts_available", async () => {
    const e = await env();
    seed(e);
    expect((await upd(e, [{ sample: "GSM2", status: "running" }])).status).toBe(200);
    const url = "https://beta-data.singlet.bio/s1/s/GSM2/" + "a".repeat(32) + ".s1";
    expect((await upd(e, [{ sample: "GSM2", status: "counts_available", object_url: url }])).status).toBe(200);
    expect(rows(e, "SELECT status, object_url FROM sample_status WHERE sample_id='GSM2'")).toEqual([{ status: "counts_available", object_url: url }]);
  });

  it("refuses to release a held sample without a named route", async () => {
    const e = await env();
    seed(e);
    const r = await upd(e, [{ sample: "GSM1", status: "running" }]);
    expect(r.status).toBe(409);
    expect(rows(e, "SELECT status FROM sample_status WHERE sample_id='GSM1'")[0].status).toBe("held");
    expect((await upd(e, [{ sample: "GSM1", status: "scheduled", release: "tag_demultiplexing" }])).status).toBe(200);
    expect(rows(e, "SELECT status, reason FROM sample_status WHERE sample_id='GSM1'")).toEqual([{ status: "scheduled", reason: "released: tag_demultiplexing" }]);
  });

  it("validates updates", async () => {
    const e = await env();
    expect((await upd(e, [{ sample: "GSM1", status: "done" }])).status).toBe(400);
    expect((await upd(e, [{ sample: "GSM1", status: "running", object_url: "https://x/y.s1" }])).status).toBe(400);
    expect((await upd(e, [{ sample: "GSM1", status: "counts_available" }])).status).toBe(400);
    expect((await upd(e, Array.from({ length: 501 }, (_, i) => ({ sample: `S${i}`, status: "running" })))).status).toBe(413);
    expect((await upd(e, [])).status).toBe(400);
  });

  it("mirrors the status onto design units and counts by study", async () => {
    const e = await env();
    await post(designPost, "https://x/api/ingest/s1-design", e, { study: "GSE1", record: record() });
    seed(e);
    await upd(e, [{ sample: "GSM2", gse: "GSE1", status: "running" }]);
    expect(rows(e, "SELECT status FROM design_unit WHERE gsm_id='GSM2'")[0].status).toBe("running");
    const g = (await (await statusGet(ctx(new Request("https://x/api/ingest/s1-status?gse=GSE1", { headers: { "x-ingest-token": TOKEN } }), e))).json()) as { counts: { status: string; n: number }[] };
    expect(Object.fromEntries(g.counts.map((c) => [c.status, c.n]))).toEqual({ held: 1, running: 1 });
  });
});

describe("object keys", () => {
  it("accepts the design sidecar key and nothing broader under s1/d/", () => {
    expect(classifyObjectKey("s1/d/GSE123.design.json")).toEqual({ ok: true, kind: "design", digest: null });
    expect(classifyObjectKey("s1/d/SRP9.design.json")).toMatchObject({ ok: true });
    expect(classifyObjectKey("s1/d/GSE123.json").ok).toBe(false);
    expect(classifyObjectKey("s1/d/../private/x.design.json").ok).toBe(false);
  });
});
