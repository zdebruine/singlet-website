/**
 * Shared plumbing for the private-file routes under /api/projects/* (R2
 * multipart uploads, URL registration, authorized downloads, deletes).
 *
 * All data access goes straight to D1 through product.ts. Every route
 * resolves the caller once (identity.ts requireUser, or resolveIdentity for
 * read-token downloads) before it reads a body, fetches a URL or touches R2,
 * so an anonymous request never causes work.
 */
import type { AppEnv } from "./env";
import { FILE_BYTES_CAP, ProductError, productJson, type PendingUpload, type ProductCtx } from "./product";

export { ACCOUNT_BYTES_CAP, FILE_BYTES_CAP, FILE_CAP, GLOBAL_BYTES_CAP, PROJECT_CAP } from "./product";

/** R2 multipart part size for private uploads (a 2 GiB file is 41 parts). */
export const PART_BYTES = 50 * 1024 ** 2;
export const MAX_PARTS = Math.ceil(FILE_BYTES_CAP / PART_BYTES);

/**
 * The exact size of upload part `n` (1-based) of an `expected`-byte file cut
 * into PART_BYTES pieces, or 0 when the file has no such part. Uploads stay
 * within the bytes their reservation counted against the storage caps.
 */
export function partLength(expected: number, n: number): number {
  if (!Number.isInteger(expected) || expected <= 0 || !Number.isInteger(n) || n < 1) return 0;
  const start = (n - 1) * PART_BYTES;
  return start < expected ? Math.min(PART_BYTES, expected - start) : 0;
}

/**
 * Response headers for a private file streamed from a registered URL. Built
 * from an allowlist: forwarding the remote host's own headers would let it set
 * cookies (Set-Cookie, Clear-Site-Data, …) on this origin. Content-Length is
 * kept only when the body is not re-encoded (fetch decodes Content-Encoding).
 */
export function privateDownloadHeaders(upstream: { get(name: string): string | null }, filename: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  for (const name of ["Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
    const value = upstream.get(name);
    if (value) headers[name] = value;
  }
  const length = upstream.get("Content-Length");
  if (length && !upstream.get("Content-Encoding")) headers["Content-Length"] = length;
  return headers;
}

/** Abort unfinished R2 multipart uploads so their parts stop using storage. Never fails the request. */
export async function abortUploads(bucket: R2Bucket | undefined, uploads: PendingUpload[]): Promise<void> {
  if (!bucket || !uploads.length) return;
  const b: R2Bucket = bucket;
  await Promise.all(
    uploads.map((u) =>
      b
        .resumeMultipartUpload(u.object_key, u.r2_upload_id)
        .abort()
        .catch((e: unknown) => console.warn("[private-project] multipart abort failed:", String(e))),
    ),
  );
}

/** The private routes use the app env; USER_DATA must be bound for stored uploads. */
export type PrivateEnv = AppEnv;

export function productContext(request: Request, env: { DB: D1Database }): ProductCtx {
  return { db: env.DB, origin: new URL(request.url).origin };
}

/** JSON, no-store — the same shape as /api/product. */
export const json = productJson;

/** The request body as an object ({} when it is missing or not a JSON object). */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await request.json().catch(() => null);
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * Error → Response for the /api/projects routes. A ProductError keeps its
 * code and status. Other errors (indexer, URL checks, R2) are reported with
 * their message and `status` — except database errors, which are logged and
 * hidden behind a generic 500.
 */
export function routeError(e: unknown, fallback: string, status = 400, code = "request_failed"): Response {
  if (e instanceof ProductError) return productJson({ error: e.code, message: e.message, ...e.extra }, e.status);
  const message = e instanceof Error && e.message ? e.message : fallback;
  if (/D1_|SQLITE/i.test(message)) {
    console.error("[private-project]", message);
    return productJson({ error: "server_error", message: "Could not complete that request right now." }, 500);
  }
  return productJson({ error: code, message }, status);
}

export function storageUnavailable(): Response {
  return productJson({ error: "storage_unavailable", message: "Private file storage is not available right now." }, 503);
}

/** Remove stored objects. Never fails the request: a leftover object only wastes bytes. */
export async function removeObjects(bucket: R2Bucket | undefined, keys: string[]): Promise<void> {
  if (!bucket || !keys.length) return;
  await bucket.delete(keys).catch((e: unknown) => console.warn("[private-project] R2 delete failed:", String(e)));
}
