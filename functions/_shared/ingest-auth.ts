/**
 * `X-Ingest-Token` check shared by the HPC ingest endpoints
 * (POST /api/ingest/:table, POST /api/ingest/hpc) and the catalog cranks
 * (GET /api/ingest/refresh-next, /api/ingest/index-next).
 *
 * Only the SHA-256 hex digest of the token is ever known to this repo; the
 * plaintext token is never stored here. The `INGEST_TOKEN_SHA256` Pages
 * variable (Production and Preview) holds the accepted digests. It may hold
 * several comma-separated digests, so a token is rotated without downtime: add
 * the new digest next to the old one, switch callers to the new token, then
 * drop the old digest.
 *
 * Fails closed: with the variable unset, blank or holding no valid digest,
 * every token is rejected.
 */
import { sha256Hex, timingSafeEqual } from "./hash";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export interface IngestAuthEnv {
  INGEST_TOKEN_SHA256?: string;
}

/** Token digests currently accepted: the comma-separated INGEST_TOKEN_SHA256 list, minus malformed entries. */
export function acceptedDigests(env: IngestAuthEnv): string[] {
  return (env.INGEST_TOKEN_SHA256 ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => SHA256_HEX_RE.test(d));
}

/** True when the token's digest is in the accepted list (every entry is compared). */
export async function tokenAccepted(env: IngestAuthEnv, token: string): Promise<boolean> {
  const got = await sha256Hex(token);
  let ok = false;
  for (const digest of acceptedDigests(env)) ok = timingSafeEqual(got, digest) || ok;
  return ok;
}

/**
 * Checks the request's `X-Ingest-Token` header. On failure `error` is the
 * message to send back with HTTP 401.
 */
export async function checkIngestToken(
  request: Request,
  env: IngestAuthEnv
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = request.headers.get("X-Ingest-Token") ?? "";
  if (!token) return { ok: false, error: "Missing X-Ingest-Token" };
  if (!(await tokenAccepted(env, token))) return { ok: false, error: "Invalid ingest token" };
  return { ok: true };
}
