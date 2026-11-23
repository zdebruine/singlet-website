/**
 * Run the export route (src/export.ts) in Node against the live objects on data.singlet.bio: the bucket is read over HTTPS, so the real
 * index, plan blocks, packs and sample objects go through the same code the Worker runs. For checking an export before a deploy.
 *
 *   npx esbuild workers/data/scripts/export-live.ts --bundle --platform=node --format=esm --outfile=workers/data/.local/export-live.mjs
 *   node workers/data/.local/export-live.mjs '<where JSON>' out.zip [max_cells] [genes,comma,separated] [format]
 *
 * The cells are the first page of https://singlet.bio/api/cells/slice for the filter.
 */
import { writeFileSync } from "node:fs";
import type { Deps, R2BucketLike, R2RangeLike } from "../src/handler";
import { DEFAULT_LIMITS } from "../src/limits";
import { runExport } from "../src/export";

const ORIGIN = "https://data.singlet.bio";

const bucket: R2BucketLike = {
  async get(key: string, options?: { range?: R2RangeLike }) {
    const headers: Record<string, string> = {};
    const r = options?.range;
    if (r) headers.Range = r.suffix !== undefined ? `bytes=-${r.suffix}` : `bytes=${r.offset ?? 0}-${r.length !== undefined ? (r.offset ?? 0) + r.length - 1 : ""}`;
    const res = await fetch(`${ORIGIN}/${key}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
    const size = Number((res.headers.get("content-range") ?? "").split("/")[1] ?? res.headers.get("content-length"));
    return { size, httpEtag: res.headers.get("etag") ?? '"x"', uploaded: new Date(), body: res.body! };
  },
  async head(key: string) {
    const res = await fetch(`${ORIGIN}/${key}`, { method: "HEAD" });
    if (!res.ok) return null;
    return { size: Number(res.headers.get("content-length")), httpEtag: res.headers.get("etag") ?? '"x"', uploaded: new Date() };
  },
};

const [where, out, maxCells = "2000", genes = "", format = "mtx"] = process.argv.slice(2);
const page = (await (await fetch(`https://singlet.bio/api/cells/slice?${new URLSearchParams({ where, page_cells: maxCells })}`)).json()) as { cells: [string, number[]][]; index_version: string; message?: string };
if (!page.cells) throw new Error(page.message ?? "no cells");
console.log(`page: ${page.cells.reduce((n, c) => n + c[1].length, 0)} cells in ${page.cells.length} samples, index ${page.index_version}`);
const pending: Promise<unknown>[] = [];
const deps: Deps = { bucket, cache: null, waitUntil: (p) => void pending.push(p) };
const L = DEFAULT_LIMITS.key;
const t0 = performance.now();
const res = await runExport(
  {
    deps,
    limits: { maxCells: L.maxCellsPerRequest, maxStudies: L.maxStudiesPerRequest, maxSamples: L.maxSamplesPerGather, maxBytes: L.maxBytesPerGather, maxReads: L.maxReadsPerRequest, maxCostUsd: L.maxCostUsd, maxRowsScanned: L.maxRowsScanned },
    waitUntil: deps.waitUntil,
  },
  { version: page.index_version, cells: page.cells, genes: genes ? genes.split(",") : undefined, format: format as "mtx" | "summary", name: "cells", provenance: { where } }
);
const buf = new Uint8Array(await res.arrayBuffer());
await Promise.all(pending);
writeFileSync(out, buf);
console.log(`HTTP ${res.status}, ${buf.length} bytes in ${(performance.now() - t0).toFixed(0)} ms; headers ${JSON.stringify(Object.fromEntries(res.headers))}`);
if (format === "summary") console.log(new TextDecoder().decode(buf).slice(0, 3000));
