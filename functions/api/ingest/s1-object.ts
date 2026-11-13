/**
 * Rolling ingest, step 1: PUT one immutable object into the Beta bucket (binding SINGLET_DATA). Beta channel only (403 elsewhere).
 *
 *   HEAD/GET /api/ingest/s1-object?key=s1/s/GSM…/<d16>.s1      → {exists, bytes, sha256}  (404 when absent)
 *   PUT      /api/ingest/s1-object?key=…   X-Content-SHA256: <64 hex>   body = the object (at most 90 MiB)
 *   Larger objects use R2 multipart, 32 MiB parts:
 *   POST     ?key=…&action=mpu-create                       → {upload_id}
 *   PUT      ?key=…&action=mpu-part&upload=<id>&part=<n>    body = the part                     → {part, etag}
 *   POST     ?key=…&action=mpu-complete&upload=<id>   X-Content-SHA256   body {parts:[{part, etag}]} → verified by reading the object back
 *   POST     ?key=…&action=mpu-abort&upload=<id>
 *
 * Auth: `X-Ingest-Token`, as the other /api/ingest routes. Keys are the content-addressed `s1/` keys of docs/format-s1.md section 2
 * (_shared/channel classifyObjectKey); `private/*` is refused. The key's 32-hex digest must equal the first 16 bytes of the SHA-256 the caller
 * declares, and R2 re-checks the declared SHA-256 against the bytes it receives, so a corrupt upload is rejected, not stored.
 * Idempotent: an object that already exists with the same SHA-256 is left alone (`unchanged: true`); one with a different SHA-256 under a
 * content-addressed key cannot happen (the key holds the digest). No D1 writes.
 */
import { classifyObjectKey, isBeta } from "../../_shared/channel";
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";

interface Env {
  SINGLET_DATA?: R2Bucket;
  CHANNEL?: string;
  INGEST_TOKEN_SHA256?: string;
}

const MAX_SINGLE_BYTES = 90 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function gate(request: Request, env: Env): Promise<Response | { key: string; digest: string | null; kind: string }> {
  if (!isBeta(env)) return json({ error: "Rolling ingest is enabled only on the beta channel" }, 403);
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  if (!env.SINGLET_DATA) return json({ error: "SINGLET_DATA binding missing" }, 503);
  const key = (new URL(request.url).searchParams.get("key") ?? "").trim();
  const c = classifyObjectKey(key);
  if (!c.ok) return json({ error: c.error }, 422);
  return { key, digest: c.digest, kind: c.kind };
}

/** Checks the declared SHA-256 against the key's digest; returns the lowercase hex or a 422 response. */
function declaredSha(request: Request, digest: string | null): string | Response {
  const sha = (request.headers.get("X-Content-SHA256") ?? "").trim().toLowerCase();
  if (!SHA_RE.test(sha)) return json({ error: "X-Content-SHA256 (64 hex) is required" }, 400);
  if (digest && !sha.startsWith(digest)) return json({ error: "The key's digest is not the first 16 bytes of X-Content-SHA256" }, 422);
  return sha;
}

async function sha256Of(obj: R2ObjectBody): Promise<string> {
  const ds = new crypto.DigestStream("SHA-256");
  await obj.body.pipeTo(ds);
  const buf = new Uint8Array(await ds.digest);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const stat = (o: R2Object) => ({ exists: true, key: o.key, bytes: o.size, sha256: o.customMetadata?.sha256 ?? null, uploaded: o.uploaded.toISOString() });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const head = await env.SINGLET_DATA!.head(g.key);
  return head ? json(stat(head)) : json({ exists: false, key: g.key }, 404);
};
export const onRequestHead = onRequestGet;

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const bucket = env.SINGLET_DATA!;
  const q = new URL(request.url).searchParams;
  const action = q.get("action") ?? "";
  try {
    if (action === "mpu-part") {
      const upload = q.get("upload") ?? "";
      const part = Number(q.get("part"));
      if (!upload || !Number.isInteger(part) || part < 1 || part > 10000) return json({ error: "upload and part (1..10000) are required" }, 400);
      if (!request.body) return json({ error: "Empty part" }, 400);
      const p = await bucket.resumeMultipartUpload(g.key, upload).uploadPart(part, request.body);
      return json({ part: p.partNumber, etag: p.etag });
    }
    if (action) return json({ error: "Unknown action" }, 400);
    const sha = declaredSha(request, g.digest);
    if (sha instanceof Response) return sha;
    const declared = Number(request.headers.get("Content-Length") ?? "0");
    if (!declared) return json({ error: "Content-Length is required" }, 411);
    if (declared > MAX_SINGLE_BYTES) return json({ error: "Over 90 MiB: use the multipart actions" }, 413);
    const existing = await bucket.head(g.key);
    if (existing && existing.customMetadata?.sha256 === sha && existing.size === declared) return json({ ...stat(existing), unchanged: true });
    const put = await bucket.put(g.key, request.body, { sha256: sha, customMetadata: { sha256: sha } }); // R2 rejects bytes that do not hash to `sha`
    return json({ ...stat(put), unchanged: false });
  } catch (e) {
    if (/sha256|digest|checksum/i.test(String(e))) return json({ error: "Body does not match X-Content-SHA256" }, 422);
    return serverError(e, "ingest s1-object put");
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const bucket = env.SINGLET_DATA!;
  const q = new URL(request.url).searchParams;
  const action = q.get("action") ?? "";
  try {
    if (action === "mpu-create") {
      const sha = declaredSha(request, g.digest);
      if (sha instanceof Response) return sha;
      const existing = await bucket.head(g.key);
      if (existing && existing.customMetadata?.sha256 === sha) return json({ ...stat(existing), unchanged: true });
      const u = await bucket.createMultipartUpload(g.key, { customMetadata: { sha256: sha } });
      return json({ upload_id: u.uploadId });
    }
    const upload = q.get("upload") ?? "";
    if (!upload) return json({ error: "upload is required" }, 400);
    const mpu = bucket.resumeMultipartUpload(g.key, upload);
    if (action === "mpu-abort") {
      await mpu.abort();
      return json({ ok: true });
    }
    if (action === "mpu-complete") {
      const sha = declaredSha(request, g.digest);
      if (sha instanceof Response) return sha;
      const body = (await request.json().catch(() => null)) as { parts?: { part: number; etag: string }[] } | null;
      if (!body?.parts?.length) return json({ error: "parts is required" }, 400);
      const done = await mpu.complete(body.parts.map((p) => ({ partNumber: p.part, etag: p.etag })));
      // Multipart ETags are not content hashes: read the object back and hash it. A mismatch is deleted, not served.
      const back = await bucket.get(g.key);
      if (!back || (await sha256Of(back)) !== sha) {
        await bucket.delete(g.key);
        return json({ error: "Reassembled object does not match X-Content-SHA256; deleted" }, 422);
      }
      return json({ ...stat(done), unchanged: false });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return serverError(e, "ingest s1-object multipart");
  }
};
