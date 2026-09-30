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
import { FILE_BYTES_CAP, ProductError, productJson, type ProductCtx } from "./product";

export { ACCOUNT_BYTES_CAP, FILE_BYTES_CAP, FILE_CAP, GLOBAL_BYTES_CAP, PROJECT_CAP } from "./product";

/** R2 multipart part size for private uploads (a 2 GiB file is 41 parts). */
export const PART_BYTES = 50 * 1024 ** 2;
export const MAX_PARTS = Math.ceil(FILE_BYTES_CAP / PART_BYTES);

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
