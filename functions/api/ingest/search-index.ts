/**
 * POST /api/ingest/search-index — publish the cohort bit index (docs/COHORT-QUERY.md section 1) into the data
 * bucket (binding SINGLET_DATA, bucket singlet-data) under search-index/v1/, where /api/cohort/* reads it through
 * data.singlet.bio. Replaces the wrangler uploads, so the nightly Action needs only the ingest token.
 *
 * Auth: `X-Ingest-Token`, as the other /api/ingest routes (../../_shared/ingest-auth).
 *
 * Two calls, in this order (a reader never sees a dictionary whose binary is missing):
 *
 *   POST ?part=bin&name=index.<version>.sbix   body: the binary. Checked: name is index.<YYYYMMDD>-<fnv1a hex>.sbix,
 *                                              "SBIX" magic, format 1, header length == body length, FNV-1a of the body
 *                                              == the hex in the name, at most 64 MiB. Stored immutable.
 *   POST ?part=dict                            body: index.json. Checked: the named binary is in the bucket with the
 *                                              size and sample count the dictionary states. Then the current index.json
 *                                              is kept as previous.index.json, the new one becomes index.json, and
 *                                              binaries other than the new and the previous one are deleted.
 *
 * Rollback: copy previous.index.json over index.json (its binary is still there). A dictionary with under half the
 * samples of the current one is refused with 409 unless `&force=1`.
 */
import { BITINDEX_FORMAT, HEADER_BYTES, fnv1a, type IndexDict } from "../../_shared/bitindex";
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";

interface Env {
  SINGLET_DATA?: R2Bucket;
  INGEST_TOKEN_SHA256?: string;
}

const INDEX_PREFIX = "search-index/v1/";
const MAX_BIN_BYTES = 64 * 1024 * 1024;
const MAX_DICT_BYTES = 8 * 1024 * 1024;
const BIN_NAME_RE = /^index\.(\d{8})-([0-9a-f]{8})\.sbix$/;
const MAGIC = 0x58494253; // "SBIX" little endian

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function putBin(request: Request, bucket: R2Bucket, name: string): Promise<Response> {
  const m = BIN_NAME_RE.exec(name);
  if (!m) return json({ error: "name must look like index.<YYYYMMDD>-<8 hex>.sbix" }, 400);
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BIN_BYTES) return json({ error: "Body exceeds 64 MiB" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BIN_BYTES) return json({ error: "Body exceeds 64 MiB" }, 413);
  if (body.byteLength < HEADER_BYTES) return json({ error: "Body is shorter than the 32-byte header" }, 400);
  const h = new DataView(body);
  if (h.getUint32(0, true) !== MAGIC || h.getUint32(4, true) !== BITINDEX_FORMAT) return json({ error: "Not a bit index (magic or format)" }, 400);
  if (h.getUint32(16, true) !== body.byteLength) return json({ error: "Header length does not match the body" }, 400);
  const sum = fnv1a(new Uint8Array(body)).toString(16).padStart(8, "0");
  if (sum !== m[2]) return json({ error: "Checksum does not match the name" }, 400);
  const nSamples = h.getUint32(8, true);
  await bucket.put(INDEX_PREFIX + name, body, {
    httpMetadata: { contentType: "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { n_samples: String(nSamples) },
  });
  return json({ ok: true, bin: name, bytes: body.byteLength, n_samples: nSamples }, 200);
}

async function putDict(request: Request, bucket: R2Bucket, force: boolean): Promise<Response> {
  const text = await request.text();
  if (text.length === 0 || text.length > MAX_DICT_BYTES) return json({ error: "Dictionary is empty or over 8 MiB" }, 400);
  let dict: IndexDict;
  try {
    dict = JSON.parse(text) as IndexDict;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const m = typeof dict?.bin === "string" ? BIN_NAME_RE.exec(dict.bin) : null;
  if (!m || dict.format !== BITINDEX_FORMAT) return json({ error: "Not an index dictionary (bin or format)" }, 400);
  if (dict.index_version !== `${m[1]}-${m[2]}` || dict.checksum !== m[2]) return json({ error: "Dictionary version or checksum does not match its binary name" }, 400);
  if (!Number.isInteger(dict.n_samples) || dict.n_samples < 1 || !Array.isArray(dict.studies) || !Array.isArray(dict.attrs)) {
    return json({ error: "Dictionary is missing n_samples, studies or attrs" }, 400);
  }

  const bin = await bucket.head(INDEX_PREFIX + dict.bin);
  if (!bin) return json({ error: "Upload the binary first (?part=bin)" }, 409);
  if (bin.size !== dict.bytes || bin.customMetadata?.n_samples !== String(dict.n_samples)) {
    return json({ error: "Stored binary does not match the dictionary's size or sample count" }, 409);
  }

  const currentObj = await bucket.get(INDEX_PREFIX + "index.json");
  const currentText = currentObj ? await currentObj.text() : null;
  let current: IndexDict | null = null;
  try {
    current = currentText ? (JSON.parse(currentText) as IndexDict) : null;
  } catch {
    current = null;
  }
  if (current && !force && dict.n_samples * 2 < current.n_samples) {
    return json({ error: `Refusing: ${dict.n_samples} samples against ${current.n_samples} now; add force=1 to publish anyway` }, 409);
  }

  let previousBin = current?.bin ?? null;
  if (current && currentText !== null && current.bin !== dict.bin) {
    await bucket.put(INDEX_PREFIX + "previous.index.json", currentText, { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
  } else if (current?.bin === dict.bin) {
    // Same binary republished: the previous pointer stays as it was.
    const prev = await bucket.get(INDEX_PREFIX + "previous.index.json");
    try {
      previousBin = prev ? (JSON.parse(await prev.text()) as IndexDict).bin : null;
    } catch {
      previousBin = null;
    }
  }
  await bucket.put(INDEX_PREFIX + "index.json", text, { httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=300" } });

  const keep = new Set([dict.bin, previousBin]);
  const listed = await bucket.list({ prefix: INDEX_PREFIX + "index." });
  const stale = listed.objects.map((o) => o.key).filter((k) => k.endsWith(".sbix") && !keep.has(k.slice(INDEX_PREFIX.length)));
  if (stale.length) await bucket.delete(stale);
  return json({ ok: true, index_version: dict.index_version, bin: dict.bin, n_samples: dict.n_samples, previous: previousBin, deleted: stale.length }, 200);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const bucket = env.SINGLET_DATA;
  if (!bucket) return json({ error: "SINGLET_DATA bucket is not bound" }, 503);

  const url = new URL(request.url);
  const part = url.searchParams.get("part");
  try {
    if (part === "bin") return await putBin(request, bucket, url.searchParams.get("name") ?? "");
    if (part === "dict") return await putDict(request, bucket, url.searchParams.get("force") === "1");
    return json({ error: "part must be bin or dict" }, 400);
  } catch (e) {
    return serverError(e, "search-index publish", { part });
  }
};
