// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../functions/_shared/hash";
import {
  MAX_SAMPLES_PER_POST,
  V2ManifestError,
  getV2Migration,
  getV2Sample,
  getV2Samples,
  getV2State,
  getV2Study,
  isServedFromV2,
  listV2Samples,
  parseIngestBody,
  parseMembers,
  parseModalities,
  v2Available,
  v2ServedStudies,
} from "../../functions/_shared/v2-catalog";
import { onRequestGet, onRequestPost } from "../../functions/api/ingest/v2-study";
import { createTestD1 } from "./helpers/d1-sqlite";

const TOKEN = "v2-ingest-token";
const SCHEMA_032 = readFileSync("schema/032_v2_catalog.sql", "utf8");
const SCHEMA_033 = readFileSync("schema/033_v2_sample_rev_key.sql", "utf8");
const SCHEMA = SCHEMA_032 + SCHEMA_033; // production: 032 as applied, then 033
const LIVE = { status: "verified", verify_ok: true };
const hex = (c: string, n: number) => c.repeat(n);

function sample(gsm: string, over: Record<string, unknown> = {}) {
  return {
    gsm,
    key: `v2/s/${gsm}/${hex("a", 32)}.s2`,
    bytes: 1000,
    sha256: hex("b", 64),
    n_columns: 5000,
    n_called: 800,
    members: {
      "exon_counts.1pz": { kind: 1, off: 4096, len: 500, digest: hex("c", 32), chunk_cols: 256, chunk_index: [100, 64], nnz: 1234 },
      "intron_counts.1pz": { kind: 1, off: 8192, len: 300, chunk_cols: 256 },
      sj_counts: { kind: 1, off: 9000, len: 10 },
      cells: { kind: 2, off: 64, len: 2000 },
      "summary.json": { kind: 3, off: 12000, len: 99, out_len: 400 },
    },
    stats: { median_umi: 1500.5, median_genes: 900, n_umi_q: [100, 500, 3000] },
    ...over,
  };
}

function manifest(gsms: string[], over: Record<string, unknown> = {}) {
  return {
    format: "singlet-v2",
    manifest_version: 1,
    gse: "GSE1",
    rev: hex("1", 16),
    created_at: "2026-10-23T08:00:00Z",
    reference_build: "GRCh38-2024-A",
    pipeline: { singlet_version: "0.9.1" },
    packs: { exon: hex("e", 16), intron: hex("f", 16), whitelist: null },
    samples: gsms.map((g) => sample(g)),
    legacy: { key: "data/GSE1/GSE1.singlet", etag: '"abc-3"', bytes: 5000, migrated_at: "2026-10-23T07:00:00Z" },
    ...over,
  };
}

async function env(schema: string | null = SCHEMA) {
  return { DB: createTestD1(schema ?? ""), INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) };
}

function post(e: Awaited<ReturnType<typeof env>>, body: unknown, token: string | null = TOKEN) {
  const request = new Request("https://singlet.bio/api/ingest/v2-study", {
    method: "POST",
    headers: token ? { "x-ingest-token": token } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return onRequestPost({ request, env: e, params: {}, waitUntil: () => undefined } as never);
}
function status(e: Awaited<ReturnType<typeof env>>, gse: string, token: string | null = TOKEN) {
  const request = new Request(`https://singlet.bio/api/ingest/v2-study?gse=${gse}`, { headers: token ? { "x-ingest-token": token } : {} });
  return onRequestGet({ request, env: e, params: {}, waitUntil: () => undefined } as never);
}
const rows = (e: Awaited<ReturnType<typeof env>>, sql: string) => e.DB.raw.prepare(sql).all() as Record<string, unknown>[];

describe("parseIngestBody", () => {
  it("accepts a manifest and derives the columns", () => {
    const p = parseIngestBody({ manifest: manifest(["GSM1", "GSM2"]) });
    expect(p.final).toBe(true);
    expect(p.migration).toMatchObject({ status: "uploaded" }); // no implicit live
    expect(p.migrationImplicit).toBe(true);
    expect(p.study).toMatchObject({ gse: "GSE1", rev: hex("1", 16), bytes: 2000, n_samples: 2, legacy_bytes: 5000, reference_build: "GRCh38-2024-A" });
    const s = p.study!.samples[0];
    expect(s).toMatchObject({ gsm: "GSM1", median_umi: 1500.5, median_genes: 900, n_called: 800 });
    // modalities come from the registry, over public member names only; the v2 "cells" member is not a modality
    expect(s.modalities).toEqual(expect.arrayContaining(["exon_counts", "intron_counts"]));
    expect(s.modalities).not.toContain("cells");
  });

  it("rejects what is not a v2 manifest", () => {
    const bad = (m: unknown, re: RegExp, status = 400) => {
      const err = (() => {
        try {
          parseIngestBody(m);
        } catch (e) {
          return e as V2ManifestError;
        }
        return null;
      })();
      expect(err, String(re)).toBeInstanceOf(V2ManifestError);
      expect(err!.message).toMatch(re);
      expect(err!.status).toBe(status);
    };
    bad(null, /JSON object/);
    bad({ manifest: manifest(["GSM1"], { format: "singlet-v1" }) }, /format/);
    bad({ manifest: manifest(["GSM1"], { manifest_version: 2 }) }, /manifest_version/);
    bad({ manifest: manifest(["GSM1"], { gse: "gse1" }) }, /manifest.gse/);
    bad({ manifest: manifest(["GSM1"], { rev: "XYZ" }) }, /rev/);
    bad({ manifest: manifest(["GSM1"], { samples: [] }) }, /non-empty/);
    bad({ manifest: manifest(["GSM1"], { manifest_key: "v2/m/GSE2.json" }) }, /manifest_key/);
    bad({ manifest: manifest(["GSM1", "GSM1"]) }, /appears twice/);
    bad({ manifest: manifest(["GSM1"], { samples: [sample("GSM1", { key: `v2/s/GSM2/${hex("a", 32)}.s2` })] }) }, /key must be v2\/s\/GSM1/);
    bad({ manifest: manifest(["GSM1"], { samples: [sample("GSM1", { key: "v2/s/GSM1/short.s2" })] }) }, /key must be/);
    bad({ manifest: manifest(["GSM1"], { samples: [sample("GSM1", { sha256: "nothex" })] }) }, /sha256/);
    bad({ manifest: manifest(["GSM1"], { samples: [sample("GSM1", { bytes: -1 })] }) }, /bytes/);
    bad({ manifest: manifest(["GSM1"], { samples: [sample("GSM1", { members: { x: { kind: 9, off: 0, len: 1 } } })] }) }, /kind/);
    bad({ manifest: manifest(["GSM1"], { samples: [sample("GSM1", { members: { "../x": { kind: 1, off: 0, len: 1 } } })] }) }, /bad member name/);
    bad({ manifest: manifest(["GSM1"]), final: "yes" }, /final/);
    bad({ manifest: manifest(["GSM1"]), migration: { status: "done" } }, /migration.status/);
    bad({ manifest: manifest(["GSM1"]), migration: { status: "verified" } }, /verify_ok/, 422);
    bad({ manifest: manifest(["GSM1"]), migration: { status: "retired", verify_ok: false } }, /verify_ok/, 422);
    bad({ gse_id: "GSE1", migration: { status: "verified" } }, /verify_ok/, 422);
    bad({ gse_id: "GSE1" }, /Nothing to write/);
    bad({ manifest: manifest(["GSM1"], { n_samples: 3 }) }, /needs manifest.bytes/);
    bad({ manifest: manifest(["GSM1", "GSM2"], { n_samples: 1 }) }, /n_samples/);
    const many = Array.from({ length: MAX_SAMPLES_PER_POST + 1 }, (_, i) => `GSM${i + 1}`);
    bad({ manifest: manifest(many) }, /At most/, 413);
  });

  it("refuses a restricted member outright, with 422", () => {
    for (const name of ["donor/snp_ad.tsv", "donor/genotypes.tsv", "ase_counts.tsv", "mt/mt_events.1pz", "snp_dp.1pz", "calls.vcf.gz"]) {
      const m = manifest(["GSM1"], { samples: [sample("GSM1", { members: { "exon_counts.1pz": { kind: 1, off: 0, len: 1 }, [name]: { kind: 3, off: 1, len: 1 } } })] });
      expect(() => parseIngestBody({ manifest: m }), name).toThrow(/restricted members/);
    }
    // public siblings are fine
    const ok = manifest(["GSM1"], { samples: [sample("GSM1", { members: { "donor/donor_assignments.tsv": { kind: 3, off: 0, len: 1 }, "mt/mt_summary.tsv": { kind: 3, off: 1, len: 1 } } })] });
    expect(() => parseIngestBody({ manifest: ok })).not.toThrow();
  });

  it("takes the legacy etag and size from the manifest when the migration block omits them", () => {
    const p = parseIngestBody({ manifest: manifest(["GSM1"]), migration: { ...LIVE, v2_bytes: 1000 } });
    expect(p.migration).toMatchObject({ status: "verified", legacy_etag: '"abc-3"', legacy_bytes: 5000, v2_bytes: 1000 });
  });
});

function spyOnPrepare(e: Awaited<ReturnType<typeof env>>): string[] {
  const sql: string[] = [];
  const orig = e.DB.prepare.bind(e.DB);
  (e.DB as { prepare: unknown }).prepare = (q: string) => (sql.push(q), orig(q));
  return sql;
}

describe("POST /api/ingest/v2-study", () => {
  it("needs the token", async () => {
    const e = await env();
    expect((await post(e, { manifest: manifest(["GSM1"]) }, null)).status).toBe(401);
    expect((await post(e, { manifest: manifest(["GSM1"]) }, "wrong")).status).toBe(401);
    expect((await status(e, "GSE1", null)).status).toBe(401);
    expect(rows(e, "SELECT * FROM v2_study")).toHaveLength(0);
  });

  it("writes the study, its samples and the migration row", async () => {
    const e = await env();
    const body = { manifest: manifest(["GSM1", "GSM2"]), migration: { ...LIVE, v2_bytes: 2000, verified_at: "2026-10-23T08:10:00Z", ledger_key: "v2/ledger/GSE1.jsonl" } };
    const res = await post(e, body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, gse_id: "GSE1", unchanged: false, samples_written: 2, n_samples: 2, final: true, migration_status: "verified" });
    expect(rows(e, "SELECT * FROM v2_study")).toEqual([
      expect.objectContaining({ gse_id: "GSE1", manifest_key: "v2/m/GSE1.json", rev: hex("1", 16), bytes: 2000, n_samples: 2, legacy_bytes: 5000, reference_build: "GRCh38-2024-A" }),
    ]);
    const s = rows(e, "SELECT * FROM v2_sample ORDER BY gsm_id");
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ gse_id: "GSE1", gsm_id: "GSM1", key: `v2/s/GSM1/${hex("a", 32)}.s2`, bytes: 1000, n_columns: 5000, n_called: 800, n_members: 5, median_umi: 1500.5, median_genes: 900, rev: hex("1", 16) });
    expect(JSON.parse(String(s[0].members_json))["exon_counts.1pz"]).toMatchObject({ off: 4096, len: 500, chunk_index: [100, 64] });
    expect(JSON.parse(String(s[0].modalities))).toContain("exon_counts");
    expect(rows(e, "SELECT * FROM v2_migration")).toEqual([
      expect.objectContaining({ gse_id: "GSE1", status: "verified", verify_ok: 1, legacy_etag: '"abc-3"', legacy_bytes: 5000, v2_bytes: 2000, ledger_key: "v2/ledger/GSE1.jsonl", error: null }),
    ]);
  });

  it("posting the rev that is already stored rewrites no sample and no study row", async () => {
    const e = await env();
    const body = { manifest: manifest(["GSM1", "GSM2"]), migration: LIVE };
    await post(e, body);
    const before = rows(e, "SELECT gsm_id, updated_at FROM v2_sample ORDER BY gsm_id");
    const sql = spyOnPrepare(e);
    const res = await post(e, body);
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true, samples_written: 0, migration_status: "verified" });
    // one read of the stored rev, then only the migration row (the body carried one) and the queue marker for a study served without a legacy file
    expect(sql.map((q) => q.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual(["SELECT rev FROM", "INSERT INTO v2_migration", "UPDATE gse_meta SET"]);
    expect(rows(e, "SELECT gsm_id, updated_at FROM v2_sample ORDER BY gsm_id")).toEqual(before);
    // without a migration block even that is skipped, and a verified study stays verified
    sql.length = 0;
    const quiet = await post(e, { manifest: manifest(["GSM1", "GSM2"]) });
    expect(await quiet.json()).toMatchObject({ unchanged: true, migration_status: null });
    expect(sql).toHaveLength(1);
    expect(rows(e, "SELECT status FROM v2_migration")).toEqual([{ status: "verified" }]);
    // force rewrites
    sql.length = 0;
    const forced = await post(e, { ...body, force: true });
    expect(await forced.json()).toMatchObject({ unchanged: false, samples_written: 2 });
    expect(sql.filter((q) => /INSERT INTO v2_sample/.test(q))).toHaveLength(2);
    expect(sql.find((q) => /INSERT INTO v2_sample/.test(q))).toMatch(/DO UPDATE SET/);
  });

  it("reports the rows D1 says it wrote (sum of meta.rows_written), or null when the binding does not say", async () => {
    const e = await env();
    const first = await post(e, { manifest: manifest(["GSM1", "GSM2"]), migration: LIVE });
    expect(((await first.json()) as { rows_written: unknown }).rows_written).toBeNull(); // the local stand-in reports no such count
    // a binding that reports a count per statement, as D1 does: the response is their sum (these per-statement numbers are made up for the test)
    const e2 = await env();
    const cost: Record<string, number> = { "INSERT INTO v2_sample": 3, "INSERT INTO v2_study": 2, "DELETE FROM v2_sample": 0, "INSERT INTO v2_migration": 3 };
    const prepared = new WeakMap<object, number>();
    const origPrepare = e2.DB.prepare.bind(e2.DB);
    (e2.DB as { prepare: unknown }).prepare = (q: string) => {
      const stmt = origPrepare(q) as unknown as { bind: (...a: unknown[]) => object };
      const rows = Object.entries(cost).find(([k]) => q.trim().startsWith(k))?.[1] ?? 0;
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...a: unknown[]) => {
        const bound = bind(...a);
        prepared.set(bound, rows);
        return bound;
      };
      return stmt;
    };
    const origBatch = e2.DB.batch.bind(e2.DB);
    (e2.DB as { batch: unknown }).batch = async (stmts: object[]) => {
      const out = (await origBatch(stmts as never)) as { meta?: Record<string, unknown> }[];
      return out.map((r, i) => ({ ...r, meta: { ...(r.meta ?? {}), rows_written: prepared.get(stmts[i]) ?? 0 } }));
    };
    const res = await post(e2, { manifest: manifest(["GSM1", "GSM2"]), migration: LIVE });
    expect(await res.json()).toMatchObject({ ok: true, samples_written: 2, rows_written: 2 * 3 + 2 + 0 + 3 });
  });

  it("a first post without a migration block is only uploaded: nothing is served", async () => {
    const e = await env();
    const res = await post(e, { manifest: manifest(["GSM1"]) });
    expect(await res.json()).toMatchObject({ ok: true, migration_status: "uploaded" });
    expect(rows(e, "SELECT status, verify_ok FROM v2_migration")).toEqual([{ status: "uploaded", verify_ok: null }]);
    expect(await getV2State(e.DB, "GSE1")).toBeNull();
    // verifying it is a separate, explicit act
    await post(e, { gse_id: "GSE1", migration: LIVE });
    expect(await getV2State(e.DB, "GSE1")).toMatchObject({ study: { rev: hex("1", 16) }, migration: { status: "verified" } });
  });

  it("verified and retired need verify_ok, and nothing is written when they lack it", async () => {
    const e = await env();
    for (const status of ["verified", "retired"]) {
      const res = await post(e, { manifest: manifest(["GSM1"]), migration: { status } });
      expect(res.status, status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/verify_ok/);
    }
    expect((await post(e, { gse_id: "GSE1", migration: { status: "verified", verify_ok: false } })).status).toBe(422);
    expect(rows(e, "SELECT * FROM v2_sample")).toHaveLength(0);
    expect(rows(e, "SELECT * FROM v2_migration")).toHaveLength(0);
  });

  it("keeps the campaign's extra fields: manifest size and hash, cells called, migration details", async () => {
    const e = await env();
    const res = await post(e, {
      manifest: manifest(["GSM1", "GSM2"]),
      manifest_bytes: 4321,
      manifest_sha256: hex("d", 64),
      migration: { ...LIVE, commit_sha: "abc1234", n_samples: 2, members_by_kind: { matrix: 4, recipe: 3 }, migrated_at: "2026-10-23T07:00:00Z" },
    });
    expect(res.status).toBe(200);
    expect(rows(e, "SELECT manifest_bytes, manifest_sha256, n_cells_called FROM v2_study")).toEqual([{ manifest_bytes: 4321, manifest_sha256: hex("d", 64), n_cells_called: 1600 }]);
    expect(rows(e, "SELECT legacy_key, verify_ok, commit_sha, n_samples, members_by_kind, migrated_at FROM v2_migration")).toEqual([
      { legacy_key: "data/GSE1/GSE1.singlet", verify_ok: 1, commit_sha: "abc1234", n_samples: 2, members_by_kind: '{"matrix":4,"recipe":3}', migrated_at: "2026-10-23T07:00:00Z" },
    ]);
    expect((await post(e, { manifest: manifest(["GSM1"]), manifest_sha256: "nope" })).status).toBe(400);
  });

  it("a new rev is written beside the served one and flips last: no reader ever sees a mix", async () => {
    const e = await env();
    await post(e, { manifest: manifest(["GSM1", "GSM2", "GSM3"]), migration: LIVE });
    const newRev = hex("2", 16);
    // the new rev arrives in two slices: while it does, every reader still gets the old rev, complete
    const total = { rev: newRev, n_samples: 2, bytes: 2000 };
    await post(e, { manifest: manifest(["GSM1"], total), final: false });
    expect(rows(e, "SELECT rev, COUNT(*) AS n FROM v2_sample GROUP BY rev ORDER BY rev")).toEqual([{ rev: hex("1", 16), n: 3 }, { rev: newRev, n: 1 }]);
    const mid = await getV2State(e.DB, "GSE1");
    expect(mid?.study.rev).toBe(hex("1", 16));
    expect((await listV2Samples(e.DB, "GSE1", hex("1", 16))).map((s) => s.gsm_id)).toEqual(["GSM1", "GSM2", "GSM3"]);
    expect((await getV2Sample(e.DB, "GSE1", "GSM1"))?.rev).toBe(hex("1", 16)); // by the study's current rev
    expect((await getV2Samples(e.DB, "GSE1", ["GSM1", "GSM3"])).map((s) => `${s.gsm_id}@${s.rev}`)).toEqual([`GSM1@${hex("1", 16)}`, `GSM3@${hex("1", 16)}`]);
    // the final slice flips the study row and drops the old rows in one batch
    const sql = spyOnPrepare(e);
    await post(e, { manifest: manifest(["GSM2"], total), migration: LIVE });
    expect(sql.filter((q) => /^\s*(INSERT INTO v2_study|DELETE FROM v2_sample|INSERT INTO v2_migration)/.test(q)).map((q) => q.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "INSERT INTO v2_study",
      "DELETE FROM v2_sample",
      "INSERT INTO v2_migration",
    ]);
    expect(rows(e, "SELECT gsm_id, rev FROM v2_sample ORDER BY gsm_id")).toEqual([{ gsm_id: "GSM1", rev: newRev }, { gsm_id: "GSM2", rev: newRev }]);
    expect(rows(e, "SELECT rev, n_samples FROM v2_study")).toEqual([{ rev: newRev, n_samples: 2 }]);
    expect((await getV2Sample(e.DB, "GSE1", "GSM1"))?.rev).toBe(newRev);
  });

  it("a new rev posted without a migration block is only uploaded: the study stops being served until it is verified", async () => {
    const e = await env();
    await post(e, { manifest: manifest(["GSM1"]), migration: LIVE });
    expect(await getV2State(e.DB, "GSE1")).not.toBeNull();
    await post(e, { manifest: manifest(["GSM1"], { rev: hex("2", 16) }) });
    expect(rows(e, "SELECT status FROM v2_migration")).toEqual([{ status: "uploaded" }]);
    expect(await getV2State(e.DB, "GSE1")).toBeNull();
    await post(e, { gse_id: "GSE1", migration: LIVE });
    expect((await getV2State(e.DB, "GSE1"))?.study.rev).toBe(hex("2", 16));
  });

  it("the same GSM can sit in two studies (SuperSeries and SubSeries)", async () => {
    const e = await env();
    await post(e, { manifest: manifest(["GSM1"]) });
    await post(e, { manifest: manifest(["GSM1"], { gse: "GSE2" }) });
    expect(rows(e, "SELECT gse_id, gsm_id FROM v2_sample ORDER BY gse_id")).toEqual([
      { gse_id: "GSE1", gsm_id: "GSM1" },
      { gse_id: "GSE2", gsm_id: "GSM1" },
    ]);
  });

  it("takes a big study in slices: samples at once, the study row only with the final slice", async () => {
    const e = await env();
    const total = { n_samples: 3, bytes: 3000, rev: hex("3", 16) };
    const r1 = await post(e, { manifest: manifest(["GSM1", "GSM2"], total), final: false });
    expect(r1.status).toBe(200);
    expect(rows(e, "SELECT * FROM v2_study")).toHaveLength(0); // not visible yet
    expect(await getV2State(e.DB, "GSE1")).toBeNull();
    expect((await (await status(e, "GSE1")).json()) as { complete: boolean }).toMatchObject({ complete: false });
    // the same slice again writes nothing new
    const sql = spyOnPrepare(e);
    await post(e, { manifest: manifest(["GSM1", "GSM2"], total), final: false });
    sql.length = 0;
    const r2 = await post(e, { manifest: manifest(["GSM3"], total), migration: LIVE });
    expect(r2.status).toBe(200);
    expect(rows(e, "SELECT n_samples, bytes FROM v2_study")).toEqual([{ n_samples: 3, bytes: 3000 }]);
    const st = (await (await status(e, "GSE1")).json()) as { complete: boolean; sample_rows_by_rev: { rev: string; n: number }[] };
    expect(st.complete).toBe(true);
    expect(st.sample_rows_by_rev).toEqual([{ rev: hex("3", 16), n: 3 }]);
  });

  it("a repeated slice does not rewrite its rows (the conflict does nothing)", async () => {
    const e = await env();
    const total = { n_samples: 2, bytes: 2000, rev: hex("3", 16) };
    await post(e, { manifest: manifest(["GSM1"], total), final: false });
    e.DB.raw.exec("UPDATE v2_sample SET updated_at = 'sentinel'");
    await post(e, { manifest: manifest(["GSM1"], total), final: false });
    expect(rows(e, "SELECT updated_at FROM v2_sample")).toEqual([{ updated_at: "sentinel" }]);
  });

  it("migration-only post, and a later update keeps what it does not restate", async () => {
    const e = await env();
    expect((await post(e, { gse_id: "GSE9", migration: { status: "running" } })).status).toBe(200);
    expect(rows(e, "SELECT status, v2_bytes FROM v2_migration")).toEqual([{ status: "running", v2_bytes: null }]);
    await post(e, { gse_id: "GSE9", migration: { status: "uploaded", v2_bytes: 777, legacy_etag: '"e-1"', ledger_key: "v2/ledger/GSE9.jsonl" } });
    await post(e, { gse_id: "GSE9", migration: { status: "failed", error: "verify mismatch in GSM5" } });
    expect(rows(e, "SELECT * FROM v2_migration")).toEqual([
      expect.objectContaining({ status: "failed", v2_bytes: 777, legacy_etag: '"e-1"', ledger_key: "v2/ledger/GSE9.jsonl", error: "verify mismatch in GSM5" }),
    ]);
    await post(e, { gse_id: "GSE9", migration: LIVE });
    expect(rows(e, "SELECT status, error, verify_ok FROM v2_migration")).toEqual([{ status: "verified", error: null, verify_ok: 1 }]); // a verified post clears the error
    await post(e, { gse_id: "GSE9", migration: { status: "failed", error: "later problem" } });
    expect(rows(e, "SELECT status, verify_ok FROM v2_migration")).toEqual([{ status: "failed", verify_ok: null }]); // and a failure clears the verification
  });

  it("rejects bad input before writing anything", async () => {
    const e = await env();
    expect((await post(e, "not json")).status).toBe(400);
    expect((await post(e, { manifest: manifest(["GSM1"], { rev: "x" }) })).status).toBe(400);
    const restricted = manifest(["GSM1", "GSM2"], { samples: [sample("GSM1"), sample("GSM2", { members: { "donor/snp_ad.tsv": { kind: 3, off: 0, len: 1 } } })] });
    const res = await post(e, { manifest: restricted });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/GSM2.*restricted/);
    expect(rows(e, "SELECT * FROM v2_sample")).toHaveLength(0);
    const huge = "x".repeat(8 * 1024 * 1024 + 10);
    expect((await post(e, huge)).status).toBe(413);
  });

  it("says which schema to apply when it is missing", async () => {
    const none = await env(null);
    const res = await post(none, { manifest: manifest(["GSM1"]) });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/schema\/032/);
    const old = await env(SCHEMA_032); // 032 as applied in production, 033 not yet
    const res2 = await post(old, { manifest: manifest(["GSM1"]) });
    expect(res2.status).toBe(503);
    expect(((await res2.json()) as { error: string }).error).toMatch(/schema\/033/);
    expect(rows(old, "SELECT * FROM v2_sample")).toHaveLength(0);
  });
});

describe("schema/033", () => {
  it("rebuilds a 032 table with its rows, allows two revs of a sample, and can be run again", async () => {
    const e = await env(SCHEMA_032);
    e.DB.raw.exec(`INSERT INTO v2_sample (gse_id, gsm_id, key, bytes, rev) VALUES ('GSE1', 'GSM1', 'v2/s/GSM1/${hex("a", 32)}.s2', 10, '${hex("1", 16)}')`);
    e.DB.raw.exec(SCHEMA_033);
    expect(rows(e, "SELECT gse_id, gsm_id, bytes, rev FROM v2_sample")).toEqual([{ gse_id: "GSE1", gsm_id: "GSM1", bytes: 10, rev: hex("1", 16) }]);
    e.DB.raw.exec(`INSERT INTO v2_sample (gse_id, gsm_id, key, bytes, rev) VALUES ('GSE1', 'GSM1', 'v2/s/GSM1/${hex("b", 32)}.s2', 11, '${hex("2", 16)}')`);
    e.DB.raw.exec(SCHEMA_033);
    expect(rows(e, "SELECT bytes, rev FROM v2_sample ORDER BY rev")).toEqual([{ bytes: 10, rev: hex("1", 16) }, { bytes: 11, rev: hex("2", 16) }]);
    const idx = rows(e, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'v2_sample'").map((r) => r.name);
    expect(idx).toContain("idx_v2_sample_gsm");
  });
});

describe("reads", () => {
  async function seeded() {
    const e = await env();
    await post(e, { manifest: manifest(["GSM1", "GSM2", "GSM3"]), migration: LIVE });
    await post(e, { manifest: manifest(["GSM9"], { gse: "GSE2", rev: hex("5", 16) }), migration: { status: "running" } }); // not served yet
    await post(e, { manifest: manifest(["GSM8"], { gse: "GSE3", rev: hex("6", 16) }) }); // no migration block: only uploaded
    await post(e, { manifest: manifest(["GSM7"], { gse: "GSE4", rev: hex("7", 16) }), migration: { status: "retired", verify_ok: true } });
    return e;
  }

  it("serves a study from v2 only while its migration is verified or retired", async () => {
    const e = await seeded();
    expect(await getV2State(e.DB, "GSE1")).toMatchObject({ study: { gse_id: "GSE1" }, migration: { status: "verified" } });
    expect(await getV2State(e.DB, "GSE2")).toBeNull();
    expect(await getV2State(e.DB, "GSE3")).toBeNull(); // uploaded
    expect(await getV2State(e.DB, "GSE4")).toMatchObject({ migration: { status: "retired" } });
    expect(await getV2State(e.DB, "GSE404")).toBeNull();
    expect([...(await v2ServedStudies(e.DB, ["GSE1", "GSE2", "GSE3", "GSE4", "GSE404", "GSE1"])).keys()].sort()).toEqual(["GSE1", "GSE4"]);
    expect(isServedFromV2({ status: "retired" })).toBe(true);
    expect(isServedFromV2({ status: "verified" })).toBe(true);
    expect(isServedFromV2({ status: "failed" })).toBe(false);
    expect(isServedFromV2({ status: "uploaded" })).toBe(false);
    expect(isServedFromV2(null)).toBe(false); // no migration row: not live
    // a study row with no migration row at all (inserted by hand) is not served either
    e.DB.raw.exec("DELETE FROM v2_migration WHERE gse_id = 'GSE1'");
    expect(await getV2State(e.DB, "GSE1")).toBeNull();
    expect((await getV2Migration(e.DB, "GSE2"))?.status).toBe("running");
    expect((await getV2Study(e.DB, "GSE2"))?.rev).toBe(hex("5", 16));
  });

  it("reads one sample with its members, and pages light rows without the JSON columns", async () => {
    const e = await seeded();
    const one = await getV2Sample(e.DB, "GSE1", "GSM2");
    expect(Object.keys(parseMembers(one?.members_json))).toContain("exon_counts.1pz");
    expect(parseModalities(one?.modalities)).toContain("exon_counts");
    expect(await getV2Sample(e.DB, "GSE1", "GSM404")).toBeNull();
    expect(await getV2Sample(e.DB, "GSE1", "GSM2", hex("9", 16))).toBeNull(); // another rev: nothing
    const page1 = await listV2Samples(e.DB, "GSE1", hex("1", 16), { limit: 2 });
    expect(page1.map((s) => s.gsm_id)).toEqual(["GSM1", "GSM2"]);
    expect(page1[0]).not.toHaveProperty("members_json");
    const page2 = await listV2Samples(e.DB, "GSE1", hex("1", 16), { limit: 2, after: "GSM2" });
    expect(page2.map((s) => s.gsm_id)).toEqual(["GSM3"]);
    expect(await listV2Samples(e.DB, "GSE1", hex("9", 16))).toEqual([]); // wrong rev: nothing
    expect((await getV2Samples(e.DB, "GSE1", ["GSM3", "GSM1", "GSM404"])).map((s) => s.gsm_id)).toEqual(["GSM1", "GSM3"]);
  });

  it("every read is a keyed lookup: no scan of v2_sample and no JSON column in the page query", async () => {
    const e = await seeded();
    const plan = (sql: string, ...args: unknown[]) =>
      (e.DB.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as never[])) as { detail: string }[]).map((r) => r.detail).join(" | ");
    expect(plan("SELECT gse_id FROM v2_sample WHERE gse_id = ? AND rev = ? AND gsm_id > ? ORDER BY gsm_id LIMIT ?", "GSE1", "r", "", 10)).toMatch(/SEARCH v2_sample USING (INDEX|PRIMARY KEY|COVERING INDEX) /);
    // the single-sample read, with the rev taken from the study row
    expect(plan("SELECT gse_id FROM v2_sample WHERE gse_id = ? AND gsm_id = ? AND rev = (SELECT rev FROM v2_study WHERE gse_id = ?)", "GSE1", "GSM1", "GSE1")).not.toMatch(/SCAN v2_sample/);
    expect(plan("SELECT gse_id FROM v2_sample WHERE gsm_id = ?", "GSM1")).toMatch(/idx_v2_sample_gsm/);
    expect(plan("DELETE FROM v2_sample WHERE gse_id = ? AND rev != ?", "GSE1", "r")).not.toMatch(/SCAN v2_sample/);
    // the list query selects no JSON column
    const prepared = spyOnPrepare(e);
    await listV2Samples(e.DB, "GSE1", hex("1", 16));
    expect(prepared.filter((s) => /FROM v2_sample/.test(s)).every((s) => !/members_json|cell_stats_json/.test(s))).toBe(true);
  });

  it("a served study costs exactly two statements: no table probe on the way", async () => {
    const e = await seeded();
    const sql = spyOnPrepare(e);
    await getV2State(e.DB, "GSE1");
    expect(sql.map((q) => /FROM (\w+)/.exec(q)![1])).toEqual(["v2_study", "v2_migration"]);
    sql.length = 0;
    await getV2State(e.DB, "GSE404"); // not migrated: one statement
    expect(sql).toHaveLength(1);
  });

  it("is quietly empty before schema/032 is applied", async () => {
    const e = await env(null);
    expect(await v2Available(e.DB)).toBe(false);
    expect(await getV2State(e.DB, "GSE1")).toBeNull();
    expect(await getV2Sample(e.DB, "GSE1", "GSM1")).toBeNull();
    expect(await listV2Samples(e.DB, "GSE1", "r")).toEqual([]);
    expect((await v2ServedStudies(e.DB, ["GSE1"])).size).toBe(0);
    // and costs one failed probe, not one per call
    const probes = spyOnPrepare(e);
    await getV2State(e.DB, "GSE1");
    await getV2State(e.DB, "GSE1");
    expect(probes).toHaveLength(0);
  });

  it("starts working once the schema appears", async () => {
    const e = await env(null);
    expect(await v2Available(e.DB)).toBe(false);
    e.DB.raw.exec(SCHEMA);
    // within the minute the 'no' is remembered; a new binding (a new isolate) probes again
    const fresh = Object.create(e.DB) as typeof e.DB;
    expect(await v2Available(fresh)).toBe(true);
  });
});
