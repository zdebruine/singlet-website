/**
 * Visitor identity for AI-search budgets.
 *
 * The catalog API never verifies sessions itself; it forwards whatever the
 * browser sent so the Lovable Cloud edge function can:
 *   - validate a user's bearer token (signed-in budget), or
 *   - fall back to a salted hash of the visitor's IP (anonymous budget).
 *
 * The IP hash MUST be computed here: the edge function only ever sees the
 * Pages egress address, not the visitor's. The salt and the `anon:<hex>`
 * shape mirror supabase/functions/_shared/quota.ts.
 */

const ANON_SALT = "singlet-ai-quota-v1";

/** Per-request header that carries the visitor's remaining budget back to the UI. */
export const QUOTA_HEADER = "X-Singlet-Quota";

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function anonSubjectFromIp(ip: string): Promise<string> {
  return `anon:${(await sha256Hex(`${ANON_SALT}:${ip.trim()}`)).slice(0, 32)}`;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

/** A user's bearer JWT, or null when the request is anonymous / carries the public key. */
export function userBearer(request: Request, anonKey: string): string | null {
  const raw = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  const token = m[1].trim();
  if (!token || token === anonKey || token.split(".").length !== 3) return null;
  return token;
}

/**
 * Headers to attach when calling a Lovable Cloud function on the visitor's
 * behalf. `apikey` is always the public key; `Authorization` is the user's
 * token when signed in, otherwise the public key plus the anonymous subject.
 */
export async function identityHeaders(request: Request, anonKey: string): Promise<Record<string, string>> {
  const user = userBearer(request, anonKey);
  if (user) return { apikey: anonKey, Authorization: `Bearer ${user}` };
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "X-Singlet-Anon": await anonSubjectFromIp(clientIp(request)),
  };
}
