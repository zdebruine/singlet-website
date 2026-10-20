// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../functions/_shared/hash";
import { onRequestPost } from "../../functions/api/ingest/[table]";
import { createTestD1 } from "./helpers/d1-sqlite";

const TOKEN = "test-ingest-token";
const SCHEMA = readFileSync("schema/030_search_facts.sql", "utf8");

async function post(table: string, body: unknown, env: { DB: D1Database; INGEST_TOKEN_SHA256: string }, token = TOKEN) {
  const request = new Request(`https://singlet.bio/api/ingest/${table}`, {
    method: "POST",
    headers: { "x-ingest-token": token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env, params: { table } } as never);
}

const attrRow = (over: Record<string, unknown> = {}) => ({
  gsm_id: "GSM1",
  gse_id: "GSE1",
  attr: "tissue",
  value_raw: "Kidney",
  value_norm: "kidney",
  value_num: null,
  unit: null,
  source: "geo",
  confidence: 0.95,
  evidence: "tissue: Kidney",
  extractor_version: "v1",
  ...over,
});

describe("POST /api/ingest/{sample_attr,study_card,pz_chunk_index}", () => {
  async function makeEnv() {
    const DB = createTestD1(SCHEMA);
    return { DB, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) };
  }

  it("needs the token", async () => {
    const env = await makeEnv();
    expect((await post("sample_attr", { rows: [attrRow()] }, env, "wrong")).status).toBe(401);
  });

  it("upserts sample_attr on (gsm, attr, source, value_norm) and keeps several values", async () => {
    const env = await makeEnv();
    const rows = [attrRow(), attrRow({ value_norm: "liver", value_raw: "Liver" }), attrRow({ attr: "age", value_norm: "8 weeks", value_num: 8, unit: "weeks" })];
    expect((await post("sample_attr", { rows }, env)).status).toBe(200);
    expect((await post("sample_attr", { rows: [attrRow({ evidence: "changed" })] }, env)).status).toBe(200);
    const all = await env.DB.prepare("SELECT attr, value_norm, evidence FROM sample_attr ORDER BY attr, value_norm").all<Record<string, string>>();
    expect(all.results.map((r) => `${r.attr}:${r.value_norm}`)).toEqual(["age:8 weeks", "tissue:kidney", "tissue:liver"]);
    expect(all.results.find((r) => r.value_norm === "kidney")!.evidence).toBe("changed");
  });

  it("rejects a bad source, a missing required column and a non-GSM id", async () => {
    const env = await makeEnv();
    expect((await post("sample_attr", { rows: [attrRow({ source: "guess" })] }, env)).status).toBe(400);
    expect((await post("sample_attr", { rows: [attrRow({ value_norm: null })] }, env)).status).toBe(400);
    expect((await post("sample_attr", { rows: [attrRow({ gsm_id: "X1" })] }, env)).status).toBe(400);
  });

  it("upserts study_card by gse_id", async () => {
    const env = await makeEnv();
    const card = { gse_id: "GSE1", card_json: "{}", summary_text: "a", extractor_version: "c1", model: null, grounded: 1 };
    expect((await post("study_card", { rows: [card] }, env)).status).toBe(200);
    expect((await post("study_card", { rows: [{ ...card, summary_text: "b" }] }, env)).status).toBe(200);
    const r = await env.DB.prepare("SELECT count(*) AS n, max(summary_text) AS s FROM study_card").first<{ n: number; s: string }>();
    expect(r).toEqual({ n: 1, s: "b" });
  });

  it("upserts pz_chunk_index by (gsm, file)", async () => {
    const env = await makeEnv();
    const row = { gsm_id: "GSM1", gse_id: "GSE1", file: "exon_counts.1pz", n_cols: 10, chunk_cols: 4, chunk_offsets: [0, 5, 9, 12] };
    expect((await post("pz_chunk_index", { rows: [row] }, env)).status).toBe(200);
    expect((await post("pz_chunk_index", { rows: [{ ...row, n_cols: 11 }] }, env)).status).toBe(200);
    const r = await env.DB.prepare("SELECT count(*) AS n, max(n_cols) AS c, max(chunk_offsets) AS o FROM pz_chunk_index").first<{ n: number; c: number; o: string }>();
    expect(r).toEqual({ n: 1, c: 11, o: "[0,5,9,12]" });
  });
});
