// data.singlet.bio/data/*: guard in front of the public R2 custom domain for legacy .singlet bundles (Research Alpha).
// Deployed by the owner, never by CI: `npx wrangler deploy` from this directory. See README.md.
//
// Allowed requests are passed to the origin unchanged (fetch(request)), so CORS, ETag and Range behaviour stay R2's own.
// The Worker reads only the bundle's central directory, through the R2 binding, to see which members a request touches.
import { classify, isWithheld, POLICY_VERSION } from "./policy";
import { membersInRange, readZipIndex, type ZipIndex } from "./zip";

interface Env {
  DATA: R2Bucket;
}

const KEY_RE = /^\/data\/(GSE\d+)\/([^/]+)$/;
const cache = new Map<string, ZipIndex>();
const CACHE_MAX = 256;

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body + "\n", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Served-By": "data-guard", "X-Alpha-Policy": POLICY_VERSION, ...extra },
  });
}

async function zipIndex(env: Env, key: string): Promise<ZipIndex | null> {
  const head = await env.DATA.head(key);
  if (!head) return null;
  const ck = `${key}@${head.etag}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const idx = await readZipIndex(head.size, async (s, e) => {
    const o = await env.DATA.get(key, { range: { offset: s, length: e - s + 1 } });
    if (!o) throw new Error("range read failed");
    return new Uint8Array(await o.arrayBuffer());
  });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(ck, idx);
  return idx;
}

/** [start, endInclusive] for a single-range header, null if absent, "bad" if unsupported. */
function parseRange(h: string | null, size: number): [number, number] | null | "bad" {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "bad";
  if (m[1] === "") {
    const n = Math.min(Number(m[2]), size);
    return [size - n, size - 1];
  }
  const s = Number(m[1]);
  const e = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return s > e ? "bad" : [s, e];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = KEY_RE.exec(url.pathname);
    if (!m) return fetch(request);
    const [, gse, file] = m;
    if (isWithheld(gse)) return text(404, "Not found");
    if (request.method === "OPTIONS" || request.method === "HEAD" || !file.endsWith(".singlet")) return fetch(request);
    if (request.method !== "GET") return text(405, "Method not allowed", { Allow: "GET, HEAD, OPTIONS" });

    let idx: ZipIndex | null;
    try {
      idx = await zipIndex(env, url.pathname.slice(1));
    } catch {
      return text(503, "This file is temporarily unavailable.", { "Retry-After": "3600" });
    }
    if (!idx) return fetch(request);

    const range = parseRange(request.headers.get("Range"), idx.size);
    if (range === "bad") return text(416, "Only one byte range per request is supported.");

    if (range === null) {
      // Whole-file download: refuse while the file still holds members that are not part of Alpha. Per-cell mtDNA
      // allele layers are in every legacy bundle; they are removed by the Alpha repack, not by this check.
      const blocked = idx.members.some((x) => {
        const v = classify(x.name);
        return v === "excluded" || (v === "private" && !/(^|\/)(mt_heteroplasmy\.1pz|mt_variants\.tsv)$/.test(x.name));
      });
      if (blocked)
        return text(503, "This study file is being repackaged for Singlet Research Alpha. Full downloads return shortly; ranged reads of its public members work now.", {
          "Retry-After": "86400",
        });
      return fetch(request);
    }

    const [s, e] = range;
    for (const x of membersInRange(idx, s, e)) {
      const v = classify(x.name);
      if (v === "excluded") return text(404, "Not found");
      if (v === "private") return text(403, "This part of the file is not public.");
    }
    return fetch(request);
  },
};
