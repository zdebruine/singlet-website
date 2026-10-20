/**
 * Loads the bit index once per Worker isolate.
 *
 * The index is two public files written by scripts/search-index/build-index.ts and uploaded to the data bucket:
 * `index.json` (the dictionary, small, re-checked every few minutes) and `index.<version>.sbix` (the binary,
 * immutable, fetched when the version changes). Pages Functions have no read binding on that bucket, so both go
 * through the public domain, which Cloudflare serves from cache.
 */
import { BitIndex, loadBitIndex, type IndexDict } from "./bitindex";
import type { AppEnv } from "./env";

export interface CohortEnv extends AppEnv {
  /** Base URL of the published index files (default https://data.singlet.bio/search-index/v1). */
  SEARCH_INDEX_BASE?: string;
}

export const DEFAULT_INDEX_BASE = "https://data.singlet.bio/search-index/v1";
const RECHECK_MS = 5 * 60 * 1000;

export class IndexUnavailable extends Error {}

let memo: { index: BitIndex; checkedAt: number } | null = null;
let loading: Promise<BitIndex> | null = null;

/** Tests and local tooling: install an index (or clear it with null). */
export function setBitIndex(index: BitIndex | null): void {
  memo = index ? { index, checkedAt: Date.now() } : null;
  loading = null;
}

async function fetchOk(url: string, ttl: number): Promise<Response> {
  const res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new IndexUnavailable(`${url} returned ${res.status}`);
  return res;
}

async function refresh(base: string): Promise<BitIndex> {
  const dict = (await (await fetchOk(`${base}/index.json`, 300)).json()) as IndexDict;
  if (memo && memo.index.version === dict.index_version) {
    memo.checkedAt = Date.now();
    return memo.index;
  }
  const bytes = await (await fetchOk(`${base}/${dict.bin}`, 86400)).arrayBuffer();
  const index = loadBitIndex(bytes, dict);
  memo = { index, checkedAt: Date.now() };
  return index;
}

/** The current index, or throws IndexUnavailable when none has been published or loaded yet. */
export async function getBitIndex(env: CohortEnv): Promise<BitIndex> {
  if (memo && Date.now() - memo.checkedAt < RECHECK_MS) return memo.index;
  const base = (env.SEARCH_INDEX_BASE || DEFAULT_INDEX_BASE).replace(/\/+$/, "");
  loading = loading ?? refresh(base).finally(() => (loading = null));
  try {
    return await loading;
  } catch (e) {
    // Keep serving the copy we have if a re-check fails.
    if (memo) return memo.index;
    throw e instanceof IndexUnavailable ? e : new IndexUnavailable(String(e));
  }
}
