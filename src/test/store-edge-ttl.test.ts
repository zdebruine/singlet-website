// @vitest-environment node
/**
 * Edge cache lifetime of /api/bundle/:gse/index and /entry. A study with a row in the catalog (served, or still being moved) is stored for
 * five minutes, not the day a legacy answer gets, so a rev change or a status change reaches readers soon. Cache API replaced by a recorder.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBundleIndex = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/bundle-reader", async (orig) => ({ ...(await orig<object>()), getBundleIndex }));

import { sha256Hex } from "../../functions/_shared/hash";
import { configureStore } from "../../functions/_shared/store-urls";
import { onRequestGet as bundleGet } from "../../functions/api/bundle/[gse]/[action]";
import { onRequestPost as ingestPost } from "../../functions/api/ingest/store-study";
import { createTestD1 } from "./helpers/d1-sqlite";

const TOKEN = "t";
const SAMPLE = JSON.parse(readFileSync("src/test/fixtures/store/sample/GSM1000001.manifest.json", "utf8"));
const hex = (c: string, n: number) => c.repeat(n);
const SCHEMA = readFileSync("schema/032_v2_catalog.sql", "utf8") + readFileSync("schema/033_v2_sample_rev_key.sql", "utf8") + readFileSync("schema/036_store_rename.sql", "utf8") + readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, "") + `
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_files INTEGER, n_gsms_in_bundle INTEGER, manifest_n_gsms INTEGER, gsm_ids TEXT, manifest_created_at TEXT,
  audited_at TEXT, reference_build TEXT, singlet_version TEXT);
`;

type Stored = { url: string; cacheControl: string | null };
let stored: Stored[];
let store: Map<string, Response>;

beforeEach(() => {
  configureStore(undefined);
  stored = [];
  store = new Map();
  vi.stubGlobal("caches", {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => {
        stored.push({ url: req.url, cacheControl: res.headers.get("Cache-Control") });
        store.set(req.url, res);
      },
    },
  });
  getBundleIndex.mockReset();
  getBundleIndex.mockResolvedValue({ gse_id: "GSE9", bytes: 1000, entries: [], indexed_at: "2026-10-01T00:00:00Z", etag: '"e1"' });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  return { DB: createTestD1(SCHEMA), INGEST_TOKEN_SHA256: await sha256Hex(TOKEN) };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function ingest(env: Env, gse: string, rev: string, migration: Record<string, unknown>) {
  const manifest = {
    format: "singlet-store", manifest_version: 1, gse, rev, created_at: "2026-10-23T08:00:00Z", reference_build: "GRCh38-2024-A",
    pipeline: { singlet_version: "0.9.1" }, samples: [{ ...SAMPLE, gsm: "GSM1000001", key: `store/s/GSM1000001/${hex("a", 32)}.s1` }], legacy: { bytes: 5000 },
  };
  const request = new Request("https://singlet.bio/api/ingest/store-study", { method: "POST", headers: { "x-ingest-token": TOKEN }, body: JSON.stringify({ manifest, manifest_bytes: 4321, final: true, migration }) });
  const res = await ingestPost({ request, env, params: {}, waitUntil: () => undefined } as never);
  expect(res.status, await res.clone().text()).toBe(200);
}

async function bundle(env: Env, gse: string, action: string, query = "") {
  const request = new Request(`https://singlet.bio/api/bundle/${gse}/${action}${query}`);
  const pending: Promise<unknown>[] = [];
  const res = await bundleGet({ request, env, params: { gse, action }, waitUntil: (p: Promise<unknown>) => pending.push(p) } as never);
  await Promise.all(pending);
  return res;
}

const maxAge = (cc: string | null) => Number(/max-age=(\d+)/.exec(cc ?? "")?.[1]);

describe("edge lifetime of the bundle index and entry answers", () => {
  it("a legacy study (no store rows) keeps the day", async () => {
    const env = await setup();
    const res = await bundle(env, "GSE9", "index");
    expect(res.status).toBe(200);
    expect(maxAge(res.headers.get("Cache-Control"))).toBe(86400);
    expect(res.headers.has("X-Singlet-Cache-Ttl")).toBe(false);
    expect(maxAge(stored[0].cacheControl)).toBe(86400);
  });

  it("a study served from store is stored for five minutes: index and entry", async () => {
    const env = await setup();
    await ingest(env, "GSE9", hex("1", 16), { status: "verified", verify_ok: true });
    const index = await bundle(env, "GSE9", "index");
    expect(index.status).toBe(200);
    expect(((await index.json()) as { format: string }).format).toBe("singlet-store");
    expect(maxAge(index.headers.get("Cache-Control"))).toBe(300);
    expect(index.headers.has("X-Singlet-Cache-Ttl")).toBe(false);
    const entry = await bundle(env, "GSE9", "entry", "?path=samples/GSM1000001/exon_counts.1pz");
    expect(entry.status).toBe(200);
    expect(maxAge(entry.headers.get("Cache-Control"))).toBe(300);
    expect(stored.map((s) => maxAge(s.cacheControl))).toEqual([300, 300]);
  });

  it("a study that is only uploaded or being moved (it has a migration row) is still stored for five minutes, from the legacy file", async () => {
    const env = await setup();
    for (const status of ["uploaded", "running", "failed"]) {
      store.clear();
      stored.length = 0;
      await ingest(env, "GSE9", hex("1", 16), { status });
      const res = await bundle(env, "GSE9", "index");
      expect(res.status, status).toBe(200);
      expect(((await res.json()) as { format?: string }).format, status).toBeUndefined(); // answered from the legacy index
      expect(maxAge(stored[0].cacheControl), status).toBe(300);
    }
    expect(getBundleIndex).toHaveBeenCalled();
  });
});
