// @vitest-environment node
import { describe, expect, it } from "vitest";
import { onRequestDelete } from "../../functions/api/ingest/s1-delete";
import { sha256Hex } from "../../functions/_shared/hash";

const D = "0123456789abcdef0123456789abcdef";
const KEY = `s1/s/GSM1/${D}.s1`;
const LABEL = `s1/a/GSM1/${D}.parquet`;

async function call(url: string, opts: { channel?: string; token?: string; refs?: Set<string>; stored?: Set<string> } = {}) {
  const stored = opts.stored ?? new Set([KEY, LABEL, "s1/m/GSE1.json"]);
  const deleted: string[] = [];
  const sql: string[] = [];
  const stmt = (q: string) => ({
    bind: (...a: unknown[]) => ({
      all: async () => ({ results: q.includes("FROM s1_sample WHERE gse_id") ? [{ gsm_id: "GSM1", key: KEY, rev: "r" }] : [] }),
      first: async () => (opts.refs?.has(String(a[0])) ? { x: 1 } : null),
      run: async () => ({ meta: { changes: 1 } }),
      q,
    }),
  });
  const env = {
    CHANNEL: opts.channel ?? "beta",
    INGEST_TOKEN_SHA256: await sha256Hex("tok"),
    SINGLET_DATA: {
      head: async (k: string) => (stored.has(k) ? { size: 7 } : null),
      delete: async (k: string) => void deleted.push(k),
    },
    DB: {
      prepare: (q: string) => stmt(q),
      batch: async (s: { q: string }[]) => (sql.push(...s.map((x) => x.q)), s.map(() => ({ meta: { changes: 1 } }))),
    },
  };
  const request = new Request(`https://beta.singlet.bio/api/ingest/s1-delete?${url}`, { method: "DELETE", headers: { "X-Ingest-Token": opts.token ?? "tok" } });
  const res = await onRequestDelete({ request, env } as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, deleted, sql };
}

describe("beta delete", () => {
  it("is beta-only and token-checked", async () => {
    expect((await call("gse=GSE1&apply=1", { channel: "" })).status).toBe(403);
    expect((await call("gse=GSE1&apply=1", { channel: "alpha" })).status).toBe(403);
    expect((await call("gse=GSE1&apply=1", { token: "nope" })).status).toBe(401);
  });

  it("deletes nothing without apply=1", async () => {
    const s = await call("gse=GSE1");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ dry_run: true, sample_rows: 1, objects: [KEY] });
    expect(s.deleted).toEqual([]);
    expect(s.sql).toEqual([]);
    const o = await call(`key=${KEY}`);
    expect(o.body).toMatchObject({ dry_run: true, exists: true });
    expect(o.deleted).toEqual([]);
  });

  it("removes the manifest and the study rows, not the objects", async () => {
    const s = await call("gse=GSE1&apply=1");
    expect(s.deleted).toEqual(["s1/m/GSE1.json"]);
    expect(s.sql.map((q) => /DELETE FROM (\w+)/.exec(q)![1])).toEqual(["s1_sample", "s1_migration", "s1_study"]);
    expect(s.body).toMatchObject({ deleted: true, objects: [KEY] });
  });

  it("removes only unreferenced sample and label objects", async () => {
    expect((await call(`key=${KEY}&apply=1`, { refs: new Set([KEY]) })).status).toBe(409);
    expect((await call(`key=${LABEL}&apply=1`, { refs: new Set(["GSM1"]) })).status).toBe(409);
    const ok = await call(`key=${KEY}&apply=1`);
    expect(ok.status).toBe(200);
    expect(ok.deleted).toEqual([KEY]);
    expect((await call(`key=s1/ref/${D}.pack&apply=1`)).status).toBe(422);
    expect((await call(`key=private/GSM1/x.vcf&apply=1`)).status).toBe(422);
    expect((await call("apply=1")).status).toBe(400);
    expect((await call(`gse=GSE1&key=${KEY}&apply=1`)).status).toBe(400);
  });
});
