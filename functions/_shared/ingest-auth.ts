/**
 * `X-Ingest-Token` check shared by the HPC ingest endpoints
 * (POST /api/ingest/:table and POST /api/ingest/hpc).
 *
 * Only the SHA-256 hex digest of the token is ever known to this repo — the
 * plaintext token is NEVER stored here. Setting `INGEST_TOKEN_SHA256` as a
 * Cloudflare Pages environment variable overrides the baked-in digest below.
 * It may hold several comma-separated digests, so a token is rotated without
 * downtime: add the new digest next to the old one, switch the HPC
 * orchestrator to the new token, then drop the old digest.
 */
import { sha256Hex, timingSafeEqual } from "./hash";

// Fallback used ONLY while INGEST_TOKEN_SHA256 is unset or blank, to keep the
// HPC orchestrator's current token working. TODO(rotation): delete this
// constant (and the fallback in acceptedDigests) once INGEST_TOKEN_SHA256 is
// set in the Pages project and the orchestrator has moved to the new token.
const DEFAULT_TOKEN_SHA256 = "b37e6cb5277791ff7d0de2550f0944ea39e580ec4f94e9f4c3b8dcd842a8aaab";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export interface IngestAuthEnv {
  INGEST_TOKEN_SHA256?: string;
}

/**
 * Token digests currently accepted: the comma-separated INGEST_TOKEN_SHA256
 * list, or the baked-in default when that variable is unset. Malformed entries
 * are ignored, so a variable holding no valid digest rejects every token
 * rather than silently falling back to the default.
 */
export function acceptedDigests(env: IngestAuthEnv): string[] {
  const configured = (env.INGEST_TOKEN_SHA256 ?? "").trim();
  const raw = configured || DEFAULT_TOKEN_SHA256;
  return raw
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
