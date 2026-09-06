/**
 * GET /api/bundle/:gse/index    → what is inside the study's .singlet file
 * GET /api/bundle/:gse/samples  → per-sample QC from each summary.json (D1-cached)
 * GET /api/bundle/:gse/entry?path=…
 *      ≤ 4 MB uncompressed  → the inflated file itself
 *      larger               → JSON range recipe so one sample's matrix can be
 *                             pulled out of a multi-GB study file
 *
 * The bundle is read over HTTP Range requests against data.singlet.bio; the
 * central directory is memoised in D1 (`bundle_index`).
 */
import { corsOk, corsErr, handleOptions, CORS_HEADERS } from "../../../_shared/cors";
import { cachedJson } from "../../../_shared/cache";
import { GSE_RE, bundleUrl } from "../../../_shared/study-core";
import { getBundleIndex, readEntry, entryRange, MAX_INFLATE_BYTES } from "../../../_shared/bundle-reader";
import { bundleIndexResponse, loadSampleQc } from "../../../_shared/bundle-core";

interface Env {
  DB: D1Database;
}

const DAY = 86400;

function contentTypeFor(path: string): string {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".tsv")) return "text/tab-separated-values; charset=utf-8";
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (path.endsWith(".out") || path.endsWith(".txt") || path.endsWith(".log")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) => {
  const gse = String(params.gse ?? "").toUpperCase();
  const action = String(params.action ?? "");
  if (!GSE_RE.test(gse)) return corsErr("Invalid series id", 400);

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  if (action === "index") {
    return cachedJson(
      request,
      waitUntil,
      async () => {
        try {
          const index = await getBundleIndex(env.DB, gse, { refresh, waitUntil });
          return corsOk(await bundleIndexResponse(env.DB, gse, index, waitUntil));
        } catch (e) {
          return corsErr(`Could not read ${gse}.singlet: ${String(e)}`, 502);
        }
      },
      DAY
    );
  }

  if (action === "samples") {
    return cachedJson(
      request,
      waitUntil,
      async () => {
        try {
          const { source, samples } = await loadSampleQc(env.DB, gse, { refresh, waitUntil });
          return corsOk({ gse_id: gse, source, n_samples: samples.length, samples });
        } catch (e) {
          return corsErr(`Could not read per-sample QC for ${gse}: ${String(e)}`, 502);
        }
      },
      DAY
    );
  }

  if (action === "entry") {
    const path = url.searchParams.get("path") ?? "";
    if (!path) return corsErr("path is required", 400);
    try {
      const index = await getBundleIndex(env.DB, gse, { waitUntil });
      const entry = index.entries.find((e) => e.p === path);
      if (!entry) return corsErr(`No entry '${path}' in ${gse}.singlet`, 404);

      if (entry.u > MAX_INFLATE_BYTES) {
        const { url: fileUrl, start, end } = await entryRange(gse, entry);
        const method = entry.n === 8 ? "deflate-raw" : "stored";
        const how =
          method === "stored"
            ? `curl -r ${start}-${end} "${fileUrl}" -o ${path.split("/").pop()}`
            : `curl -r ${start}-${end} "${fileUrl}" | python -c "import sys,zlib; sys.stdout.buffer.write(zlib.decompress(sys.stdin.buffer.read(), -15))" > ${path.split("/").pop()}`;
        return corsOk({
          gse_id: gse,
          path,
          url: fileUrl,
          range: `bytes=${start}-${end}`,
          method,
          bytes_compressed: entry.c,
          bytes_uncompressed: entry.u,
          how,
          note: "Too large to inflate at the edge. Pull just this byte range — you never download the whole study file. The Python and R packages will expose the same thing as singlet.load(\"" + gse + '", samples=[...]).',
        });
      }

      const body = await readEntry(gse, entry);
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": contentTypeFor(path),
          "Cache-Control": `public, max-age=${DAY}, s-maxage=${DAY}`,
        },
      });
    } catch (e) {
      return corsErr(`Could not read entry: ${String(e)}`, 502);
    }
  }

  return corsErr(`Unknown bundle action '${action}'. Use index, samples or entry.`, 400);
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();

export { bundleUrl };
