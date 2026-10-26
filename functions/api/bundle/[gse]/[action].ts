/**
 * GET /api/bundle/:gse/index    → what is inside the study's .singlet file
 * GET /api/bundle/:gse/samples  → per-sample QC from each summary.json (D1-cached)
 * GET /api/bundle/:gse/entry?path=…
 *      ≤ 4 MB uncompressed  → the inflated file itself
 *      larger               → JSON range recipe so one sample's matrix can be
 *                             pulled out of a multi-GB study file
 *
 * The bundle is read over HTTP Range requests against data.singlet.bio; the
 * central directory is memoised in D1 (`bundle_index`). A cached index can outlive the file it
 * describes (the object is overwritten in place), so every entry read checks the zip local header
 * and sends If-Match; on a mismatch the index is re-read once (bundle-reader.ts, withIndexRetry).
 *
 * Edge-cache keys carry a version: bump it whenever cached answers may be wrong (v2 of `entry`
 * and v2 of `samples` drop the recipes cached from stale offsets; `index` was already v2; index v4, samples v3 and
 * entry v3 are the Research Alpha rule: no withheld study, excluded sample or hidden layer).
 *
 * Research Alpha (../../../_shared/alpha): a withheld study answers 404 like an unknown one, and a sample that is not
 * part of the atlas, or a layer Alpha does not offer, is not listed and has no entry.
 */
import { corsOk, corsErr, handleOptions, CORS_HEADERS } from "../../../_shared/cors";
import { serverError } from "../../../_shared/errors";
import { checkIngestToken } from "../../../_shared/ingest-auth";
import { CACHE_TTL_HEADER, cachedJson } from "../../../_shared/cache";
import { GSE_RE, bundleUrl } from "../../../_shared/study-core";
import { StaleBundleError, getBundleIndex, readEntry, entryRange, strongEtag, withIndexRetry, MAX_INFLATE_BYTES } from "../../../_shared/bundle-reader";
import { isUnofferedMember } from "../../../_shared/restricted";
import { entryContext, isStudyWithheld, servedEntries } from "../../../_shared/alpha";
import { bundleIndexResponse, loadSampleQc, publicQc, v2BundleIndexResponse } from "../../../_shared/bundle-core";
import { getV2Presence, getV2Sample, parseMembers, servedState, type V2Presence } from "../../../_shared/v2-catalog";
import { describeMember, findMember, sampleObjectUrl } from "../../../_shared/v2-serve";
import { configureV2 } from "../../../_shared/v2-urls";

interface Env {
  DB: D1Database;
  INGEST_TOKEN_SHA256?: string;
  V2_ORIGIN?: string;
}

const DAY = 86400;
/**
 * A study that has a row in the v2 catalog, served or still being moved, is cached at the edge for five minutes and not a day: its answer changes
 * when the migration is verified or retired. (The keys carry no v2 rev: that would cost a D1 read before every cache lookup.)
 */
const V2_EDGE_TTL = 300;
const ttlFor = (p: V2Presence): Record<string, string> => (p.study || p.migration ? { [CACHE_TTL_HEADER]: String(V2_EDGE_TTL) } : {});

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

  configureV2(env);
  const url = new URL(request.url);
  // ?refresh=1 re-reads the file and rewrites the cached index. It is for the
  // catalog crank, so it needs the ingest token; for everyone else it is ignored.
  const refresh = url.searchParams.get("refresh") === "1" && (await checkIngestToken(request, env)).ok;

  // A forced refresh has to reach the producer, so it skips the edge cache.
  const cached: typeof cachedJson = refresh ? (_request, _waitUntil, producer) => producer() : cachedJson;
  // Not cached at the edge on purpose: a study withheld after a response was cached must stop answering at once.
  if (await isStudyWithheld(env.DB, gse)) return corsErr(`Series ${gse} not found`, 404);

  if (action === "index") {
    return cached(
      request,
      waitUntil,
      async () => {
        try {
          // A study stored in the v2 layout is listed from the v2 catalog.
          const pres = await getV2Presence(env.DB, gse);
          const v2 = servedState(pres);
          if (v2) return corsOk(await v2BundleIndexResponse(env.DB, gse, v2), { headers: ttlFor(pres) });
          // verify: one HEAD compares the cached row with the live object, so the size and listing are not
          // those of a file that has since been overwritten. The answer is edge-cached for a day.
          const index = await getBundleIndex(env.DB, gse, { refresh, verify: true, waitUntil });
          return corsOk(await bundleIndexResponse(env.DB, gse, index, waitUntil), { headers: ttlFor(pres) });
        } catch (e) {
          return serverError(e, `bundle index ${gse}`, {}, 502);
        }
      },
      { ttl: DAY, key: "v=4" } // one cache entry per study: extra query parameters must not mint new ones
    );
  }

  if (action === "samples") {
    return cached(
      request,
      waitUntil,
      async () => {
        try {
          const { source, samples } = await loadSampleQc(env.DB, gse, { refresh, waitUntil });
          return corsOk({ gse_id: gse, source, n_samples: samples.length, samples: samples.map(publicQc) });
        } catch (e) {
          return serverError(e, `bundle samples ${gse}`, {}, 502);
        }
      },
      { ttl: DAY, key: "v=3" }
    );
  }

  if (action === "entry") {
    const path = url.searchParams.get("path") ?? "";
    if (!path) return corsErr("path is required", 400);
    // An entry never changes under the same study file, so one cache entry per (study, path).
    const produce = async (): Promise<Response> => {
      try {
        const pres = await getV2Presence(env.DB, gse);
        const v2 = servedState(pres);
        if (v2) return await v2Entry(env.DB, gse, v2.study.rev, path, ttlFor(pres));
        const found = await withIndexRetry(env.DB, gse, { waitUntil }, async (index) => {
          const entry = (await servedEntries(env.DB, gse, index.entries)).find((e) => e.p === path);
          if (!entry) return null;
          if (entry.u > MAX_INFLATE_BYTES) return { entry, index, range: await entryRange(gse, entry, index), body: null };
          return { entry, index, range: null, body: await readEntry(gse, entry, index) };
        });
        if (!found) return corsErr(`No entry '${path}' in ${gse}.singlet`, 404);
        const { entry, index, range, body } = found;

        if (range) {
          const { url: fileUrl, start, end } = range;
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
            // Send as `If-Match` with the range: if the file is overwritten later, the read fails (412) instead of returning other bytes.
            etag: strongEtag(range.etag ?? index.etag),
            how,
            note: "Too large to return at the edge. Pull just this byte range — you never download the whole study file. The Python and R packages always download the whole study; this endpoint is the way to take one sample.",
          }, { headers: ttlFor(pres) });
        }

        return new Response(body as unknown as ArrayBuffer, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentTypeFor(path),
            "Cache-Control": `public, max-age=${DAY}, s-maxage=${DAY}`,
            ...ttlFor(pres),
          },
        });
      } catch (e) {
        // The index and the file still disagree after one refresh: the file is being replaced. Not cached; retry shortly.
        if (e instanceof StaleBundleError) {
          return corsErr(`The index of ${gse}.singlet did not match the file and was refreshed; retry in a minute.`, 409);
        }
        return serverError(e, `bundle entry ${gse}`, {}, 502);
      }
    };
    return cachedJson(request, waitUntil, produce, { ttl: DAY, key: `v=3&path=${encodeURIComponent(path)}` });
  }

  return corsErr(`Unknown bundle action '${action}'. Use index, samples or entry.`, 400);
};

/**
 * An entry of a study stored in the v2 layout: no inflating at the edge (the members are zstd or pz2), just where the bytes are. A derived
 * member (regenerated by a recipe) has none; the singlet package rebuilds it.
 */
async function v2Entry(db: D1Database, gse: string, rev: string, path: string, ttl: Record<string, string>): Promise<Response> {
  const m = /^samples\/(GSM\d+)\/(.+)$/.exec(path);
  if (!m) return corsErr(`No entry '${path}' in ${gse}: study-level files are inside the v2 manifest (v2/m/${gse}.json).`, 404);
  const ctx = await entryContext(db, gse);
  if (ctx.excluded.has(m[1]) || isUnofferedMember(m[2], ctx)) return corsErr(`No entry '${path}' in ${gse}`, 404);
  const sample = await getV2Sample(db, gse, m[1], rev);
  const members = parseMembers(sample?.members_json);
  const name = sample ? findMember(members, m[2]) : null;
  if (!sample || !name) return corsErr(`No entry '${path}' in ${gse}`, 404);
  const d = describeMember(name, members[name]);
  return corsOk({
    gse_id: gse,
    path,
    format: "singlet-v2",
    url: sampleObjectUrl(sample.key),
    range: d.range,
    method: d.kind === 1 ? "pz2" : d.kind === 3 ? "zstd" : d.kind === 5 ? "stored" : "derived",
    bytes_compressed: d.bytes,
    bytes_uncompressed: d.legacy_bytes ?? null,
    member: d,
    note:
      d.kind === 4
        ? "Nothing is stored for this file: it is regenerated from other members by the singlet package."
        : "The sample object is immutable, so this range never changes. Decode with the singlet package (singlet.load) or see the MCP tools get_partial_download and slice_cells.",
  }, { headers: ttl });
}

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();

export { bundleUrl };
